import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import {
  rosterSelectedSourceKey,
  userNotificationRepository,
} from "@/repositories/user-notification.repository";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import type { CharacterRole } from "@/models/enums";

const ids = {
  lead: "n2222222-2222-4222-8222-222222222201",
  admin: "n2222222-2222-4222-8222-222222222202",
  player: "n2222222-2222-4222-8222-222222222203",
  playerB: "n2222222-2222-4222-8222-222222222204",
};

const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdSignupIds: string[] = [];
const createdAccessIds: string[] = [];

let scheduleSlot = 0;
function futureIso(days = 12) {
  const slot = scheduleSlot++;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000 + slot * 3 * 60 * 60 * 1000).toISOString();
}

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
  discordUserId: string | null = null,
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@nroster.boostting.local`,
    image: null,
    discordUserId,
    discordUsername: discordUserId ? `u${discordUserId}` : null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function createTestUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"],
  opts: { discordUserId?: string | null; dmRosterSelectedEnabled?: boolean } = {},
) {
  await orm.User.create({
    id,
    name,
    email: `${id}@nroster.boostting.local`,
    emailVerified: true,
    discordUserId: opts.discordUserId ?? null,
    discordUsername: opts.discordUserId ? `u${opts.discordUserId}` : null,
    accountRole,
    accountStatus: "ACTIVE",
    dmRosterSelectedEnabled: opts.dmRosterSelectedEnabled ?? true,
    dmRaidInviteEnabled: true,
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
    realm: "Notify Roster",
    normalizedName: normalizeCharacterIdentity(input.name),
    normalizedRealm: normalizeCharacterIdentity("Notify Roster"),
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
  if (existing) {
    createdAccessIds.push(String((existing as { id: string }).id));
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  createdAccessIds.push(id);
  await orm.BoosterQualification.create({
    id,
    userId,
    difficulty: "HEROIC",
    status: "APPROVED",
    notes: "notify roster",
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
  createdSignupIds.push(id);
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
    const signups = await orm.RunSignup.where({ userId }).select("id").all();
    for (const row of signups) {
      const signupId = (row as { id: string }).id;
      const offered = await orm.RunSignupRole.where({ signupId }).select("id").all();
      for (const offer of offered) {
        await orm.RunSignupRole.where({ id: (offer as { id: string }).id }).delete();
      }
      await orm.RunSignup.where({ id: signupId }).delete();
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

const lead = asUser(ids.lead, "Notify Roster Lead", "RAID_LEAD");

let charPlayer = "";
let charPlayerB = "";
let charLeadTank = "";
let charLeadDps = "";

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await cleanupAll();
  await createTestUser(ids.lead, "Notify Roster Lead", "RAID_LEAD");
  await createTestUser(ids.admin, "Notify Roster Admin", "ADMIN");
  await createTestUser(ids.player, "Notify Player", "USER", {
    discordUserId: "900000000000000001",
    dmRosterSelectedEnabled: true,
  });
  await createTestUser(ids.playerB, "Notify Player B", "USER", {
    discordUserId: "900000000000000002",
    dmRosterSelectedEnabled: false,
  });
  await approveAccess(ids.player);
  await approveAccess(ids.playerB);
  await approveAccess(ids.lead);

  charPlayer = await createCharacter({
    userId: ids.player,
    name: "NRosterA",
    wowClass: "SHAMAN",
    specialization: "Restoration",
    primaryRole: "HEALER",
  });
  charPlayerB = await createCharacter({
    userId: ids.playerB,
    name: "NRosterB",
    wowClass: "PRIEST",
    specialization: "Holy",
    primaryRole: "HEALER",
  });
  charLeadTank = await createCharacter({
    userId: ids.lead,
    name: "NLeadTank",
    wowClass: "PALADIN",
    specialization: "Protection",
    primaryRole: "TANK",
  });
  charLeadDps = await createCharacter({
    userId: ids.lead,
    name: "NLeadDps",
    wowClass: "HUNTER",
    specialization: "Beast Mastery",
    primaryRole: "DPS",
  });
});

afterAll(async () => {
  await cleanupAll();
});

async function createPublishedReadyRun(desiredHealerCount = 1) {
  const created = await runService.createRun(
    lead,
    venomousCreateInput({
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: futureIso(),
      desiredTankCount: 1,
      desiredHealerCount,
      desiredDpsCount: 1,
    }),
  );
  createdRunIds.push(created.id);
  await runService.openRun(lead, created.id);
  return created.id;
}

describe("notification roster publish events", () => {
  it("does not notify on draft selection; notifies newly selected on publish with PENDING/SKIPPED", async () => {
    const runId = await createPublishedReadyRun(2);
    const tank = await createSignup({ runId, userId: ids.lead, characterId: charLeadTank, role: "TANK" });
    const dps = await createSignup({ runId, userId: ids.lead, characterId: charLeadDps, role: "DPS" });
    const healer = await createSignup({
      runId,
      userId: ids.player,
      characterId: charPlayer,
      role: "HEALER",
    });
    const healerB = await createSignup({
      runId,
      userId: ids.playerB,
      characterId: charPlayerB,
      role: "HEALER",
    });

    let view = await rosterService.getRosterManagementView(lead, runId);
    for (const signupId of [tank, dps, healer, healerB]) {
      view = await rosterService.getRosterManagementView(lead, runId);
      await rosterService.setDraftSelection(lead, {
        runId,
        signupId,
        selected: true,
        version: view.roster.version,
      });
    }

    const beforePublish = await orm.UserNotification.where({ runId }).all();
    expect(beforePublish).toHaveLength(0);

    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, {
      runId,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });

    const after = await userNotificationRepository.listForUser(ids.player, 20);
    const rosterNotes = after.filter((row) => row.runId === runId && row.type === "ROSTER_SELECTED");
    expect(rosterNotes).toHaveLength(1);
    expect(rosterNotes[0].discordDeliveryStatus).toBe("PENDING");
    expect(rosterNotes[0].discordUserId).toBe("900000000000000001");
    expect(rosterNotes[0].sourceKey).toBe(
      rosterSelectedSourceKey(runId, (await rosterService.getRosterManagementView(lead, runId)).roster.version, healer),
    );

    const skipped = (await userNotificationRepository.listForUser(ids.playerB, 20)).filter(
      (row) => row.runId === runId && row.type === "ROSTER_SELECTED",
    );
    expect(skipped).toHaveLength(1);
    expect(skipped[0].discordDeliveryStatus).toBe("SKIPPED");
    expect(skipped[0].discordUserId).toBeNull();
  });

  it("dedupes republish for already-selected signups and notifies on reselection after drop", async () => {
    const runId = await createPublishedReadyRun(1);
    const tank = await createSignup({ runId, userId: ids.lead, characterId: charLeadTank, role: "TANK" });
    const dps = await createSignup({ runId, userId: ids.lead, characterId: charLeadDps, role: "DPS" });
    const healer = await createSignup({
      runId,
      userId: ids.player,
      characterId: charPlayer,
      role: "HEALER",
    });
    const healerAlt = await createSignup({
      runId,
      userId: ids.playerB,
      characterId: charPlayerB,
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

    const first = (await userNotificationRepository.listForUser(ids.player, 20)).filter(
      (row) => row.runId === runId && row.type === "ROSTER_SELECTED",
    );
    expect(first).toHaveLength(1);
    const firstSource = first[0].sourceKey;

    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.preparePublishedRosterForEditing(lead, {
      runId,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, {
      runId,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });

    const afterRepublish = (await userNotificationRepository.listForUser(ids.player, 20)).filter(
      (row) => row.runId === runId && row.type === "ROSTER_SELECTED",
    );
    expect(afterRepublish).toHaveLength(1);
    expect(afterRepublish[0].sourceKey).toBe(firstSource);

    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.preparePublishedRosterForEditing(lead, {
      runId,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.setDraftSelection(lead, {
      runId,
      signupId: healer,
      selected: false,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.setDraftSelection(lead, {
      runId,
      signupId: healerAlt,
      selected: true,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, {
      runId,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });

    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.preparePublishedRosterForEditing(lead, {
      runId,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.setDraftSelection(lead, {
      runId,
      signupId: healerAlt,
      selected: false,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.setDraftSelection(lead, {
      runId,
      signupId: healer,
      selected: true,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, {
      runId,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });

    const afterReselect = (await userNotificationRepository.listForUser(ids.player, 20)).filter(
      (row) => row.runId === runId && row.type === "ROSTER_SELECTED",
    );
    expect(afterReselect.length).toBeGreaterThanOrEqual(2);
    expect(afterReselect.some((row) => row.sourceKey !== firstSource)).toBe(true);
  });
});
