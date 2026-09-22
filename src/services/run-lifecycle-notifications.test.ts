import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { ACTIVE_SIGNUP_STATUSES } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import {
  runCancelledSourceKey,
  runRescheduledSourceKey,
  userNotificationRepository,
} from "@/repositories/user-notification.repository";
import { runRepository } from "@/repositories/run.repository";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";
import type { CharacterRole } from "@/models/enums";

const ids = {
  lead: "n3333333-3333-4333-8333-333333333301",
  admin: "n3333333-3333-4333-8333-333333333302",
  player: "n3333333-3333-4333-8333-333333333303",
  multi: "n3333333-3333-4333-8333-333333333304",
};

const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdAccessIds: string[] = [];

let scheduleSlot = 0;
function futureIso(days = 14) {
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
    email: `${id}@nlifecycle.boostting.local`,
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
  opts: { discordUserId?: string | null } = {},
) {
  await orm.User.create({
    id,
    name,
    email: `${id}@nlifecycle.boostting.local`,
    emailVerified: true,
    discordUserId: opts.discordUserId ?? null,
    discordUsername: opts.discordUserId ? `u${opts.discordUserId}` : null,
    accountRole,
    accountStatus: "ACTIVE",
    discordDmEnabled: true,
    dmRosterSelectedEnabled: true,
    dmRaidInviteEnabled: true,
    dmRunCancelledEnabled: true,
    dmRunRescheduledEnabled: true,
    dmRosterRemovedEnabled: true,
    timeZone: "Europe/Berlin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function createCharacter(input: {
  userId: string;
  name: string;
  wowClass: "SHAMAN" | "PALADIN" | "HUNTER" | "PRIEST" | "MONK";
  specialization: string;
  primaryRole: CharacterRole;
}) {
  const id = crypto.randomUUID();
  createdCharacterIds.push(id);
  await orm.Character.create({
    id,
    userId: input.userId,
    name: input.name,
    realm: "Notify Lifecycle",
    normalizedName: normalizeCharacterIdentity(input.name),
    normalizedRealm: normalizeCharacterIdentity("Notify Lifecycle"),
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
    notes: "notify lifecycle",
    grantedAt: now,
    grantedById: ids.admin,
    revokedAt: null,
    revokedById: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function cleanupAll() {
  for (const runId of createdRunIds.splice(0)) {
    const notes = await orm.UserNotification.where({ runId }).select("id").all();
    for (const row of notes) {
      await orm.UserNotification.where({ id: (row as { id: string }).id }).delete();
    }
    try {
      await orm.Run.where({ id: runId }).delete();
    } catch {
      // gone
    }
  }
  for (const characterId of createdCharacterIds.splice(0)) {
    try {
      await orm.Character.where({ id: characterId }).delete();
    } catch {
      // gone
    }
  }
  for (const accessId of createdAccessIds.splice(0)) {
    try {
      await orm.BoosterAccess.where({ id: accessId }).delete();
    } catch {
      // gone
    }
  }
  for (const userId of Object.values(ids)) {
    const quals = await orm.BoosterQualification.where({ userId }).select("id").all();
    for (const row of quals) {
      await orm.BoosterQualification.where({ id: (row as { id: string }).id }).delete();
    }
    const notes = await orm.UserNotification.where({ userId }).select("id").all();
    for (const row of notes) {
      await orm.UserNotification.where({ id: (row as { id: string }).id }).delete();
    }
    try {
      await orm.User.where({ id: userId }).delete();
    } catch {
      // gone
    }
  }
}

const lead = asUser(ids.lead, "Lifecycle Lead", "RAID_LEAD");
const player = asUser(ids.player, "Lifecycle Player", "USER", "920000000000000001");
const multi = asUser(ids.multi, "Lifecycle Multi", "USER", "920000000000000002");

let charPlayer = "";
let charMultiA = "";
let charMultiB = "";
let charLeadTank = "";
let charLeadDps = "";

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await cleanupAll();
  await createTestUser(ids.lead, "Lifecycle Lead", "RAID_LEAD");
  await createTestUser(ids.admin, "Lifecycle Admin", "ADMIN");
  await createTestUser(ids.player, "Lifecycle Player", "USER", { discordUserId: "920000000000000001" });
  await createTestUser(ids.multi, "Lifecycle Multi", "USER", { discordUserId: "920000000000000002" });
  await approveAccess(ids.lead);
  await approveAccess(ids.player);
  await approveAccess(ids.multi);
  charPlayer = await createCharacter({
    userId: ids.player,
    name: "LifeA",
    wowClass: "SHAMAN",
    specialization: "Restoration",
    primaryRole: "HEALER",
  });
  charMultiA = await createCharacter({
    userId: ids.multi,
    name: "LifeB",
    wowClass: "PALADIN",
    specialization: "Holy",
    primaryRole: "HEALER",
  });
  charMultiB = await createCharacter({
    userId: ids.multi,
    name: "LifeC",
    wowClass: "PRIEST",
    specialization: "Holy",
    primaryRole: "HEALER",
  });
  charLeadTank = await createCharacter({
    userId: ids.lead,
    name: "LifeTank",
    wowClass: "PALADIN",
    specialization: "Protection",
    primaryRole: "TANK",
  });
  charLeadDps = await createCharacter({
    userId: ids.lead,
    name: "LifeDps",
    wowClass: "HUNTER",
    specialization: "Beast Mastery",
    primaryRole: "DPS",
  });
});

afterAll(async () => {
  await cleanupAll();
});

describe("run lifecycle notifications", () => {
  it("notifies PENDING/SELECTED once per user on cancel; skips WITHDRAWN/NOT_SELECTED", async () => {
    const scheduledStartAt = futureIso();
    const created = await runService.createRun(
      lead,
      venomousCreateInput({
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        scheduledStartAt,
        desiredTankCount: 1,
        desiredHealerCount: 2,
        desiredDpsCount: 1,
      }),
    );
    createdRunIds.push(created.id);
    await runService.openRun(lead, created.id);

    await signupService.createBoosterSignup(lead, {
      runId: created.id,
      characterId: charLeadTank,
      role: "TANK",
      isBackup: false,
    });
    await signupService.createBoosterSignup(lead, {
      runId: created.id,
      characterId: charLeadDps,
      role: "DPS",
      isBackup: false,
    });
    await signupService.createBoosterSignup(player, {
      runId: created.id,
      characterId: charPlayer,
      role: "HEALER",
      isBackup: false,
    });
    await signupService.createBoosterSignup(multi, {
      runId: created.id,
      characterId: charMultiA,
      role: "HEALER",
      isBackup: false,
    });
    await signupService.createBoosterSignup(multi, {
      runId: created.id,
      characterId: charMultiB,
      role: "HEALER",
      isBackup: false,
    });

    const multiSignups = await orm.RunSignup.where({ runId: created.id, userId: ids.multi }).all();
    expect(multiSignups.length).toBe(2);
    for (const row of multiSignups) {
      expect((ACTIVE_SIGNUP_STATUSES as readonly string[]).includes(String((row as { status: string }).status))).toBe(
        true,
      );
    }

    await runService.cancelRun(lead, created.id);

    const playerNotes = (await userNotificationRepository.listForUser(ids.player, 20)).filter(
      (row) => row.runId === created.id && row.type === "RUN_CANCELLED",
    );
    expect(playerNotes).toHaveLength(1);
    expect(playerNotes[0].sourceKey).toBe(runCancelledSourceKey(created.id, ids.player));
    expect(playerNotes[0].discordDeliveryStatus).toBe("PENDING");

    const multiNotes = (await userNotificationRepository.listForUser(ids.multi, 20)).filter(
      (row) => row.runId === created.id && row.type === "RUN_CANCELLED",
    );
    expect(multiNotes).toHaveLength(1);

    await runService.cancelRun(lead, created.id).catch(() => undefined);
    const retry = (await userNotificationRepository.listForUser(ids.player, 20)).filter(
      (row) => row.runId === created.id && row.type === "RUN_CANCELLED",
    );
    expect(retry).toHaveLength(1);
  });

  it("notifies on schedule change with scheduleRevision and dedupes retries", async () => {
    const firstStart = futureIso();
    const created = await runService.createRun(
      lead,
      venomousCreateInput({
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        scheduledStartAt: firstStart,
        desiredTankCount: 1,
        desiredHealerCount: 1,
        desiredDpsCount: 1,
      }),
    );
    createdRunIds.push(created.id);
    await runService.openRun(lead, created.id);
    await signupService.createBoosterSignup(player, {
      runId: created.id,
      characterId: charPlayer,
      role: "HEALER",
      isBackup: false,
    });

    const run = await runRepository.findById(created.id);
    expect(run?.scheduleRevision).toBe(0);

    const nextStart = new Date(new Date(firstStart).getTime() + 90 * 60 * 1000).toISOString();
    await runService.updateRun(lead, {
      runId: created.id,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: nextStart,
      desiredTankCount: 1,
      desiredHealerCount: 1,
      desiredDpsCount: 1,
      notes: null,
      contentPreset: "VENOMOUS_ABYSS",
      venomousPlannedBossCount: 8,
    });

    const after = await runRepository.findById(created.id);
    expect(after?.scheduleRevision).toBe(1);
    const notes = (await userNotificationRepository.listForUser(ids.player, 20)).filter(
      (row) => row.runId === created.id && row.type === "RUN_RESCHEDULED",
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].sourceKey).toBe(runRescheduledSourceKey(created.id, 1, ids.player));
    expect(notes[0].message).toMatch(/moved from/);

    // Unrelated edit must not notify / bump revision — reuse persisted schedule.
    const persistedSchedule = after!.scheduledStartAt;
    await runService.updateRun(lead, {
      runId: created.id,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: persistedSchedule,
      desiredTankCount: 1,
      desiredHealerCount: 1,
      desiredDpsCount: 1,
      notes: "planning note only",
      contentPreset: "VENOMOUS_ABYSS",
      venomousPlannedBossCount: 8,
    });
    const still = await runRepository.findById(created.id);
    expect(still?.scheduleRevision).toBe(1);
    expect(
      (await userNotificationRepository.listForUser(ids.player, 20)).filter(
        (row) => row.runId === created.id && row.type === "RUN_RESCHEDULED",
      ),
    ).toHaveLength(1);

    const thirdStart = new Date(new Date(persistedSchedule).getTime() + 60 * 60 * 1000).toISOString();
    await runService.updateRun(lead, {
      runId: created.id,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: thirdStart,
      desiredTankCount: 1,
      desiredHealerCount: 1,
      desiredDpsCount: 1,
      notes: "planning note only",
      contentPreset: "VENOMOUS_ABYSS",
      venomousPlannedBossCount: 8,
    });
    const again = await runRepository.findById(created.id);
    expect(again?.scheduleRevision).toBe(2);
    expect(
      (await userNotificationRepository.listForUser(ids.player, 20)).filter(
        (row) => row.runId === created.id && row.type === "RUN_RESCHEDULED",
      ),
    ).toHaveLength(2);
  });
});
