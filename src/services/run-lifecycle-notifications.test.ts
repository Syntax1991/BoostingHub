import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { venomousCreateInput, seededProductSelection } from "@/lib/test-run-input";
import { ACTIVE_SIGNUP_STATUSES } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import {
  runCancelledSourceKey,
  runRescheduledSourceKey,
  runScopeChangedSourceKey,
  userNotificationRepository,
} from "@/repositories/user-notification.repository";
import {
  runRescheduledChannelSourceKey,
  runScopeChangedChannelSourceKey,
} from "@/repositories/run-discord-announcement.repository";
import { parseRunScopeChanges } from "@/lib/run-scope-change";
import { discordSyncService } from "@/services/discord-sync.service";
import { rosterService } from "@/services/roster.service";
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
  await orm.User.where({ id: userId }).update({ isBooster: true });
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
    primaryRole: "RANGED_DPS",
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
      role: "RANGED_DPS",
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
    expect(playerNotes[0].sourceKey).toBe(runCancelledSourceKey(created.id, 1, ids.player));
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
      ...seededProductSelection("VENOMOUS_ABYSS", 8),
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
      ...seededProductSelection("VENOMOUS_ABYSS", 8),
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
      ...seededProductSelection("VENOMOUS_ABYSS", 8),
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

describe("run scope change notifications", () => {
  async function scopeNotes(runId: string, userId: string) {
    return (await userNotificationRepository.listForUser(userId, 50)).filter(
      (row) => row.runId === runId && row.type === "RUN_SCOPE_CHANGED",
    );
  }

  async function scopeAnnouncements(runId: string) {
    const rows = await orm.RunDiscordAnnouncement.where({ runId, type: "RUN_SCOPE_CHANGED" }).all();
    return rows as Array<{ sourceKey: string; scopeChanges: string | null; status: string }>;
  }

  it("published Run 8/8 → 6/8: SELECTED and NOT_SELECTED Users get one notification each; repeat and no-op stay silent", async () => {
    const created = await runService.createRun(
      lead,
      venomousCreateInput({
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        scheduledStartAt: futureIso(30),
        desiredTankCount: 1,
        desiredHealerCount: 2,
        desiredDpsCount: 1,
      }),
    );
    createdRunIds.push(created.id);
    const runId = created.id;
    await runService.openRun(lead, runId);

    const tank = await signupService.createBoosterSignup(lead, { runId, characterId: charLeadTank, role: "TANK", isBackup: false });
    await signupService.createBoosterSignup(player, { runId, characterId: charPlayer, role: "HEALER", isBackup: false });
    const multiA = await signupService.createBoosterSignup(multi, { runId, characterId: charMultiA, role: "HEALER", isBackup: false });
    await signupService.createBoosterSignup(multi, { runId, characterId: charMultiB, role: "HEALER", isBackup: false });

    let view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections: [
        { signupId: tank.id, selectedRole: "TANK" },
        { signupId: multiA.id, selectedRole: "HEALER" },
      ],
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, { runId, version: view.roster.version, acknowledgeWarnings: true });
    const statuses = (await orm.RunSignup.where({ runId }).all()) as Array<{ userId: string; status: string }>;
    expect(statuses.find((row) => row.userId === ids.player)?.status).toBe("NOT_SELECTED");
    expect(statuses.filter((row) => row.userId === ids.multi).map((row) => row.status).sort()).toEqual([
      "NOT_SELECTED",
      "SELECTED",
    ]);

    const persisted = await runRepository.findById(runId);
    expect(persisted?.contentRevision).toBe(0);
    await runService.updateRun(lead, {
      runId,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: persisted!.scheduledStartAt,
      desiredTankCount: 1,
      desiredHealerCount: 2,
      desiredDpsCount: 1,
      notes: null,
      ...seededProductSelection("VENOMOUS_ABYSS", 6),
    });

    const after = await runRepository.findById(runId);
    expect(after?.contentRevision).toBe(1);
    for (const userId of [ids.lead, ids.player, ids.multi]) {
      const notes = await scopeNotes(runId, userId);
      expect(notes).toHaveLength(1);
      expect(notes[0].sourceKey).toBe(runScopeChangedSourceKey(runId, 1, userId));
      expect(notes[0].message).toMatch(/8\/8 → 6\/8 bosses/);
    }
    // Player + multi have a Discord id → DM queued; lead has none → SKIPPED.
    expect((await scopeNotes(runId, ids.player))[0].discordDeliveryStatus).toBe("PENDING");
    expect((await scopeNotes(runId, ids.lead))[0].discordDeliveryStatus).toBe("SKIPPED");

    const announcements = await scopeAnnouncements(runId);
    expect(announcements).toHaveLength(1);
    expect(announcements[0].sourceKey).toBe(runScopeChangedChannelSourceKey(runId, 1));
    expect(announcements[0].status).toBe("PENDING");
    const changes = parseRunScopeChanges(announcements[0].scopeChanges);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "CHANGED", beforePlannedBossCount: 8, afterPlannedBossCount: 6 });

    // Bot work: the DM carries the structured change; the channel item too.
    const work = await discordSyncService.listSyncWork();
    const dm = work.notificationDms.find(
      (item) => item.type === "RUN_SCOPE_CHANGED" && item.runId === runId && item.discordUserId === "920000000000000001",
    );
    expect(dm?.scopeChanges).toEqual(changes);
    expect(work.runAnnouncements.find((item) => item.runId === runId && item.type === "RUN_SCOPE_CHANGED")?.scopeChanges).toEqual(
      changes,
    );

    // Repeat the same request (already 6/8) and a notes-only edit: no new notifications.
    const at6 = await runRepository.findById(runId);
    for (const notes of [null, "only a note"]) {
      await runService.updateRun(lead, {
        runId,
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        scheduledStartAt: at6!.scheduledStartAt,
        desiredTankCount: 1,
        desiredHealerCount: 2,
        desiredDpsCount: 1,
        notes,
        ...seededProductSelection("VENOMOUS_ABYSS", 6),
      });
    }
    expect((await runRepository.findById(runId))?.contentRevision).toBe(1);
    expect(await scopeNotes(runId, ids.player)).toHaveLength(1);
    expect(await scopeAnnouncements(runId)).toHaveLength(1);

    // 6/8 → 8/8 is a new logical change.
    await runService.updateRun(lead, {
      runId,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: at6!.scheduledStartAt,
      desiredTankCount: 1,
      desiredHealerCount: 2,
      desiredDpsCount: 1,
      notes: null,
      ...seededProductSelection("VENOMOUS_ABYSS", 8),
    });
    expect((await runRepository.findById(runId))?.contentRevision).toBe(2);
    const playerNotes = await scopeNotes(runId, ids.player);
    expect(playerNotes).toHaveLength(2);
    expect(playerNotes.some((row) => /6\/8 → 8\/8 bosses/.test(row.message))).toBe(true);

    // Retrying the notify step for the same revision creates nothing new.
    await runLifecycleRetry(runId, 2, changes);
    expect(await scopeNotes(runId, ids.player)).toHaveLength(2);
  });

  it("OPEN Run: draft-picked PENDING signup is notified, WITHDRAWN User is not, multi-content reports only the changed raid", async () => {
    const created = await runService.createRun(
      lead,
      venomousCreateInput({
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        scheduledStartAt: futureIso(40),
        desiredTankCount: 1,
        desiredHealerCount: 2,
        desiredDpsCount: 1,
      }),
    );
    createdRunIds.push(created.id);
    const runId = created.id;
    await runService.openRun(lead, runId);
    const picked = await signupService.createBoosterSignup(player, { runId, characterId: charPlayer, role: "HEALER", isBackup: false });
    const leaving = await signupService.createBoosterSignup(multi, { runId, characterId: charMultiA, role: "HEALER", isBackup: false });
    await signupService.withdrawSignup(multi, leaving.id);

    const view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections: [{ signupId: picked.id, selectedRole: "HEALER" }],
    });
    expect((await orm.RunSignup.where({ id: picked.id }).first() as { status: string } | null)?.status).toBe("PENDING");

    // Venomous-only → Bundle: Tide added, Venomous unchanged.
    const base = await runRepository.findById(runId);
    await runService.updateRun(lead, {
      runId,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: base!.scheduledStartAt,
      desiredTankCount: 1,
      desiredHealerCount: 2,
      desiredDpsCount: 1,
      notes: null,
      ...seededProductSelection("MIDNIGHT_S2_BUNDLE", 8),
    });
    let changes = parseRunScopeChanges((await scopeAnnouncements(runId))[0]?.scopeChanges);
    expect(changes.map((change) => change.kind)).toEqual(["ADDED"]);

    // Bundle Venomous 8 → 7: only Venomous reported, Tide unchanged.
    await runService.updateRun(lead, {
      runId,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: base!.scheduledStartAt,
      desiredTankCount: 1,
      desiredHealerCount: 2,
      desiredDpsCount: 1,
      notes: null,
      ...seededProductSelection("MIDNIGHT_S2_BUNDLE", 7),
    });
    const second = (await scopeAnnouncements(runId)).find(
      (row) => row.sourceKey === runScopeChangedChannelSourceKey(runId, 2),
    );
    changes = parseRunScopeChanges(second?.scopeChanges);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "CHANGED", beforePlannedBossCount: 8, afterPlannedBossCount: 7 });

    expect(await scopeNotes(runId, ids.player)).toHaveLength(2);
    expect(await scopeNotes(runId, ids.multi)).toHaveLength(0);
  });

  it("DRAFT Run: scope edit bumps nothing user-facing (no audience, no announcement)", async () => {
    const created = await runService.createRun(
      lead,
      venomousCreateInput({
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        scheduledStartAt: futureIso(50),
        desiredTankCount: 1,
        desiredHealerCount: 2,
        desiredDpsCount: 1,
      }),
    );
    createdRunIds.push(created.id);
    const draft = await runRepository.findById(created.id);
    expect(draft?.status).toBe("DRAFT");
    await runService.updateRun(lead, {
      runId: created.id,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: draft!.scheduledStartAt,
      desiredTankCount: 1,
      desiredHealerCount: 2,
      desiredDpsCount: 1,
      notes: null,
      ...seededProductSelection("VENOMOUS_ABYSS", 5),
    });
    expect(await scopeAnnouncements(created.id)).toHaveLength(0);
    expect(await orm.UserNotification.where({ runId: created.id, type: "RUN_SCOPE_CHANGED" }).all()).toHaveLength(0);
  });
});

