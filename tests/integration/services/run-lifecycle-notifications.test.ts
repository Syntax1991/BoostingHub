import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { venomousCreateInput, seededProductSelection } from "@tests/fixtures/test-run-input";
import { ACTIVE_SIGNUP_STATUSES } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import {
  runCancelledSourceKey,
  runReactivatedSourceKey,
  runRescheduledSourceKey,
  runScopeChangedSourceKey,
  userNotificationRepository,
} from "@/repositories/user-notification.repository";
import {
  runCancelledChannelSourceKey,
  runReactivatedChannelSourceKey,
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
import { offerCharacter, offerCharacters } from "@tests/helpers/signup-offers";
import { testActor } from "@tests/fixtures/actors";
import {
  assertIsolatedTestDatabase,
  createTestCharacter,
  createTestUser,
  deleteCreatedRows,
  syntheticDiscordId,
} from "@tests/fixtures/db-fixtures";
import { freezeSystemTime, RAID_WEEK_TEST_CLOCK, restoreSystemTime } from "@tests/fixtures/time";
import { expectDomainError } from "@tests/helpers/domain-error";

const owned = { runIds: [] as string[], characterIds: [] as string[], userIds: [] as string[] };
const playerDiscordId = syntheticDiscordId();
const multiDiscordId = syntheticDiscordId();

let lead: AuthenticatedUser;
let player: AuthenticatedUser;
let multi: AuthenticatedUser;

let scheduleSlot = 0;
function futureIso(days = 14) {
  const slot = scheduleSlot++;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000 + slot * 3 * 60 * 60 * 1000).toISOString();
}

async function createUser(
  name: string,
  accountRole: AuthenticatedUser["accountRole"],
  options: { discordUserId?: string; isBooster?: boolean } = {},
) {
  const id = await createTestUser({
    name,
    accountRole,
    discordUserId: options.discordUserId ?? null,
    discordUsername: options.discordUserId ? `u${options.discordUserId}` : null,
    isBooster: options.isBooster ?? false,
  });
  owned.userIds.push(id);
  await orm.User.where({ id }).update({
    discordDmEnabled: true,
    dmRosterSelectedEnabled: true,
    dmRaidInviteEnabled: true,
    dmRunCancelledEnabled: true,
    dmRunRescheduledEnabled: true,
    dmRosterRemovedEnabled: true,
    timeZone: "Europe/Berlin",
  });
  return testActor(id, accountRole, {
    name,
    discordUserId: options.discordUserId ?? null,
    discordUsername: options.discordUserId ? `u${options.discordUserId}` : null,
  });
}

async function createCharacter(input: {
  userId: string;
  name: string;
  wowClass: "SHAMAN" | "PALADIN" | "HUNTER" | "PRIEST" | "MONK";
  specialization: string;
  primaryRole: CharacterRole;
}) {
  const id = await createTestCharacter({
    userId: input.userId,
    name: input.name,
    realm: "Notify Lifecycle",
    wowClass: input.wowClass,
    specialization: input.specialization,
    primaryRole: input.primaryRole,
  });
  owned.characterIds.push(id);
  return id;
}

/** The Raid Lead's Characters are signed up automatically when a Run is created. */
async function leadSignup(runId: string, characterId: string): Promise<{ id: string }> {
  const row = (await orm.RunSignup.where({
    runId,
    userId: lead.id,
    characterId,
    participationType: "BOOSTER",
  }).first()) as { id: string } | null;
  if (!row) throw new Error("expected the Raid Lead bootstrap signup");
  return { id: row.id };
}

let charPlayer = "";
let charMultiA = "";
let charMultiB = "";
let charLeadTank = "";
let charLeadDps = "";

beforeAll(() => freezeSystemTime(RAID_WEEK_TEST_CLOCK, { advance: true }));
afterAll(() => restoreSystemTime());

