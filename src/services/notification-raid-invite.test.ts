import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import {
  raidInviteSourceKey,
  userNotificationRepository,
} from "@/repositories/user-notification.repository";
import { discordSyncService } from "@/services/discord-sync.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import type { CharacterRole } from "@/models/enums";

const ids = {
  lead: "n3333333-3333-4333-8333-333333333301",
  admin: "n3333333-3333-4333-8333-333333333302",
  player: "n3333333-3333-4333-8333-333333333303",
  skipped: "n3333333-3333-4333-8333-333333333304",
};

const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];

let scheduleSlot = 0;
function futureIso(days = 14) {
  const slot = scheduleSlot++;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000 + slot * 3 * 60 * 60 * 1000).toISOString();
}

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@ninvite.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function createTestUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"],
  opts: {
    discordUserId?: string | null;
    dmRaidInviteEnabled?: boolean;
    dmRosterSelectedEnabled?: boolean;
  } = {},
) {
  await orm.User.create({
    id,
    name,
    email: `${id}@ninvite.boostting.local`,
    emailVerified: true,
    discordUserId: opts.discordUserId ?? null,
    discordUsername: opts.discordUserId ? `u${opts.discordUserId}` : null,
    accountRole,
    accountStatus: "ACTIVE",
    dmRosterSelectedEnabled: opts.dmRosterSelectedEnabled ?? true,
    dmRaidInviteEnabled: opts.dmRaidInviteEnabled ?? true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function createCharacter(input: {
  userId: string;
  name: string;
  wowClass: "SHAMAN" | "PALADIN" | "HUNTER" | "PRIEST";
  specialization: string;
  primaryRole: CharacterRole;
}) {
  const id = crypto.randomUUID();
  createdCharacterIds.push(id);
  await orm.Character.create({
    id,
    userId: input.userId,
    name: input.name,
    realm: "Notify Invite",
    normalizedName: normalizeCharacterIdentity(input.name),
    normalizedRealm: normalizeCharacterIdentity("Notify Invite"),
    region: "EU",
    wowClass: input.wowClass,
    specialization: input.specialization,
    primaryRole: input.primaryRole,
    itemLevel: 700,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

async function approveAccess(userId: string) {
  const existing = await orm.BoosterQualification.where({ userId, difficulty: "HEROIC" }).first();
  if (existing) return;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.BoosterQualification.create({
    id,
    userId,
    difficulty: "HEROIC",
    status: "APPROVED",
    notes: "notify invite",
    grantedAt: now,
    grantedById: ids.admin,
    revokedAt: null,
    revokedById: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function createSignup(input: {
  runId: string;
  userId: string;
  characterId: string;
  role: CharacterRole;
}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.RunSignup.create({
    id,
    runId: input.runId,
    userId: input.userId,
    characterId: input.characterId,
    participationType: "BOOSTER",
    isBackup: false,
    status: "PENDING",
    publishedRole: null,
    lootbuddyMode: null,
    lootbuddyVerification: null,
    createdAt: now,
    updatedAt: now,
  });
  await orm.RunSignupRole.create({
    id: crypto.randomUUID(),
    signupId: id,
    role: input.role,
    createdAt: now,
  });
  return id;
}

async function cleanupRun(runId: string) {
  const notes = await orm.UserNotification.where({ runId }).select("id").all();
  for (const row of notes) {
    await orm.UserNotification.where({ id: (row as { id: string }).id }).delete();
  }
  try {
    await orm.RunStartSnapshot.where({ runId }).delete();
  } catch {
    // ignore
  }
  const attendance = await orm.RunAttendance.where({ runId }).select("id").all();
  for (const row of attendance) {
    await orm.RunAttendance.where({ id: (row as { id: string }).id }).delete();
  }
  const post = await orm.RunDiscordPost.where({ runId }).first();
  if (post) {
    await orm.RunDiscordPost.where({ id: (post as { id: string }).id }).delete();
  }
  const roster = await orm.RunRoster.where({ runId }).first();
  if (roster) {
    const rosterId = (roster as { id: string }).id;
    const entries = await orm.RunRosterEntry.where({ rosterId }).all();
    for (const entry of entries) {
      await orm.RunRosterEntry.where({ id: (entry as { id: string }).id }).delete();
    }
    await orm.RunRoster.where({ id: rosterId }).delete();
  }
  const signups = await orm.RunSignup.where({ runId }).select("id").all();
  for (const row of signups) {
    const signupId = (row as { id: string }).id;
    const offered = await orm.RunSignupRole.where({ signupId }).select("id").all();
    for (const offer of offered) {
      await orm.RunSignupRole.where({ id: (offer as { id: string }).id }).delete();
    }
    await orm.RunSignup.where({ id: signupId }).delete();
  }
  await orm.Run.where({ id: runId }).delete();
}

async function cleanupAll() {
  for (const runId of [...createdRunIds]) {
    try {
      await cleanupRun(runId);
    } catch {
      // ignore
    }
  }
  createdRunIds.length = 0;
  for (const userId of Object.values(ids)) {
    const notes = await orm.UserNotification.where({ userId }).select("id").all();
    for (const row of notes) {
      await orm.UserNotification.where({ id: (row as { id: string }).id }).delete();
    }
    const access = await orm.BoosterQualification.where({ userId }).select("id").all();
    for (const row of access) {
      await orm.BoosterQualification.where({ id: (row as { id: string }).id }).delete();
    }
    const chars = await orm.Character.where({ userId }).select("id").all();
    for (const row of chars) {
      await orm.Character.where({ id: (row as { id: string }).id }).delete();
    }
    try {
      await orm.User.where({ id: userId }).delete();
    } catch {
      // ignore
    }
  }
}

const lead = asUser(ids.lead, "Notify Invite Lead", "RAID_LEAD");

let charPlayer = "";
let charSkipped = "";
let charLeadTank = "";
let charLeadDps = "";

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await cleanupAll();
  await createTestUser(ids.lead, "Notify Invite Lead", "RAID_LEAD");
  await createTestUser(ids.admin, "Notify Invite Admin", "ADMIN");
  await createTestUser(ids.player, "Notify Invite Player", "USER", {
    discordUserId: "910000000000000001",
    dmRaidInviteEnabled: true,
  });
  await createTestUser(ids.skipped, "Notify Invite Skipped", "USER", {
    discordUserId: "910000000000000002",
    dmRaidInviteEnabled: false,
  });
  await approveAccess(ids.lead);
  await approveAccess(ids.player);
  await approveAccess(ids.skipped);

  charPlayer = await createCharacter({
    userId: ids.player,
    name: "NInviteA",
    wowClass: "SHAMAN",
    specialization: "Restoration",
    primaryRole: "HEALER",
  });
  charSkipped = await createCharacter({
    userId: ids.skipped,
    name: "NInviteB",
    wowClass: "PRIEST",
    specialization: "Holy",
    primaryRole: "HEALER",
  });
  charLeadTank = await createCharacter({
    userId: ids.lead,
    name: "NILeadTank",
    wowClass: "PALADIN",
    specialization: "Protection",
    primaryRole: "TANK",
  });
  charLeadDps = await createCharacter({
    userId: ids.lead,
    name: "NILeadDps",
    wowClass: "HUNTER",
    specialization: "Beast Mastery",
    primaryRole: "DPS",
  });
});

afterAll(async () => {
  await cleanupAll();
});

describe("notification raid invite + bot delivery", () => {
  it("creates RAID_INVITE on start (PENDING/SKIPPED), keeps raidInvites empty, delivers via notificationDms", async () => {
    const created = await runService.createRun(
      lead,
      venomousCreateInput({
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        scheduledStartAt: futureIso(),
        desiredTankCount: 1,
        desiredHealerCount: 2,
        desiredDpsCount: 1,
      }),
    );
    createdRunIds.push(created.id);
    const runId = created.id;
    await runService.openRun(lead, runId);

    const tank = await createSignup({ runId, userId: ids.lead, characterId: charLeadTank, role: "TANK" });
    const dps = await createSignup({ runId, userId: ids.lead, characterId: charLeadDps, role: "DPS" });
    const healer = await createSignup({
      runId,
      userId: ids.player,
      characterId: charPlayer,
      role: "HEALER",
    });
    const healerSkipped = await createSignup({
      runId,
      userId: ids.skipped,
      characterId: charSkipped,
      role: "HEALER",
    });

    let view = await rosterService.getRosterManagementView(lead, runId);
    for (const signupId of [tank, dps, healer, healerSkipped]) {
      view = await rosterService.getRosterManagementView(lead, runId);
      await rosterService.setDraftSelection(lead, {
        runId,
        signupId,
        selected: true,
        version: view.roster.version,
      });
    }
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, {
      runId,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });

    await runService.startRun(lead, { runId });

    const pendingPlayer = (await userNotificationRepository.listForUser(ids.player, 20)).filter(
      (row) => row.type === "RAID_INVITE" && row.runId === runId,
    );
    expect(pendingPlayer).toHaveLength(1);
    expect(pendingPlayer[0].sourceKey).toBe(raidInviteSourceKey(runId, healer));
    expect(pendingPlayer[0].discordDeliveryStatus).toBe("PENDING");
    expect(pendingPlayer[0].discordUserId).toBe("910000000000000001");

    const skipped = (await userNotificationRepository.listForUser(ids.skipped, 20)).filter(
      (row) => row.type === "RAID_INVITE" && row.runId === runId,
    );
    expect(skipped).toHaveLength(1);
    expect(skipped[0].discordDeliveryStatus).toBe("SKIPPED");
    expect(skipped[0].discordUserId).toBeNull();

    // Idempotent second create path (sourceKey)
    const again = await userNotificationRepository.createIgnoreDuplicate({
      userId: ids.player,
      type: "RAID_INVITE",
      runId,
      signupId: healer,
      sourceKey: raidInviteSourceKey(runId, healer),
      title: "dup",
      message: "dup",
      href: "/runs",
      discordDeliveryStatus: "PENDING",
      discordUserId: "910000000000000001",
    });
    expect(again).toBeNull();

    const work = await discordSyncService.listSyncWork();
    expect(work.raidInvites).toEqual([]);
    const dm = work.notificationDms.find((item) => item.signupId === healer && item.type === "RAID_INVITE");
    expect(dm).toBeTruthy();
    expect(dm!.notificationId).toBe(pendingPlayer[0].id);
    expect(work.notificationDms.some((item) => item.signupId === healerSkipped && item.type === "RAID_INVITE")).toBe(
      false,
    );

    await discordSyncService.recordNotificationDmDelivery({
      notificationId: pendingPlayer[0].id,
      result: "SENT",
    });
    const afterSent = await userNotificationRepository.findById(pendingPlayer[0].id);
    expect(afterSent?.discordDeliveryStatus).toBe("SENT");

    const workAfter = await discordSyncService.listSyncWork();
    expect(workAfter.notificationDms.some((item) => item.notificationId === pendingPlayer[0].id)).toBe(
      false,
    );

    // SKIPPED stays skipped — never appears as work even if preference later enabled
    await orm.User.where({ id: ids.skipped }).update({
      dmRaidInviteEnabled: true,
      updatedAt: new Date().toISOString(),
    });
    const workPrefs = await discordSyncService.listSyncWork();
    expect(
      workPrefs.notificationDms.some(
        (item) => item.signupId === healerSkipped && item.type === "RAID_INVITE",
      ),
    ).toBe(false);
    expect(workPrefs.notificationDms.some((item) => item.notificationId === skipped[0].id)).toBe(false);
  });

  it("marks FAILED_PERMANENT and does not retry", async () => {
    const created = await runService.createRun(
      lead,
      venomousCreateInput({
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        scheduledStartAt: futureIso(),
        desiredTankCount: 1,
        desiredHealerCount: 1,
        desiredDpsCount: 1,
      }),
    );
    createdRunIds.push(created.id);
    const runId = created.id;
    await runService.openRun(lead, runId);

    const tank = await createSignup({ runId, userId: ids.lead, characterId: charLeadTank, role: "TANK" });
    const dps = await createSignup({ runId, userId: ids.lead, characterId: charLeadDps, role: "DPS" });
    const healer = await createSignup({
      runId,
      userId: ids.player,
      characterId: charPlayer,
      role: "HEALER",
    });

    let view = await rosterService.getRosterManagementView(lead, runId);
    for (const signupId of [tank, dps, healer]) {
      view = await rosterService.getRosterManagementView(lead, runId);
      await rosterService.setDraftSelection(lead, {
        runId,
        signupId,
        selected: true,
        version: view.roster.version,
      });
    }
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, {
      runId,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });
    await runService.startRun(lead, { runId });

    const invite = (await userNotificationRepository.listForUser(ids.player, 20)).find(
      (row) => row.type === "RAID_INVITE" && row.runId === runId,
    );
    expect(invite).toBeTruthy();

    await discordSyncService.recordNotificationDmDelivery({
      notificationId: invite!.id,
      result: "FAILED_PERMANENT",
    });
    const failed = await userNotificationRepository.findById(invite!.id);
    expect(failed?.discordDeliveryStatus).toBe("FAILED_PERMANENT");

    const work = await discordSyncService.listSyncWork();
    expect(work.notificationDms.some((item) => item.notificationId === invite!.id)).toBe(false);
  });
});