describe("Run edit notification atomicity", () => {
  async function openRunWithSignups(daysAhead: number) {
    const created = await runService.createRun(
      lead,
      venomousCreateInput({
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        scheduledStartAt: futureIso(daysAhead),
        desiredTankCount: 1,
        desiredHealerCount: 2,
        desiredDpsCount: 1,
      }),
    );
    createdRunIds.push(created.id);
    await runService.openRun(lead, created.id);
    await signupService.createBoosterSignup(player, { runId: created.id, characterId: charPlayer, role: "HEALER", isBackup: false });
    await signupService.createBoosterSignup(multi, { runId: created.id, characterId: charMultiA, role: "HEALER", isBackup: false });
    await signupService.createBoosterSignup(multi, { runId: created.id, characterId: charMultiB, role: "HEALER", isBackup: false });
    return created.id;
  }

  const edit = (runId: string, scheduledStartAt: string, venomous: number, hooks = {}) =>
    runService.updateRun(
      lead,
      {
        runId,
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        scheduledStartAt,
        desiredTankCount: 1,
        desiredHealerCount: 2,
        desiredDpsCount: 1,
        notes: null,
        ...seededProductSelection("VENOMOUS_ABYSS", venomous),
      },
      hooks,
    );

  async function notesOf(runId: string, type: "RUN_RESCHEDULED" | "RUN_SCOPE_CHANGED") {
    return (await orm.UserNotification.where({ runId, type }).all()) as Array<{
      userId: string;
      sourceKey: string;
      discordDeliveryStatus: string;
      discordDeliverAfter: string | null;
    }>;
  }
  async function announcementsOf(runId: string, type: "RUN_RESCHEDULED" | "RUN_SCOPE_CHANGED") {
    return (await orm.RunDiscordAnnouncement.where({ runId, type }).all()) as Array<{ sourceKey: string }>;
  }

  it("reschedule: a failure just before commit rolls back Run, revision, announcement and UserNotifications together", async () => {
    const runId = await openRunWithSignups(60);
    const before = await runRepository.findById(runId);
    const moved = new Date(Date.parse(before!.scheduledStartAt) + 90 * 60 * 1000).toISOString();

    await expect(edit(runId, moved, 8, { failBeforeCommit: true })).rejects.toThrow(/TEST_HOOK_FAIL_BEFORE_COMMIT/);
    const rolledBack = await runRepository.findById(runId);
    expect(Date.parse(rolledBack!.scheduledStartAt)).toBe(Date.parse(before!.scheduledStartAt));
    expect(rolledBack?.scheduleRevision).toBe(0);
    expect(await announcementsOf(runId, "RUN_RESCHEDULED")).toHaveLength(0);
    expect(await notesOf(runId, "RUN_RESCHEDULED")).toHaveLength(0);

    await edit(runId, moved, 8);
    const committed = await runRepository.findById(runId);
    expect(committed?.scheduleRevision).toBe(1);
    expect((await announcementsOf(runId, "RUN_RESCHEDULED")).map((row) => row.sourceKey)).toEqual([
      runRescheduledChannelSourceKey(runId, 1),
    ]);
    const notes = await notesOf(runId, "RUN_RESCHEDULED");
    // One per User (multi has two Characters), same revision as the announcement.
    expect(notes.map((row) => row.userId).sort()).toEqual([ids.multi, ids.player].sort());
    expect(notes.every((row) => row.sourceKey.startsWith(`run-rescheduled:${runId}:1:`))).toBe(true);

    // Repeat the same request (no schedule change) → nothing new.
    await edit(runId, committed!.scheduledStartAt, 8);
    expect(await notesOf(runId, "RUN_RESCHEDULED")).toHaveLength(2);
  });

  it("scope 8/8 → 6/8: a failure just before commit rolls back contents, contentRevision, announcement and UserNotifications", async () => {
    const runId = await openRunWithSignups(70);
    const before = await runRepository.findById(runId);
    const plannedBefore = (await runRepository.listRaidContents(runId)).map((row) => row.plannedBossCount);

    await expect(edit(runId, before!.scheduledStartAt, 6, { failBeforeCommit: true })).rejects.toThrow(
      /TEST_HOOK_FAIL_BEFORE_COMMIT/,
    );
    expect((await runRepository.listRaidContents(runId)).map((row) => row.plannedBossCount)).toEqual(plannedBefore);
    expect((await runRepository.findById(runId))?.contentRevision).toBe(0);
    expect(await announcementsOf(runId, "RUN_SCOPE_CHANGED")).toHaveLength(0);
    expect(await notesOf(runId, "RUN_SCOPE_CHANGED")).toHaveLength(0);

    await edit(runId, before!.scheduledStartAt, 6);
    expect((await runRepository.findById(runId))?.contentRevision).toBe(1);
    expect((await announcementsOf(runId, "RUN_SCOPE_CHANGED")).map((row) => row.sourceKey)).toEqual([
      runScopeChangedChannelSourceKey(runId, 1),
    ]);
    const notes = await notesOf(runId, "RUN_SCOPE_CHANGED");
    expect(notes.map((row) => row.userId).sort()).toEqual([ids.multi, ids.player].sort());
    expect(notes.every((row) => row.sourceKey.startsWith(`run-scope-changed:${runId}:1:`))).toBe(true);

    // 6/8 → 6/8: nothing created.
    await edit(runId, before!.scheduledStartAt, 6);
    expect(await notesOf(runId, "RUN_SCOPE_CHANGED")).toHaveLength(2);
    expect(await announcementsOf(runId, "RUN_SCOPE_CHANGED")).toHaveLength(1);
  });

  it("a failing UserNotification write rolls back the whole Run edit (no committed change without its DM intent)", async () => {
    const runId = await openRunWithSignups(100);
    const before = await runRepository.findById(runId);
    const moved = new Date(Date.parse(before!.scheduledStartAt) + 60 * 60 * 1000).toISOString();
    const spy = vi.spyOn(userNotificationRepository, "createInTx").mockRejectedValueOnce(new Error("NOTIFICATION_WRITE_FAILED"));
    try {
      await expect(edit(runId, moved, 6)).rejects.toThrow(/NOTIFICATION_WRITE_FAILED/);
    } finally {
      spy.mockRestore();
    }
    const after = await runRepository.findById(runId);
    expect(Date.parse(after!.scheduledStartAt)).toBe(Date.parse(before!.scheduledStartAt));
    expect(after?.scheduleRevision).toBe(0);
    expect(after?.contentRevision).toBe(0);
    expect((await runRepository.listRaidContents(runId)).map((row) => row.plannedBossCount)).toEqual([8]);
    expect(await announcementsOf(runId, "RUN_RESCHEDULED")).toHaveLength(0);
    expect(await announcementsOf(runId, "RUN_SCOPE_CHANGED")).toHaveLength(0);
    expect(await notesOf(runId, "RUN_RESCHEDULED")).toHaveLength(0);
    expect(await notesOf(runId, "RUN_SCOPE_CHANGED")).toHaveLength(0);
  });

  it("recipients are the signups at commit time: a later withdrawal keeps its notification, a later signup gets none", async () => {
    const runId = await openRunWithSignups(80);
    const before = await runRepository.findById(runId);
    await edit(runId, before!.scheduledStartAt, 7);
    expect((await notesOf(runId, "RUN_SCOPE_CHANGED")).map((row) => row.userId).sort()).toEqual(
      [ids.multi, ids.player].sort(),
    );

    const playerSignup = (await orm.RunSignup.where({ runId, userId: ids.player }).first()) as { id: string };
    await signupService.withdrawSignup(player, playerSignup.id);
    await signupService.createBoosterSignup(lead, { runId, characterId: charLeadTank, role: "TANK", isBackup: false });

    const notes = await notesOf(runId, "RUN_SCOPE_CHANGED");
    expect(notes.map((row) => row.userId).sort()).toEqual([ids.multi, ids.player].sort());
  });

  it("preferences and Quiet Hours are snapshotted exactly as before", async () => {
    await orm.User.where({ id: ids.player }).update({ dmRunRescheduledEnabled: false });
    await orm.User.where({ id: ids.multi }).update({
      discordDmQuietHoursEnabled: true,
      discordDmQuietHoursStart: "00:00",
      discordDmQuietHoursEnd: "23:59",
    });
    try {
      const runId = await openRunWithSignups(90);
      const before = await runRepository.findById(runId);
      await edit(runId, before!.scheduledStartAt, 5);
      const notes = await notesOf(runId, "RUN_SCOPE_CHANGED");
      const playerNote = notes.find((row) => row.userId === ids.player);
      const multiNote = notes.find((row) => row.userId === ids.multi);
      expect(playerNote?.discordDeliveryStatus).toBe("SKIPPED");
      expect(multiNote?.discordDeliveryStatus).toBe("PENDING");
      expect(multiNote?.discordDeliverAfter).not.toBeNull();
    } finally {
      await orm.User.where({ id: ids.player }).update({ dmRunRescheduledEnabled: true });
      await orm.User.where({ id: ids.multi }).update({
        discordDmQuietHoursEnabled: false,
        discordDmQuietHoursStart: null,
        discordDmQuietHoursEnd: null,
      });
    }
  });
});

async function runLifecycleRetry(runId: string, contentRevision: number, changes: ReturnType<typeof parseRunScopeChanges>) {
  const { createRunScopeChangedNotificationsInTx } = await import("@/services/run-lifecycle-notifications.service");
  const { db } = await import("@/lib/prisma");
  const run = await runRepository.findById(runId);
  await db.transaction(async (tx) => {
    const txOrm = ((tx.orm as { public?: typeof orm }).public ?? (tx.orm as unknown as typeof orm)) as typeof orm;
    await createRunScopeChangedNotificationsInTx(txOrm, {
      runId,
      productLabel: run!.contentDisplay.productLabel,
      scheduledStartAt: run!.scheduledStartAt,
      contentRevision,
      changes,
    });
  });
}
