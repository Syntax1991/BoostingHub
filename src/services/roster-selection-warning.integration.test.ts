import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError, RosterWarningConfirmationRequiredError } from "@/lib/errors";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { venomousCreateInput, seededProductSelection } from "@/lib/test-run-input";
import { TIDEBOUND_GROTTO_RAID_ID, VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import type { CharacterRole, WowClass } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { rosterRepository } from "@/repositories/roster.repository";
import { runRepository } from "@/repositories/run.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { attendanceService } from "@/services/attendance.service";
import { lockoutService } from "@/services/lockout.service";
import { rosterBuilderService } from "@/services/roster-builder.service";
import { rosterService } from "@/services/roster.service";
import type {
  ConfirmedRosterWarning,
  RosterSelectionRisk,
  RosterWarningAcknowledgement,
} from "@/services/roster-selection-risk";
import { runService } from "@/services/run.service";

/**
 * Saved / Lockout Pick Confirmation, end to end against the real services:
 *
 *   CLEAN   → selects normally
 *   WARNING → known saved / fully-saved lockout on a fresh-loot Run; a NEW pick
 *             needs a server-validated acknowledgement (type + fingerprint)
 *   BLOCKED → schedule conflict (PR #218 reservation, weekly unavailable);
 *             no acknowledgement can ever lift it
 *
 * across every write path that can introduce a Character: Save Roster,
 * Add Player, Auto Build Apply, Update Roster (published) and the post-start
 * participant replacement (reservation invariant only).
 */

const ids = {
  lead: "dddddddd-dddd-4ddd-8ddd-rw0000000001",
  leadB: "dddddddd-dddd-4ddd-8ddd-rw0000000002",
  playerSavedA: "dddddddd-dddd-4ddd-8ddd-rw0000000003",
  playerClean: "dddddddd-dddd-4ddd-8ddd-rw0000000004",
  playerSavedB: "dddddddd-dddd-4ddd-8ddd-rw0000000005",
};
const createdUserIds = Object.values(ids);
const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];