beforeAll(async () => {
  assertIsolatedTestDatabase();
  await raidRepository.ensureReferenceRaids();
  lead = await createUser("Lifecycle Lead", "RAID_LEAD", { isBooster: true });
  player = await createUser("Lifecycle Player", "USER", {
    discordUserId: playerDiscordId,
    isBooster: true,
  });
  multi = await createUser("Lifecycle Multi", "USER", {
    discordUserId: multiDiscordId,
    isBooster: true,
  });
  charPlayer = await createCharacter({
    userId: player.id,
    name: "LifeA",
    wowClass: "SHAMAN",
    specialization: "Restoration",
    primaryRole: "HEALER",
  });
  charMultiA = await createCharacter({
    userId: multi.id,
    name: "LifeB",
    wowClass: "PALADIN",
    specialization: "Holy",
    primaryRole: "HEALER",
  });
  charMultiB = await createCharacter({
    userId: multi.id,
    name: "LifeC",
    wowClass: "PRIEST",
    specialization: "Holy",
    primaryRole: "HEALER",
  });
  charLeadTank = await createCharacter({
    userId: lead.id,
    name: "LifeTank",
    wowClass: "PALADIN",
    specialization: "Protection",
    primaryRole: "TANK",
  });
  charLeadDps = await createCharacter({
    userId: lead.id,
    name: "LifeDps",
    wowClass: "HUNTER",
    specialization: "Beast Mastery",
    primaryRole: "RANGED_DPS",
  });
}, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => deleteCreatedRows(owned), 60_000);

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
    owned.runIds.push(created.id);
    await runService.openRun(lead, created.id);

    // The Raid Lead's two Characters were signed up when the Run was created.
    await leadSignup(created.id, charLeadTank);
    await leadSignup(created.id, charLeadDps);
    await offerCharacter(player, created.id, charPlayer, "HEALER");
    await offerCharacters(multi, created.id, [
      { characterId: charMultiA, roles: ["HEALER"] },
      { characterId: charMultiB, roles: ["HEALER"] },
    ]);

    const multiSignups = await orm.RunSignup.where({ runId: created.id, userId: multi.id }).all();
    expect(multiSignups.length).toBe(2);
    for (const row of multiSignups) {
      expect((ACTIVE_SIGNUP_STATUSES as readonly string[]).includes(String((row as { status: string }).status))).toBe(
        true,
      );
    }

    await runService.cancelRun(lead, created.id);

    const playerNotes = (await userNotificationRepository.listForUser(player.id, 20)).filter(
      (row) => row.runId === created.id && row.type === "RUN_CANCELLED",
    );
    expect(playerNotes).toHaveLength(1);
    expect(playerNotes[0].sourceKey).toBe(runCancelledSourceKey(created.id, 1, player.id));
    expect(playerNotes[0].discordDeliveryStatus).toBe("PENDING");

    const multiNotes = (await userNotificationRepository.listForUser(multi.id, 20)).filter(
      (row) => row.runId === created.id && row.type === "RUN_CANCELLED",
    );
    expect(multiNotes).toHaveLength(1);

    await expectDomainError(runService.cancelRun(lead, created.id), "RUN_CANNOT_CANCEL");
    const retry = (await userNotificationRepository.listForUser(player.id, 20)).filter(
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
    owned.runIds.push(created.id);
    await runService.openRun(lead, created.id);
    await offerCharacter(player, created.id, charPlayer, "HEALER");

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
    const notes = (await userNotificationRepository.listForUser(player.id, 20)).filter(
      (row) => row.runId === created.id && row.type === "RUN_RESCHEDULED",
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].sourceKey).toBe(runRescheduledSourceKey(created.id, 1, player.id));
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
      (await userNotificationRepository.listForUser(player.id, 20)).filter(
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
      (await userNotificationRepository.listForUser(player.id, 20)).filter(
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
    owned.runIds.push(created.id);
    const runId = created.id;
    await runService.openRun(lead, runId);

    const tank = await leadSignup(runId, charLeadTank);
    await offerCharacter(player, runId, charPlayer, "HEALER");
    const [multiAId] = await offerCharacters(multi, runId, [
      { characterId: charMultiA, roles: ["HEALER"] },
      { characterId: charMultiB, roles: ["HEALER"] },
    ]);

    let view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections: [
        { signupId: tank.id, selectedRole: "TANK" },
        { signupId: multiAId, selectedRole: "HEALER" },
      ],
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, { runId, version: view.roster.version, acknowledgeWarnings: true });
    const statuses = (await orm.RunSignup.where({ runId }).all()) as Array<{ userId: string; status: string }>;
    expect(statuses.find((row) => row.userId === player.id)?.status).toBe("NOT_SELECTED");
    expect(statuses.filter((row) => row.userId === multi.id).map((row) => row.status).sort()).toEqual([
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
    for (const userId of [lead.id, player.id, multi.id]) {
      const notes = await scopeNotes(runId, userId);
      expect(notes).toHaveLength(1);
      expect(notes[0].sourceKey).toBe(runScopeChangedSourceKey(runId, 1, userId));
      expect(notes[0].message).toMatch(/8\/8 → 6\/8 bosses/);
    }
    // Player + multi have a Discord id → DM queued; lead has none → SKIPPED.
    expect((await scopeNotes(runId, player.id))[0].discordDeliveryStatus).toBe("PENDING");
    expect((await scopeNotes(runId, lead.id))[0].discordDeliveryStatus).toBe("SKIPPED");

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
      (item) => item.type === "RUN_SCOPE_CHANGED" && item.runId === runId && item.discordUserId === playerDiscordId,
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
    expect(await scopeNotes(runId, player.id)).toHaveLength(1);
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
    const playerNotes = await scopeNotes(runId, player.id);
    expect(playerNotes).toHaveLength(2);
    expect(playerNotes.some((row) => /6\/8 → 8\/8 bosses/.test(row.message))).toBe(true);

    // Retrying the notify step for the same revision creates nothing new.
    await runLifecycleRetry(runId, 2, changes);
    expect(await scopeNotes(runId, player.id)).toHaveLength(2);
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
    owned.runIds.push(created.id);
    const runId = created.id;
    await runService.openRun(lead, runId);
    const pickedId = await offerCharacter(player, runId, charPlayer, "HEALER");
    const leavingId = await offerCharacter(multi, runId, charMultiA, "HEALER");
    await signupService.withdrawSignup(multi, leavingId);

    const view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections: [{ signupId: pickedId, selectedRole: "HEALER" }],
    });
    expect((await orm.RunSignup.where({ id: pickedId }).first() as { status: string } | null)?.status).toBe("PENDING");

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

    expect(await scopeNotes(runId, player.id)).toHaveLength(2);
    expect(await scopeNotes(runId, multi.id)).toHaveLength(0);
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
    owned.runIds.push(created.id);
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
    owned.runIds.push(created.id);
    await runService.openRun(lead, created.id);
    // Only player + multi signed up: the Raid Lead withdraws the offers created with the Run.
    for (const characterId of [charLeadTank, charLeadDps]) {
      await signupService.withdrawSignup(lead, (await leadSignup(created.id, characterId)).id);
    }
    await offerCharacter(player, created.id, charPlayer, "HEALER");
    await offerCharacters(multi, created.id, [
      { characterId: charMultiA, roles: ["HEALER"] },
      { characterId: charMultiB, roles: ["HEALER"] },
    ]);
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
    expect(notes.map((row) => row.userId).sort()).toEqual([multi.id, player.id].sort());
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
    expect(notes.map((row) => row.userId).sort()).toEqual([multi.id, player.id].sort());
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
      [multi.id, player.id].sort(),
    );

    const playerSignup = (await orm.RunSignup.where({ runId, userId: player.id }).first()) as { id: string };
    await signupService.withdrawSignup(player, playerSignup.id);
    await offerCharacter(lead, runId, charLeadTank, "TANK");

    const notes = await notesOf(runId, "RUN_SCOPE_CHANGED");
    expect(notes.map((row) => row.userId).sort()).toEqual([multi.id, player.id].sort());
  });

  it("preferences and Quiet Hours are snapshotted exactly as before", async () => {
    await orm.User.where({ id: player.id }).update({ dmRunRescheduledEnabled: false });
    await orm.User.where({ id: multi.id }).update({
      discordDmQuietHoursEnabled: true,
      discordDmQuietHoursStart: "00:00",
      discordDmQuietHoursEnd: "23:59",
    });
    try {
      const runId = await openRunWithSignups(90);
      const before = await runRepository.findById(runId);
      await edit(runId, before!.scheduledStartAt, 5);
      const notes = await notesOf(runId, "RUN_SCOPE_CHANGED");
      const playerNote = notes.find((row) => row.userId === player.id);
      const multiNote = notes.find((row) => row.userId === multi.id);
      expect(playerNote?.discordDeliveryStatus).toBe("SKIPPED");
      expect(multiNote?.discordDeliveryStatus).toBe("PENDING");
      expect(multiNote?.discordDeliverAfter).not.toBeNull();
    } finally {
      await orm.User.where({ id: player.id }).update({ dmRunRescheduledEnabled: true });
      await orm.User.where({ id: multi.id }).update({
        discordDmQuietHoursEnabled: false,
        discordDmQuietHoursStart: null,
        discordDmQuietHoursEnd: null,
      });
    }
  });
});

describe("Cancel / Reactivate notification atomicity", () => {
  /**
   * Published Run: lead tank + player healer SELECTED, multi's two healers
   * NOT_SELECTED (excluded from the cancel audience, as before).
   */
  async function publishedRun(daysAhead: number) {
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
    owned.runIds.push(created.id);
    const runId = created.id;
    await runService.openRun(lead, runId);
    const tank = await leadSignup(runId, charLeadTank);
    const healId = await offerCharacter(player, runId, charPlayer, "HEALER");
    await offerCharacters(multi, runId, [
      { characterId: charMultiA, roles: ["HEALER"] },
      { characterId: charMultiB, roles: ["HEALER"] },
    ]);
    let view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections: [
        { signupId: tank.id, selectedRole: "TANK" },
        { signupId: healId, selectedRole: "HEALER" },
      ],
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, { runId, version: view.roster.version, acknowledgeWarnings: true });
    return runId;
  }

  async function notes(runId: string, type: "RUN_CANCELLED" | "RUN_REACTIVATED") {
    return (await orm.UserNotification.where({ runId, type }).all()) as Array<{
      userId: string;
      sourceKey: string;
      discordDeliveryStatus: string;
      discordDeliverAfter: string | null;
    }>;
  }
  async function announcements(runId: string, type: "RUN_CANCELLED" | "RUN_REACTIVATED") {
    return (await orm.RunDiscordAnnouncement.where({ runId, type }).all()) as Array<{ sourceKey: string; status: string }>;
  }

  it("cancel: a failing UserNotification write rolls back the cancellation (status, revision, announcement, rows)", async () => {
    const runId = await publishedRun(110);
    const spy = vi.spyOn(userNotificationRepository, "createInTx").mockRejectedValueOnce(new Error("NOTIFICATION_WRITE_FAILED"));
    try {
      await expect(runService.cancelRun(lead, runId)).rejects.toThrow(/NOTIFICATION_WRITE_FAILED/);
    } finally {
      spy.mockRestore();
    }
    const run = await runRepository.findById(runId);
    expect(run?.status).toBe("PUBLISHED");
    expect(run?.cancelRevision).toBe(0);
    expect(run?.cancelledFromStatus).toBeNull();
    expect(await announcements(runId, "RUN_CANCELLED")).toHaveLength(0);
    expect(await notes(runId, "RUN_CANCELLED")).toHaveLength(0);

    await expect(runService.cancelRun(lead, runId, { failBeforeCommit: true })).rejects.toThrow(/TEST_HOOK_FAIL_BEFORE_COMMIT/);
    expect((await runRepository.findById(runId))?.status).toBe("PUBLISHED");
    expect(await announcements(runId, "RUN_CANCELLED")).toHaveLength(0);
    expect(await notes(runId, "RUN_CANCELLED")).toHaveLength(0);
  });

  it("cancel success commits CANCELLED + announcement + one RUN_CANCELLED per active User; preferences / Quiet Hours unchanged", async () => {
    await orm.User.where({ id: player.id }).update({
      discordDmQuietHoursEnabled: true,
      discordDmQuietHoursStart: "00:00",
      discordDmQuietHoursEnd: "23:59",
    });
    try {
      const runId = await publishedRun(120);
      await runService.cancelRun(lead, runId);
      const run = await runRepository.findById(runId);
      expect(run?.status).toBe("CANCELLED");
      expect(run?.cancelRevision).toBe(1);
      expect((await announcements(runId, "RUN_CANCELLED")).map((row) => row.sourceKey)).toEqual([
        runCancelledChannelSourceKey(runId, 1),
      ]);
      const rows = await notes(runId, "RUN_CANCELLED");
      // SELECTED lead + player; multi is NOT_SELECTED → not in the cancel audience (unchanged).
      expect(rows.map((row) => row.userId).sort()).toEqual([lead.id, player.id].sort());
      expect(rows.map((row) => row.sourceKey).sort()).toEqual(
        [runCancelledSourceKey(runId, 1, lead.id), runCancelledSourceKey(runId, 1, player.id)].sort(),
      );
      const playerRow = rows.find((row) => row.userId === player.id)!;
      expect(playerRow.discordDeliveryStatus).toBe("PENDING");
      expect(playerRow.discordDeliverAfter).not.toBeNull();
      // Lead has no Discord identity → SKIPPED, as before.
      expect(rows.find((row) => row.userId === lead.id)?.discordDeliveryStatus).toBe("SKIPPED");
    } finally {
      await orm.User.where({ id: player.id }).update({
        discordDmQuietHoursEnabled: false,
        discordDmQuietHoursStart: null,
        discordDmQuietHoursEnd: null,
      });
    }
  });

  it("reactivate: a failing write rolls back status, announcement, rows AND the retirement of pending cancel DMs", async () => {
    const runId = await publishedRun(130);
    await runService.cancelRun(lead, runId);
    const cancelBefore = await notes(runId, "RUN_CANCELLED");
    expect(cancelBefore.find((row) => row.userId === player.id)?.discordDeliveryStatus).toBe("PENDING");

    const spy = vi.spyOn(userNotificationRepository, "createInTx").mockRejectedValueOnce(new Error("NOTIFICATION_WRITE_FAILED"));
    try {
      await expect(runService.reactivateRun(lead, runId)).rejects.toThrow(/NOTIFICATION_WRITE_FAILED/);
    } finally {
      spy.mockRestore();
    }
    const run = await runRepository.findById(runId);
    expect(run?.status).toBe("CANCELLED");
    expect(run?.cancelledFromStatus).toBe("PUBLISHED");
    expect(await announcements(runId, "RUN_REACTIVATED")).toHaveLength(0);
    expect(await notes(runId, "RUN_REACTIVATED")).toHaveLength(0);
    expect((await announcements(runId, "RUN_CANCELLED"))[0]?.status).toBe("PENDING");
    expect((await notes(runId, "RUN_CANCELLED")).find((row) => row.userId === player.id)?.discordDeliveryStatus).toBe(
      "PENDING",
    );
  });

  it("reactivate success commits the restored status + announcement + RUN_REACTIVATED rows and retires undelivered cancel DMs; a second cancel retires undelivered reactivate DMs", async () => {
    const runId = await publishedRun(140);
    await runService.cancelRun(lead, runId);
    await runService.reactivateRun(lead, runId);

    const run = await runRepository.findById(runId);
    expect(run?.status).toBe("PUBLISHED");
    expect((await announcements(runId, "RUN_REACTIVATED")).map((row) => row.sourceKey)).toEqual([
      runReactivatedChannelSourceKey(runId, 1),
    ]);
    const reactivated = await notes(runId, "RUN_REACTIVATED");
    expect(reactivated.map((row) => row.userId).sort()).toEqual([lead.id, player.id].sort());
    expect(reactivated.find((row) => row.userId === player.id)?.sourceKey).toBe(
      runReactivatedSourceKey(runId, 1, player.id),
    );
    expect((await notes(runId, "RUN_CANCELLED")).find((row) => row.userId === player.id)?.discordDeliveryStatus).toBe(
      "SKIPPED",
    );

    // Cancel again (revision 2): the still-PENDING reactivate DM is retired, new cancel rows use revision 2.
    await runService.cancelRun(lead, runId);
    expect((await notes(runId, "RUN_REACTIVATED")).find((row) => row.userId === player.id)?.discordDeliveryStatus).toBe(
      "SKIPPED",
    );
    const cancelled = await notes(runId, "RUN_CANCELLED");
    expect(cancelled.filter((row) => row.sourceKey.startsWith(`run-cancelled:${runId}:2:`))).toHaveLength(2);
    expect(cancelled).toHaveLength(4);
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