const REALM = "Warning Lab";

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@rwarn.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function createTestUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]) {
  await orm.User.create({
    id,
    name,
    email: `${id}@rwarn.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function deleteIfPresent(table: string, id: string) {
  try {
    if (table === "User") await orm.User.where({ id }).delete();
    else if (table === "Character") await orm.Character.where({ id }).delete();
    else if (table === "RunSignupRole") await orm.RunSignupRole.where({ id }).delete();
    else if (table === "RunSignup") await orm.RunSignup.where({ id }).delete();
    else if (table === "RunAttendance") await orm.RunAttendance.where({ id }).delete();
    else if (table === "Run") await orm.Run.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

async function createCharacter(input: {
  userId: string;
  name: string;
  wowClass: WowClass;
  specialization: string;
  primaryRole: CharacterRole;
}) {
  const id = crypto.randomUUID();
  createdCharacterIds.push(id);
  const now = new Date().toISOString();
  await orm.Character.create({
    id,
    userId: input.userId,
    name: input.name,
    realm: REALM,
    normalizedName: normalizeCharacterIdentity(input.name),
    normalizedRealm: normalizeCharacterIdentity(REALM),
    region: "EU",
    wowClass: input.wowClass,
    specialization: input.specialization,
    primaryRole: input.primaryRole,
    itemLevel: 700,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function cleanupRun(runId: string) {
  const attendance = await orm.RunAttendance.where({ runId }).select("id").all();
  for (const row of attendance) {
    await deleteIfPresent("RunAttendance", (row as { id: string }).id);
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
    const roles = await orm.RunSignupRole.where({ signupId }).select("id").all();
    for (const role of roles) {
      await deleteIfPresent("RunSignupRole", (role as { id: string }).id);
    }
    await deleteIfPresent("RunSignup", signupId);
  }
  await deleteIfPresent("Run", runId);
}

/**
 * Every scenario gets its own raid week (Saturday 18:00 UTC, well inside an EU
 * reset window), so lockout rows — unique per Character/raid/difficulty/reset —
 * never leak from one scenario into another. Runs created with the SAME slot
 * start at the same instant and therefore overlap (cross-Run reservation).
 */
let weekSlot = 0;
function nextRaidWeekStart(): string {
  const base = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
  const daysToSaturday = (6 - base.getUTCDay() + 7) % 7;
  const saturday = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + daysToSaturday, 18, 0, 0),
  );
  const slot = weekSlot++;
  return new Date(saturday.getTime() + slot * 7 * 24 * 60 * 60 * 1000).toISOString();
}

async function createOpenRun(
  runLead: AuthenticatedUser,
  scheduledStartAt: string,
  overrides: Record<string, unknown> = {},
) {
  const id = await runService
    .createRun(runLead, venomousCreateInput({ scheduledStartAt, ...overrides }))
    .then((run) => run.id);
  createdRunIds.push(id);
  await runService.openRun(runLead, id);
  return id;
}

/** Pending BOOSTER signup for a Character on a Run — bypasses offer eligibility. */
async function forcePendingSignup(runId: string, userId: string, characterId: string, role: CharacterRole) {
  const signupId = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.RunSignup.create({
    id: signupId,
    runId,
    userId,
    characterId,
    participationType: "BOOSTER",
    isBackup: false,
    status: "PENDING",
    publishedRole: null,
    lootbuddyMode: null,
    lootbuddyVerification: null,
    createdAt: now,
    updatedAt: now,
  });
  await orm.RunSignupRole.create({ id: crypto.randomUUID(), signupId, role, createdAt: now });
  return signupId;
}

/** Verified lockout row for the Character on the raid week of this Run (HEROIC, EU). */
async function setLockout(
  runId: string,
  characterId: string,
  raidId: string,
  bossesDefeated: number,
  totalBossCount: number,
) {
  const run = await runRepository.findById(runId);
  const resetIdentifier = lockoutService.getResetIdentifierForRun("EU", run!.scheduledStartAt);
  await orm.CharacterRaidLockout.where({ characterId, raidId, difficulty: "HEROIC", resetIdentifier })
    .delete()
    .catch(() => {});
  const now = new Date().toISOString();
  await orm.CharacterRaidLockout.create({
    id: crypto.randomUUID(),
    characterId,
    raidId,
    difficulty: "HEROIC",
    resetIdentifier,
    bossesDefeated,
    isComplete: bossesDefeated >= totalBossCount,
    createdAt: now,
    updatedAt: now,
  });
}

type RiskCard = { id: string; draftSelected: boolean; selectionRisk: RosterSelectionRisk };

async function rosterCard(runLead: AuthenticatedUser, runId: string, signupId: string): Promise<RiskCard> {
  const view = await rosterService.getRosterManagementView(runLead, runId);
  const card = view.boosters.find((item) => item.id === signupId);
  if (!card) throw new Error(`Signup ${signupId} is not a roster candidate.`);
  return card;
}

async function rosterVersion(runLead: AuthenticatedUser, runId: string) {
  return (await rosterService.getRosterManagementView(runLead, runId)).roster.version;
}

/** The Raid Lead's "Select anyway": acknowledges exactly the warnings the roster card shows. */
function confirm(card: RiskCard): ConfirmedRosterWarning[] {
  return card.selectionRisk.warnings.map((warning) => ({
    signupId: card.id,
    type: warning.type,
    fingerprint: warning.fingerprint,
  }));
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to be rejected.");
}

function codeOf(error: unknown): string | null {
  return isDomainError(error) ? error.code : null;
}

/** Hard cross-Run reservation rejection — pre-transaction projection or the locked in-transaction re-read. */
function isReservationReject(error: unknown): boolean {
  const code = codeOf(error);
  return (
    code === "CHARACTER_ALREADY_SELECTED_OTHER_RUN" ||
    code === "CHARACTER_SCHEDULE_CONFLICT" ||
    code === "ROSTER_HAS_SCHEDULE_CONFLICTS"
  );
}

function pendingWarningsOf(error: unknown) {
  expect(error).toBeInstanceOf(RosterWarningConfirmationRequiredError);
  expect(codeOf(error)).toBe("ROSTER_WARNING_CONFIRMATION_REQUIRED");
  return (error as RosterWarningConfirmationRequiredError).pendingWarnings;
}

async function draftSelectedIds(runId: string): Promise<string[]> {
  return (await rosterRepository.findByRunId(runId))?.selectedSignupIds ?? [];
}

const lead = asUser(ids.lead, "Warning Lead", "RAID_LEAD");
const leadB = asUser(ids.leadB, "Warning Lead B", "RAID_LEAD");

/** HUNTER (RANGED_DPS) — the Character that gets lockout progress in most scenarios. */
let savedA = "";
/** MAGE (RANGED_DPS) — never has a verified lockout row (Unknown). */
let clean = "";
/** PRIEST (HEALER) — a second saved Character of another User. */
let savedB = "";

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  for (const userId of createdUserIds) {
    const runs = await orm.Run.where({ raidLeadId: userId }).select("id").all();
    for (const row of runs) {
      await cleanupRun((row as { id: string }).id);
    }
    const signups = await orm.RunSignup.where({ userId }).select("id").all();
    for (const row of signups) {
      const signupId = (row as { id: string }).id;
      const roles = await orm.RunSignupRole.where({ signupId }).select("id").all();
      for (const role of roles) {
        await deleteIfPresent("RunSignupRole", (role as { id: string }).id);
      }
      await deleteIfPresent("RunSignup", signupId);
    }
    const chars = await orm.Character.where({ userId }).select("id").all();
    for (const row of chars) {
      await deleteIfPresent("Character", (row as { id: string }).id);
    }
    await deleteIfPresent("User", userId);
  }

  await createTestUser(ids.lead, "Warning Lead", "RAID_LEAD");
  await createTestUser(ids.leadB, "Warning Lead B", "RAID_LEAD");
  await createTestUser(ids.playerSavedA, "Warning Saved A", "USER");
  await createTestUser(ids.playerClean, "Warning Clean", "USER");
  await createTestUser(ids.playerSavedB, "Warning Saved B", "USER");
  for (const userId of [ids.playerSavedA, ids.playerClean, ids.playerSavedB]) {
    await orm.User.where({ id: userId }).update({ isBooster: true });
  }

  savedA = await createCharacter({
    userId: ids.playerSavedA,
    name: "Rwsaveda",
    wowClass: "HUNTER",
    specialization: "Beast Mastery",
    primaryRole: "RANGED_DPS",
  });
  clean = await createCharacter({
    userId: ids.playerClean,
    name: "Rwclean",
    wowClass: "MAGE",
    specialization: "Fire",
    primaryRole: "RANGED_DPS",
  });
  savedB = await createCharacter({
    userId: ids.playerSavedB,
    name: "Rwsavedb",
    wowClass: "PRIEST",
    specialization: "Holy",
    primaryRole: "HEALER",
  });
}, 60_000);

afterAll(async () => {
  for (const runId of createdRunIds) {
    await cleanupRun(runId);
  }
  for (const id of createdCharacterIds) {
    await orm.CharacterRaidLockout.where({ characterId: id }).delete().catch(() => {});
    await deleteIfPresent("Character", id);
  }
  for (const id of createdUserIds) {
    await deleteIfPresent("User", id);
  }
}, 60_000);

describe("manual roster selection (Save Roster)", () => {
  it("CLEAN: an unverified (Unknown) Character and a verified-unsaved Character select with no confirmation", async () => {
    const runId = await createOpenRun(lead, nextRaidWeekStart());
    const unknownSignup = await forcePendingSignup(runId, ids.playerClean, clean, "RANGED_DPS");
    const unsavedSignup = await forcePendingSignup(runId, ids.playerSavedA, savedA, "RANGED_DPS");
    await setLockout(runId, savedA, VENOMOUS_ABYSS_RAID_ID, 0, 8);

    expect((await rosterCard(lead, runId, unknownSignup)).selectionRisk.level).toBe("CLEAN");
    expect((await rosterCard(lead, runId, unsavedSignup)).selectionRisk.level).toBe("CLEAN");

    await rosterService.saveDraftSelection(lead, {
      runId,
      version: await rosterVersion(lead, runId),
      selections: [
        { signupId: unknownSignup, selectedRole: "RANGED_DPS" },
        { signupId: unsavedSignup, selectedRole: "RANGED_DPS" },
      ],
    });
    expect((await draftSelectedIds(runId)).sort()).toEqual([unknownSignup, unsavedSignup].sort());
  });

  it("WARNING: a saved Character is rejected without acknowledgement — nothing is written — and succeeds with it", async () => {
    const runId = await createOpenRun(lead, nextRaidWeekStart());
    const signupId = await forcePendingSignup(runId, ids.playerSavedA, savedA, "RANGED_DPS");
    await setLockout(runId, savedA, VENOMOUS_ABYSS_RAID_ID, 6, 8);

    const card = await rosterCard(lead, runId, signupId);
    expect(card.selectionRisk.level).toBe("WARNING");
    expect(card.selectionRisk.warnings[0]?.contents).toMatchObject([
      { raidId: VENOMOUS_ABYSS_RAID_ID, kind: "saved", bossesDefeated: 6, totalBossCount: 8 },
    ]);

    const versionBefore = await rosterVersion(lead, runId);
    const rejected = await captureError(
      rosterService.saveDraftSelection(lead, {
        runId,
        version: versionBefore,
        selections: [{ signupId, selectedRole: "RANGED_DPS" }],
      }),
    );
    const pending = pendingWarningsOf(rejected);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      signupId,
      characterId: savedA,
      characterLabel: `Rwsaveda-${REALM}`,
    });
    expect(pending[0]!.warning.fingerprint).toBe(card.selectionRisk.warnings[0]!.fingerprint);
    // Cancel (never sending an acknowledgement) leaves everything untouched.
    expect(await draftSelectedIds(runId)).toEqual([]);
    expect(await rosterVersion(lead, runId)).toBe(versionBefore);

    await rosterService.saveDraftSelection(lead, {
      runId,
      version: versionBefore,
      selections: [{ signupId, selectedRole: "RANGED_DPS" }],
      confirmedWarnings: confirm(card),
    });
    expect(await draftSelectedIds(runId)).toEqual([signupId]);
  });

  it("an acknowledgement addressed to another signup does not cover this one", async () => {
    const runId = await createOpenRun(lead, nextRaidWeekStart());
    const signupId = await forcePendingSignup(runId, ids.playerSavedA, savedA, "RANGED_DPS");
    const otherSignup = await forcePendingSignup(runId, ids.playerClean, clean, "RANGED_DPS");
    await setLockout(runId, savedA, VENOMOUS_ABYSS_RAID_ID, 6, 8);
    const card = await rosterCard(lead, runId, signupId);

    const rejected = await captureError(
      rosterService.saveDraftSelection(lead, {
        runId,
        version: await rosterVersion(lead, runId),
        selections: [{ signupId, selectedRole: "RANGED_DPS" }],
        confirmedWarnings: confirm(card).map((row) => ({ ...row, signupId: otherSignup })),
      }),
    );
    expect(pendingWarningsOf(rejected)).toHaveLength(1);
  });

  it("a changed warning fingerprint requires re-confirmation with the CURRENT state", async () => {
    const runId = await createOpenRun(lead, nextRaidWeekStart());
    const signupId = await forcePendingSignup(runId, ids.playerSavedA, savedA, "RANGED_DPS");
    await setLockout(runId, savedA, VENOMOUS_ABYSS_RAID_ID, 6, 8);
    const confirmedAtSix = confirm(await rosterCard(lead, runId, signupId));

    // The Character kills another boss (next sync) after the Raid Lead confirmed "6/8".
    await setLockout(runId, savedA, VENOMOUS_ABYSS_RAID_ID, 7, 8);

    const rejected = await captureError(
      rosterService.saveDraftSelection(lead, {
        runId,
        version: await rosterVersion(lead, runId),
        selections: [{ signupId, selectedRole: "RANGED_DPS" }],
        confirmedWarnings: confirmedAtSix,
      }),
    );
    const pending = pendingWarningsOf(rejected);
    expect(pending[0]!.warning.contents[0]).toMatchObject({ bossesDefeated: 7, totalBossCount: 8 });
    expect(await draftSelectedIds(runId)).toEqual([]);

    // Re-confirming exactly what the server reported succeeds.
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: await rosterVersion(lead, runId),
      selections: [{ signupId, selectedRole: "RANGED_DPS" }],
      confirmedWarnings: pending.map((row) => ({
        signupId: row.signupId!,
        type: row.warning.type,
        fingerprint: row.warning.fingerprint,
      })),
    });
    expect(await draftSelectedIds(runId)).toEqual([signupId]);
  });

  it("an already selected Character never re-prompts, and deselect needs no confirmation", async () => {
    const runId = await createOpenRun(lead, nextRaidWeekStart());
    const savedSignup = await forcePendingSignup(runId, ids.playerSavedA, savedA, "RANGED_DPS");
    const cleanSignup = await forcePendingSignup(runId, ids.playerClean, clean, "RANGED_DPS");
    await setLockout(runId, savedA, VENOMOUS_ABYSS_RAID_ID, 6, 8);

    await rosterService.saveDraftSelection(lead, {
      runId,
      version: await rosterVersion(lead, runId),
      selections: [{ signupId: savedSignup, selectedRole: "RANGED_DPS" }],
      confirmedWarnings: confirm(await rosterCard(lead, runId, savedSignup)),
    });

    // Re-saving with the saved slot kept (and its lockout even progressing) needs no acknowledgement.
    await setLockout(runId, savedA, VENOMOUS_ABYSS_RAID_ID, 8, 8);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: await rosterVersion(lead, runId),
      selections: [
        { signupId: savedSignup, selectedRole: "RANGED_DPS" },
        { signupId: cleanSignup, selectedRole: "RANGED_DPS" },
      ],
    });
    expect((await draftSelectedIds(runId)).sort()).toEqual([savedSignup, cleanSignup].sort());

    // Deselecting the saved Character needs no confirmation either…
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: await rosterVersion(lead, runId),
      selections: [{ signupId: cleanSignup, selectedRole: "RANGED_DPS" }],
    });
    expect(await draftSelectedIds(runId)).toEqual([cleanSignup]);

    // …but picking it again is a NEW selection and does.
    const again = await captureError(
      rosterService.saveDraftSelection(lead, {
        runId,
        version: await rosterVersion(lead, runId),
        selections: [
          { signupId: cleanSignup, selectedRole: "RANGED_DPS" },
          { signupId: savedSignup, selectedRole: "RANGED_DPS" },
        ],
      }),
    );
    expect(pendingWarningsOf(again)[0]!.warning.contents[0]).toMatchObject({ kind: "fully_saved" });
  });

  it("a SAVED loot-type Run keeps its existing semantics: lockout progress is expected and never prompts", async () => {
    const runId = await createOpenRun(lead, nextRaidWeekStart(), { lootType: "SAVED" });
    const signupId = await forcePendingSignup(runId, ids.playerSavedA, savedA, "RANGED_DPS");
    await setLockout(runId, savedA, VENOMOUS_ABYSS_RAID_ID, 6, 8);

    expect((await rosterCard(lead, runId, signupId)).selectionRisk.level).toBe("CLEAN");
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: await rosterVersion(lead, runId),
      selections: [{ signupId, selectedRole: "RANGED_DPS" }],
    });
    expect(await draftSelectedIds(runId)).toEqual([signupId]);
  });

  it("Bundle Run: each saved RunRaidContent is reported separately (Tidebound 1/1 + Venomous 6/8, never 7/9)", async () => {
    const runId = await createOpenRun(lead, nextRaidWeekStart(), { ...seededProductSelection("MIDNIGHT_S2_BUNDLE"), });
    const run = await runRepository.findById(runId);
    expect(run!.contents.map((content) => content.raidId).sort()).toEqual(
      [TIDEBOUND_GROTTO_RAID_ID, VENOMOUS_ABYSS_RAID_ID].sort(),
    );
    const signupId = await forcePendingSignup(runId, ids.playerSavedA, savedA, "RANGED_DPS");
    await setLockout(runId, savedA, TIDEBOUND_GROTTO_RAID_ID, 1, 1);
    await setLockout(runId, savedA, VENOMOUS_ABYSS_RAID_ID, 6, 8);

    const card = await rosterCard(lead, runId, signupId);
    expect(card.selectionRisk.level).toBe("WARNING");
    expect(card.selectionRisk.warnings).toHaveLength(1);
    const contents = card.selectionRisk.warnings[0]!.contents;
    expect(contents).toHaveLength(2);
    expect(contents.find((content) => content.raidId === TIDEBOUND_GROTTO_RAID_ID)).toMatchObject({
      raidName: "The Tidebound Grotto",
      kind: "fully_saved",
      bossesDefeated: 1,
      totalBossCount: 1,
    });
    expect(contents.find((content) => content.raidId === VENOMOUS_ABYSS_RAID_ID)).toMatchObject({
      raidName: "The Venomous Abyss",
      kind: "saved",
      bossesDefeated: 6,
      totalBossCount: 8,
    });
    // Ordered like the Run's contents.
    const contentOrder = [...run!.contents].sort((a, b) => a.sortOrder - b.sortOrder).map((content) => content.raidId);
    expect(contents.map((content) => content.raidId)).toEqual(contentOrder);

    const rejected = await captureError(
      rosterService.saveDraftSelection(lead, {
        runId,
        version: await rosterVersion(lead, runId),
        selections: [{ signupId, selectedRole: "RANGED_DPS" }],
      }),
    );
    expect(pendingWarningsOf(rejected)[0]!.warning.contents).toHaveLength(2);

    // Confirming only the Venomous state (as if Tidebound had not been shown) is not enough.
    await orm.CharacterRaidLockout.where({ characterId: savedA, raidId: TIDEBOUND_GROTTO_RAID_ID }).delete();
    const venomousOnly = confirm(await rosterCard(lead, runId, signupId));
    await setLockout(runId, savedA, TIDEBOUND_GROTTO_RAID_ID, 1, 1);
    const partial = await captureError(
      rosterService.saveDraftSelection(lead, {
        runId,
        version: await rosterVersion(lead, runId),
        selections: [{ signupId, selectedRole: "RANGED_DPS" }],
        confirmedWarnings: venomousOnly,
      }),
    );
    expect(pendingWarningsOf(partial)[0]!.warning.contents).toHaveLength(2);

    await rosterService.saveDraftSelection(lead, {
      runId,
      version: await rosterVersion(lead, runId),
      selections: [{ signupId, selectedRole: "RANGED_DPS" }],
      confirmedWarnings: confirm(await rosterCard(lead, runId, signupId)),
    });
    expect(await draftSelectedIds(runId)).toEqual([signupId]);
  });
});

describe("Add Player", () => {
  function acknowledge(risk: RosterSelectionRisk): RosterWarningAcknowledgement[] {
    return risk.warnings.map((warning) => ({ type: warning.type, fingerprint: warning.fingerprint }));
  }

  it("surfaces the shared risk on the Character options, rejects an unconfirmed warning and accepts a confirmed one", async () => {
    const runId = await createOpenRun(lead, nextRaidWeekStart());
    await setLockout(runId, savedA, VENOMOUS_ABYSS_RAID_ID, 6, 8);

    const options = await rosterService.getManualAddOptions(lead, { runId, userId: ids.playerSavedA });
    const option = options.eligible.find((item) => item.characterId === savedA);
    expect(option?.selectionRisk.level).toBe("WARNING");
    expect(option?.selectionRisk.warnings[0]?.contents[0]).toMatchObject({
      raidId: VENOMOUS_ABYSS_RAID_ID,
      kind: "saved",
      bossesDefeated: 6,
    });

    const cleanOptions = await rosterService.getManualAddOptions(lead, { runId, userId: ids.playerClean });
    expect(cleanOptions.eligible.find((item) => item.characterId === clean)?.selectionRisk.level).toBe("CLEAN");

    const rejected = await captureError(
      rosterService.addRegisteredParticipant(lead, {
        runId,
        version: await rosterVersion(lead, runId),
        userId: ids.playerSavedA,
        characterId: savedA,
        role: "RANGED_DPS",
      }),
    );
    const pending = pendingWarningsOf(rejected);
    expect(pending[0]).toMatchObject({ signupId: null, characterId: savedA, characterLabel: `Rwsaveda-${REALM}` });
    // Nothing was created: no synthetic signup, no draft slot.
    expect(await signupRepository.listByRunAndUser(runId, ids.playerSavedA)).toHaveLength(0);
    expect(await draftSelectedIds(runId)).toEqual([]);

    const added = await rosterService.addRegisteredParticipant(lead, {
      runId,
      version: await rosterVersion(lead, runId),
      userId: ids.playerSavedA,
      characterId: savedA,
      role: "RANGED_DPS",
      confirmedWarnings: acknowledge(option!.selectionRisk),
    });
    expect(await draftSelectedIds(runId)).toEqual([added.signupId]);

    // A CLEAN Character is added with no acknowledgement at all.
    await rosterService.addRegisteredParticipant(lead, {
      runId,
      version: await rosterVersion(lead, runId),
      userId: ids.playerClean,
      characterId: clean,
      role: "RANGED_DPS",
    });
    expect(await draftSelectedIds(runId)).toHaveLength(2);
  });

  it("BLOCKED: a Character reserved on an overlapping Run cannot be added, with or without acknowledgement", async () => {
    const sched = nextRaidWeekStart();
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(leadB, sched);
    await setLockout(runA, savedA, VENOMOUS_ABYSS_RAID_ID, 6, 8);

    const before = await rosterService.getManualAddOptions(lead, { runId: runA, userId: ids.playerSavedA });
    const acknowledgements = acknowledge(before.eligible.find((item) => item.characterId === savedA)!.selectionRisk);
    expect(acknowledgements).toHaveLength(1);

    // The other Raid Lead reserves the Character on the overlapping Run.
    const signupB = await forcePendingSignup(runB, ids.playerSavedA, savedA, "RANGED_DPS");
    await rosterService.saveDraftSelection(leadB, {
      runId: runB,
      version: await rosterVersion(leadB, runB),
      selections: [{ signupId: signupB, selectedRole: "RANGED_DPS" }],
      confirmedWarnings: confirm(await rosterCard(leadB, runB, signupB)),
    });

    const after = await rosterService.getManualAddOptions(lead, { runId: runA, userId: ids.playerSavedA });
    expect(after.eligible.some((item) => item.characterId === savedA)).toBe(false);
    expect(after.ineligible.some((item) => item.characterId === savedA)).toBe(true);

    const rejected = await captureError(
      rosterService.addRegisteredParticipant(lead, {
        runId: runA,
        version: await rosterVersion(lead, runA),
        userId: ids.playerSavedA,
        characterId: savedA,
        role: "RANGED_DPS",
        confirmedWarnings: acknowledgements,
      }),
    );
    expect(isReservationReject(rejected)).toBe(true);
    expect(await draftSelectedIds(runA)).toEqual([]);
  });
});

describe("Auto Build", () => {
  async function autoBuildRun() {
    const runId = await createOpenRun(lead, nextRaidWeekStart());
    const savedSignup = await forcePendingSignup(runId, ids.playerSavedA, savedA, "RANGED_DPS");
    const cleanSignup = await forcePendingSignup(runId, ids.playerClean, clean, "RANGED_DPS");
    const healerSignup = await forcePendingSignup(runId, ids.playerSavedB, savedB, "HEALER");
    return { runId, savedSignup, cleanSignup, healerSignup };
  }

  function acknowledgeAll(proposal: Awaited<ReturnType<typeof rosterBuilderService.proposeRoster>>) {
    return proposal.warnings.map((row) => ({
      signupId: row.signupId,
      type: row.warning.type,
      fingerprint: row.warning.fingerprint,
    }));
  }

  it("keeps a WARNING candidate eligible and carries structured per-content warnings; CLEAN picks carry none", async () => {
    const { runId, savedSignup, cleanSignup, healerSignup } = await autoBuildRun();
    await setLockout(runId, savedA, VENOMOUS_ABYSS_RAID_ID, 6, 8);

    const proposal = await rosterBuilderService.proposeRoster(lead, runId);
    expect(proposal.applySelections.map((row) => row.signupId).sort()).toEqual(
      [savedSignup, cleanSignup, healerSignup].sort(),
    );
    expect(proposal.warnings).toHaveLength(1);
    expect(proposal.warnings[0]).toMatchObject({
      signupId: savedSignup,
      characterId: savedA,
      characterLabel: `Rwsaveda-${REALM}`,
    });
    expect(proposal.warnings[0]!.warning.contents).toMatchObject([
      { raidId: VENOMOUS_ABYSS_RAID_ID, raidName: "The Venomous Abyss", kind: "saved", bossesDefeated: 6, totalBossCount: 8 },
    ]);
    expect(proposal.proposed.find((row) => row.signupId === savedSignup)?.lockoutAttention).toBe(true);
    expect(proposal.proposed.find((row) => row.signupId === cleanSignup)?.lockoutAttention).toBe(false);

    // Same authority as the roster card — no private Auto Build rule.
    const card = await rosterCard(lead, runId, savedSignup);
    expect(proposal.warnings[0]!.warning.fingerprint).toBe(card.selectionRisk.warnings[0]!.fingerprint);
  });

  it("follows the loot-type semantics of the shared authority: no warning on a SAVED Run, none for Unknown", async () => {
    const runId = await createOpenRun(lead, nextRaidWeekStart(), { lootType: "SAVED" });
    const savedSignup = await forcePendingSignup(runId, ids.playerSavedA, savedA, "RANGED_DPS");
    await forcePendingSignup(runId, ids.playerClean, clean, "RANGED_DPS");
    await setLockout(runId, savedA, VENOMOUS_ABYSS_RAID_ID, 6, 8);

    const proposal = await rosterBuilderService.proposeRoster(lead, runId);
    expect(proposal.warnings).toHaveLength(0);
    expect(proposal.proposed.find((row) => row.signupId === savedSignup)?.lockoutAttention).toBe(false);
  });

  it("excludes a BLOCKED candidate (reserved on an overlapping Run)", async () => {
    const sched = nextRaidWeekStart();
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(leadB, sched);
    const savedOnA = await forcePendingSignup(runA, ids.playerSavedA, savedA, "RANGED_DPS");
    const cleanOnA = await forcePendingSignup(runA, ids.playerClean, clean, "RANGED_DPS");
    const savedOnB = await forcePendingSignup(runB, ids.playerSavedA, savedA, "RANGED_DPS");
    await rosterService.saveDraftSelection(leadB, {
      runId: runB,
      version: await rosterVersion(leadB, runB),
      selections: [{ signupId: savedOnB, selectedRole: "RANGED_DPS" }],
    });

    const proposal = await rosterBuilderService.proposeRoster(lead, runA);
    expect(proposal.applySelections.map((row) => row.signupId)).toEqual([cleanOnA]);
    expect(proposal.applySelections.some((row) => row.signupId === savedOnA)).toBe(false);
    expect(proposal.warnings).toHaveLength(0);
  });

  it("Apply without the aggregate acknowledgement is rejected and writes nothing; with it, the whole proposal is applied", async () => {
    const { runId, savedSignup, cleanSignup, healerSignup } = await autoBuildRun();
    await setLockout(runId, savedA, VENOMOUS_ABYSS_RAID_ID, 6, 8);
    await setLockout(runId, savedB, VENOMOUS_ABYSS_RAID_ID, 8, 8);

    const proposal = await rosterBuilderService.proposeRoster(lead, runId);
    expect(proposal.warnings.map((row) => row.signupId).sort()).toEqual([savedSignup, healerSignup].sort());

    const rejected = await captureError(
      rosterBuilderService.applyRosterProposal(lead, {
        runId,
        expectedVersion: proposal.rosterVersion,
        selections: proposal.applySelections,
      }),
    );
    // ONE rejection listing every pick that needs confirmation — not one per Character.
    expect(pendingWarningsOf(rejected).map((row) => row.signupId).sort()).toEqual([savedSignup, healerSignup].sort());
    expect(await draftSelectedIds(runId)).toEqual([]);

    // Acknowledging only one of the two is still not enough.
    const partial = await captureError(
      rosterBuilderService.applyRosterProposal(lead, {
        runId,
        expectedVersion: proposal.rosterVersion,
        selections: proposal.applySelections,
        confirmedWarnings: acknowledgeAll(proposal).filter((row) => row.signupId === savedSignup),
      }),
    );
    expect(pendingWarningsOf(partial).map((row) => row.signupId)).toEqual([healerSignup]);
    expect(await draftSelectedIds(runId)).toEqual([]);

    await rosterBuilderService.applyRosterProposal(lead, {
      runId,
      expectedVersion: proposal.rosterVersion,
      selections: proposal.applySelections,
      confirmedWarnings: acknowledgeAll(proposal),
    });
    expect((await draftSelectedIds(runId)).sort()).toEqual([savedSignup, cleanSignup, healerSignup].sort());
  });

  it("a warning that changed after the proposal was confirmed is rejected on Apply", async () => {
    const { runId } = await autoBuildRun();
    await setLockout(runId, savedA, VENOMOUS_ABYSS_RAID_ID, 6, 8);
    const proposal = await rosterBuilderService.proposeRoster(lead, runId);
    const confirmedWarnings = acknowledgeAll(proposal);

    await setLockout(runId, savedA, VENOMOUS_ABYSS_RAID_ID, 7, 8);

    const rejected = await captureError(
      rosterBuilderService.applyRosterProposal(lead, {
        runId,
        expectedVersion: proposal.rosterVersion,
        selections: proposal.applySelections,
        confirmedWarnings,
      }),
    );
    expect(pendingWarningsOf(rejected)[0]!.warning.contents[0]).toMatchObject({ bossesDefeated: 7 });
    expect(await draftSelectedIds(runId)).toEqual([]);
  });

  it("a hard conflict that appears after confirmation rejects Apply — the acknowledgement cannot override it", async () => {
    const sched = nextRaidWeekStart();
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(leadB, sched);
    const savedOnA = await forcePendingSignup(runA, ids.playerSavedA, savedA, "RANGED_DPS");
    await forcePendingSignup(runA, ids.playerClean, clean, "RANGED_DPS");
    const savedOnB = await forcePendingSignup(runB, ids.playerSavedA, savedA, "RANGED_DPS");
    await setLockout(runA, savedA, VENOMOUS_ABYSS_RAID_ID, 6, 8);

    const proposal = await rosterBuilderService.proposeRoster(lead, runA);
    expect(proposal.applySelections.some((row) => row.signupId === savedOnA)).toBe(true);
    const confirmedWarnings = acknowledgeAll(proposal);
    expect(confirmedWarnings).toHaveLength(1);

    // Another Raid Lead takes the Character for the overlapping Run first.
    await rosterService.saveDraftSelection(leadB, {
      runId: runB,
      version: await rosterVersion(leadB, runB),
      selections: [{ signupId: savedOnB, selectedRole: "RANGED_DPS" }],
      confirmedWarnings: confirm(await rosterCard(leadB, runB, savedOnB)),
    });

    const rejected = await captureError(
      rosterBuilderService.applyRosterProposal(lead, {
        runId: runA,
        expectedVersion: proposal.rosterVersion,
        selections: proposal.applySelections,
        confirmedWarnings,
      }),
    );
    // The re-proposal no longer contains the now-blocked Character → the stale proposal is refused.
    expect(isDomainError(rejected)).toBe(true);
    expect(codeOf(rejected)).not.toBe("ROSTER_WARNING_CONFIRMATION_REQUIRED");
    expect(await draftSelectedIds(runA)).toEqual([]);
  });
});

describe("Update Roster (published)", () => {
  it("a newly added WARNING Character needs confirmation; existing draft/published picks never re-confirm; Publish itself never prompts", async () => {
    const runId = await createOpenRun(lead, nextRaidWeekStart());
    const savedSignup = await forcePendingSignup(runId, ids.playerSavedA, savedA, "RANGED_DPS");
    const cleanSignup = await forcePendingSignup(runId, ids.playerClean, clean, "RANGED_DPS");
    const newSavedSignup = await forcePendingSignup(runId, ids.playerSavedB, savedB, "HEALER");
    await setLockout(runId, savedA, VENOMOUS_ABYSS_RAID_ID, 6, 8);
    await setLockout(runId, savedB, VENOMOUS_ABYSS_RAID_ID, 3, 8);

    await rosterService.saveDraftSelection(lead, {
      runId,
      version: await rosterVersion(lead, runId),
      selections: [
        { signupId: savedSignup, selectedRole: "RANGED_DPS" },
        { signupId: cleanSignup, selectedRole: "RANGED_DPS" },
      ],
      confirmedWarnings: confirm(await rosterCard(lead, runId, savedSignup)),
    });

    // Publishing the already-saved draft carries no acknowledgement at all.
    await rosterService.publishRoster(lead, {
      runId,
      version: await rosterVersion(lead, runId),
      acknowledgeWarnings: true,
    });
    expect((await signupRepository.findById(savedSignup))?.status).toBe("SELECTED");

    const existing = [
      { signupId: savedSignup, selectedRole: "RANGED_DPS" as const },
      { signupId: cleanSignup, selectedRole: "RANGED_DPS" as const },
    ];

    // Re-accepting the published lineup: no confirmation for the saved Character already on it.
    await rosterService.updateRoster(lead, {
      runId,
      version: await rosterVersion(lead, runId),
      selections: existing,
      acknowledgeWarnings: true,
    });

    // Adding a NEW saved Character through Update needs its acknowledgement…
    // (publishing already moved this unpicked signup to NOT_SELECTED; the rejected Update must not touch it.)
    const statusBeforeReject = (await signupRepository.findById(newSavedSignup))?.status;
    expect(statusBeforeReject).toBe("NOT_SELECTED");
    const rejected = await captureError(
      rosterService.updateRoster(lead, {
        runId,
        version: await rosterVersion(lead, runId),
        selections: [...existing, { signupId: newSavedSignup, selectedRole: "HEALER" }],
        acknowledgeWarnings: true,
      }),
    );
    const pending = pendingWarningsOf(rejected);
    expect(pending.map((row) => row.signupId)).toEqual([newSavedSignup]);
    expect((await signupRepository.findById(newSavedSignup))?.status).toBe(statusBeforeReject);

    // …and only for the new pick.
    await rosterService.updateRoster(lead, {
      runId,
      version: await rosterVersion(lead, runId),
      selections: [...existing, { signupId: newSavedSignup, selectedRole: "HEALER" }],
      acknowledgeWarnings: true,
      confirmedWarnings: confirm(await rosterCard(lead, runId, newSavedSignup)),
    });
    expect((await signupRepository.findById(newSavedSignup))?.status).toBe("SELECTED");
  });
});

describe("PR #218 stays the final authority over any acknowledgement", () => {
  it("confirmed SAVED warning, then a competing overlapping selection wins: the write fails with the hard conflict", async () => {
    const sched = nextRaidWeekStart();
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(leadB, sched);
    const signupA = await forcePendingSignup(runA, ids.playerSavedA, savedA, "RANGED_DPS");
    const signupB = await forcePendingSignup(runB, ids.playerSavedA, savedA, "RANGED_DPS");
    await setLockout(runA, savedA, VENOMOUS_ABYSS_RAID_ID, 6, 8);

    // Raid Lead A sees the warning and clicks "Select anyway"…
    const cardA = await rosterCard(lead, runA, signupA);
    expect(cardA.selectionRisk.level).toBe("WARNING");
    const confirmedA = confirm(cardA);
    const versionA = await rosterVersion(lead, runA);

    // …but before the write lands, Raid Lead B selects the same Character for the overlapping Run.
    await rosterService.saveDraftSelection(leadB, {
      runId: runB,
      version: await rosterVersion(leadB, runB),
      selections: [{ signupId: signupB, selectedRole: "RANGED_DPS" }],
      confirmedWarnings: confirm(await rosterCard(leadB, runB, signupB)),
    });

    // The still-valid acknowledgement does not help: BLOCKED.
    const service = await captureError(
      rosterService.saveDraftSelection(lead, {
        runId: runA,
        version: versionA,
        selections: [{ signupId: signupA, selectedRole: "RANGED_DPS" }],
        confirmedWarnings: confirmedA,
      }),
    );
    expect(isReservationReject(service)).toBe(true);

    // And the locked in-transaction re-read rejects on its own, even when the
    // service-level pre-check is skipped entirely (the true-race window).
    const rosterA = await rosterRepository.ensure(runA);
    const repository = await captureError(
      rosterRepository.replaceSelectedSignupIds(
        rosterA.id,
        rosterA.version,
        [{ signupId: signupA, selectedRole: "RANGED_DPS" }],
        { targetRunId: runA, scheduledStartAt: sched, selectedCharacterIds: [savedA] },
      ),
    );
    expect(codeOf(repository)).toBe("CHARACTER_ALREADY_SELECTED_OTHER_RUN");
    expect(await draftSelectedIds(runA)).toEqual([]);
    expect(await draftSelectedIds(runB)).toEqual([signupB]);

    // The roster card now reports BLOCKED, never an overrideable warning.
    expect((await rosterCard(lead, runA, signupA)).selectionRisk.level).toBe("BLOCKED");
  });

  it("two Raid Leads confirm the same saved Character for overlapping Runs concurrently — it is booked exactly once", async () => {
    const sched = nextRaidWeekStart();
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(leadB, sched);
    const signupA = await forcePendingSignup(runA, ids.playerSavedA, savedA, "RANGED_DPS");
    const signupB = await forcePendingSignup(runB, ids.playerSavedA, savedA, "RANGED_DPS");
    await setLockout(runA, savedA, VENOMOUS_ABYSS_RAID_ID, 6, 8);

    const [cardA, cardB, versionA, versionB] = await Promise.all([
      rosterCard(lead, runA, signupA),
      rosterCard(leadB, runB, signupB),
      rosterVersion(lead, runA),
      rosterVersion(leadB, runB),
    ]);

    const settle = (promise: Promise<unknown>) =>
      promise.then(
        () => ({ ok: true as const, error: null }),
        (error: unknown) => ({ ok: false as const, error }),
      );
    const results = await Promise.all([
      settle(
        rosterService.saveDraftSelection(lead, {
          runId: runA,
          version: versionA,
          selections: [{ signupId: signupA, selectedRole: "RANGED_DPS" }],
          confirmedWarnings: confirm(cardA),
        }),
      ),
      settle(
        rosterService.saveDraftSelection(leadB, {
          runId: runB,
          version: versionB,
          selections: [{ signupId: signupB, selectedRole: "RANGED_DPS" }],
          confirmedWarnings: confirm(cardB),
        }),
      ),
    ]);

    expect(results.filter((row) => row.ok)).toHaveLength(1);
    const failure = results.find((row) => !row.ok)!;
    expect(isReservationReject(failure.error)).toBe(true);

    const selectedA = (await draftSelectedIds(runA)).includes(signupA);
    const selectedB = (await draftSelectedIds(runB)).includes(signupB);
    expect(selectedA !== selectedB).toBe(true);
  });
});

describe("post-start participant replacement keeps the cross-Run reservation invariant", () => {
  it("a Character selected on an overlapping Run cannot step in; once released it can, and its own signup is never a self-conflict", async () => {
    const sched = nextRaidWeekStart();
    const runA = await createOpenRun(lead, sched);
    const runB = await createOpenRun(leadB, sched);
    const originalOnA = await forcePendingSignup(runA, ids.playerClean, clean, "RANGED_DPS");
    const benchOnA = await forcePendingSignup(runA, ids.playerSavedA, savedA, "RANGED_DPS");
    const sameCharOnB = await forcePendingSignup(runB, ids.playerSavedA, savedA, "RANGED_DPS");

    // Run A: publish with the original participant and start.
    await rosterService.saveDraftSelection(lead, {
      runId: runA,
      version: await rosterVersion(lead, runA),
      selections: [{ signupId: originalOnA, selectedRole: "RANGED_DPS" }],
    });
    await rosterService.publishRoster(lead, {
      runId: runA,
      version: await rosterVersion(lead, runA),
      acknowledgeWarnings: true,
    });
    await runService.startRun(lead, { runId: runA });

    // Run B (overlapping) reserves the bench Character.
    await rosterService.saveDraftSelection(leadB, {
      runId: runB,
      version: await rosterVersion(leadB, runB),
      selections: [{ signupId: sameCharOnB, selectedRole: "RANGED_DPS" }],
    });

    const attendanceBefore = await attendanceService.getManagerAttendance(lead, runA);
    const originalRow = attendanceBefore.rows.find((row) => row.userName === "Warning Clean")!;
    expect(originalRow).toBeTruthy();
    expect(attendanceBefore.replacementCandidates.some((row) => row.signupId === benchOnA)).toBe(true);

    // Publishing Run A moved the unpicked bench signup to NOT_SELECTED; a rejected replacement must leave it there.
    const benchStatusBefore = (await signupRepository.findById(benchOnA))?.status;
    expect(benchStatusBefore).toBe("NOT_SELECTED");
    const rejected = await captureError(
      attendanceService.replaceParticipant(lead, {
        attendanceId: originalRow.id,
        replacement: { kind: "signup", signupId: benchOnA },
      }),
    );
    expect(codeOf(rejected)).toBe("CHARACTER_ALREADY_SELECTED_OTHER_RUN");

    // The whole replacement rolled back: no double booking, nothing half-applied.
    expect((await signupRepository.findById(benchOnA))?.status).toBe(benchStatusBefore);
    expect((await signupRepository.findById(originalOnA))?.status).toBe("SELECTED");
    const attendanceAfterReject = await attendanceService.getManagerAttendance(lead, runA);
    expect(attendanceAfterReject.rows).toHaveLength(attendanceBefore.rows.length);
    expect(attendanceAfterReject.rows.find((row) => row.id === originalRow.id)?.status).toBe(originalRow.status);

    // Released on Run B → the same replacement is allowed (this Run's own signup never conflicts with itself).
    await rosterService.saveDraftSelection(leadB, {
      runId: runB,
      version: await rosterVersion(leadB, runB),
      selections: [],
    });
    await attendanceService.replaceParticipant(lead, {
      attendanceId: originalRow.id,
      replacement: { kind: "signup", signupId: benchOnA },
    });
    expect((await signupRepository.findById(benchOnA))?.status).toBe("SELECTED");
    expect((await signupRepository.findById(originalOnA))?.status).toBe("NOT_SELECTED");

    // And now Run B can no longer take the Character back: the replacement holds the reservation.
    const takeBack = await captureError(
      rosterService.saveDraftSelection(leadB, {
        runId: runB,
        version: await rosterVersion(leadB, runB),
        selections: [{ signupId: sameCharOnB, selectedRole: "RANGED_DPS" }],
      }),
    );
    expect(isReservationReject(takeBack)).toBe(true);
  });

  it("a Character selected on a NON-overlapping Run may still step in", async () => {
    const runA = await createOpenRun(lead, nextRaidWeekStart());
    const runElsewhere = await createOpenRun(leadB, nextRaidWeekStart());
    const originalOnA = await forcePendingSignup(runA, ids.playerClean, clean, "RANGED_DPS");
    const benchOnA = await forcePendingSignup(runA, ids.playerSavedA, savedA, "RANGED_DPS");
    const elsewhere = await forcePendingSignup(runElsewhere, ids.playerSavedA, savedA, "RANGED_DPS");

    await rosterService.saveDraftSelection(leadB, {
      runId: runElsewhere,
      version: await rosterVersion(leadB, runElsewhere),
      selections: [{ signupId: elsewhere, selectedRole: "RANGED_DPS" }],
    });
    await rosterService.saveDraftSelection(lead, {
      runId: runA,
      version: await rosterVersion(lead, runA),
      selections: [{ signupId: originalOnA, selectedRole: "RANGED_DPS" }],
    });
    await rosterService.publishRoster(lead, {
      runId: runA,
      version: await rosterVersion(lead, runA),
      acknowledgeWarnings: true,
    });
    await runService.startRun(lead, { runId: runA });

    const attendance = await attendanceService.getManagerAttendance(lead, runA);
    const originalRow = attendance.rows.find((row) => row.userName === "Warning Clean")!;
    await attendanceService.replaceParticipant(lead, {
      attendanceId: originalRow.id,
      replacement: { kind: "signup", signupId: benchOnA },
    });
    expect((await signupRepository.findById(benchOnA))?.status).toBe("SELECTED");
    expect(await draftSelectedIds(runElsewhere)).toEqual([elsewhere]);
  });
});
