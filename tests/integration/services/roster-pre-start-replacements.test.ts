import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { db, orm } from "@/lib/prisma";
import type { CharacterRole } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { lockRosterInTx, rosterRepository } from "@/repositories/roster.repository";
import { runRepository } from "@/repositories/run.repository";
import { userNotificationRepository } from "@/repositories/user-notification.repository";
import { attendanceService } from "@/services/attendance.service";
import { getRunCommitmentsForCharacters } from "@/services/character-run-commitment";
import { discordSyncService } from "@/services/discord-sync.service";
import { lockoutService } from "@/services/lockout.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";
import { testActor } from "@tests/fixtures/actors";
import {
  assertIsolatedTestDatabase,
  createTestCharacter,
  createTestUser,
  deleteCreatedRows,
  waitForLockWaiter,
} from "@tests/fixtures/db-fixtures";
import { venomousCreateInput } from "@tests/fixtures/test-run-input";
import { offerCharacter } from "@tests/helpers/signup-offers";

/** Commitments of one Character as seen from a Run in the same raid ID as `runId` (excluding `excludeRunId`). */
async function commitmentsInRaidIdOf(runId: string, characterId: string, excludeRunId: string) {
  const run = (await orm.Run.where({ id: runId }).first()) as { scheduledStartAt: string };
  const character = (await orm.Character.where({ id: characterId }).first()) as { region: "EU" | "US" };
  return (
    await getRunCommitmentsForCharacters({
      characters: [{ id: characterId, region: character.region }],
      excludeRunId,
      targetScheduledStartAt: new Date(run.scheduledStartAt).toISOString(),
    })
  ).get(characterId);
}

/**
 * Pre-start roster replacements: PUBLISHED stays editable, Add Player rosters
 * registered players atomically, Start Run is the (race-safe) lock point, and
 * Attendance Replace remains the post-start workflow.
 */

/** Distinct per suite run, so the player search sees only this run's users. */
const SEARCH_TOKEN = `Srch${crypto.randomUUID().slice(0, 6)}`;
const created = { runIds: [] as string[], characterIds: [] as string[], userIds: [] as string[] };
let lead: AuthenticatedUser;
let otherLead: AuthenticatedUser;
let plainUser: AuthenticatedUser;
/** Booster players: A and C are on every published roster, B is added by the Raid Lead. */
let playerA: AuthenticatedUser;
let playerB: AuthenticatedUser;
let playerC: AuthenticatedUser;
let noAccess: AuthenticatedUser;
let disabledId = "";
let discordOnlyId = "";

async function createUser(
  name: string,
  options: { role?: AuthenticatedUser["accountRole"]; isBooster?: boolean; discordUsername?: string; disabled?: boolean } = {},
) {
  const accountRole = options.role ?? "USER";
  const id = await createTestUser({
    name,
    accountRole,
    isBooster: options.isBooster,
    discordUsername: options.discordUsername,
    accountStatus: options.disabled ? "DISABLED" : "ACTIVE",
  });
  created.userIds.push(id);
  return testActor(id, accountRole);
}

const CLASS_SPECS = {
  PRIEST: { specialization: "Holy", primaryRole: "HEALER", offSpec: "Shadow" },
  PALADIN: { specialization: "Protection", primaryRole: "TANK", offSpec: null },
  SHAMAN: { specialization: "Restoration", primaryRole: "HEALER", offSpec: "Elemental" },
} as const;

let characterSeq = 0;
async function createCharacter(userId: string, wowClass: keyof typeof CLASS_SPECS = "PRIEST") {
  const spec = CLASS_SPECS[wowClass];
  const id = await createTestCharacter({
    userId,
    name: `Prestart${characterSeq++}`,
    realm: "PreStart",
    wowClass,
    specialization: spec.specialization,
    primaryRole: spec.primaryRole,
  });
  created.characterIds.push(id);
  if (spec.offSpec) {
    await orm.CharacterPlayableSpec.create({
      id: crypto.randomUUID(),
      characterId: id,
      specialization: spec.offSpec,
      createdAt: new Date().toISOString(),
    });
  }
  return id;
}

let slot = 0;
function futureIso() {
  // 3h apart so the 2h cross-Run reservation window never links unrelated tests.
  return new Date(Date.now() + 14 * 24 * 3600_000 + slot++ * 3 * 3600_000).toISOString();
}

async function createOpenRun(actor: AuthenticatedUser = lead, scheduledStartAt = futureIso()) {
  const run = await runService.createRun(
    actor,
    venomousCreateInput({ scheduledStartAt, desiredTankCount: 1, desiredHealerCount: 1, desiredDpsCount: 1 }),
  );
  created.runIds.push(run.id);
  await runService.openRun(actor, run.id);
  return { runId: run.id, scheduledStartAt };
}

/** Deletes this test's Runs: attendance first (it references roster entries with RESTRICT), the rest cascades. */
async function deleteRuns() {
  const runIds = created.runIds.splice(0);
  for (const runId of runIds) await orm.RunAttendance.where({ runId }).deleteAndCount();
  await deleteCreatedRows({ runIds });
}

async function view(runId: string, actor: AuthenticatedUser = lead) {
  return rosterService.getRosterManagementView(actor, runId);
}

async function saveDraft(runId: string, selections: Array<{ signupId: string; selectedRole: CharacterRole | null }>, actor = lead) {
  const current = await view(runId, actor);
  await rosterService.saveDraftSelection(actor, { runId, version: current.roster.version, selections });
}

async function publish(runId: string, actor = lead) {
  const current = await view(runId, actor);
  await rosterService.publishRoster(actor, { runId, version: current.roster.version, acknowledgeWarnings: true });
}

async function addPlayer(runId: string, userId: string, characterId: string, role: CharacterRole, actor = lead) {
  const current = await view(runId, actor);
  return rosterService.addRegisteredParticipant(actor, { runId, version: current.roster.version, userId, characterId, role });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

async function signupsFor(runId: string, userId: string) {
  return (await orm.RunSignup.where({ runId, userId }).include("offeredRoles").all()) as Array<Record<string, unknown>>;
}

/** Published run: A selected as HEALER, C selected as TANK. */
async function publishedRun() {
  const { runId, scheduledStartAt } = await createOpenRun();
  const aSignup = await offerCharacter(playerA, runId, aChar, "HEALER");
  const cSignup = await offerCharacter(playerC, runId, cChar, "TANK");
  await saveDraft(runId, [
    { signupId: aSignup, selectedRole: "HEALER" },
    { signupId: cSignup, selectedRole: "TANK" },
  ]);
  await publish(runId);
  return { runId, scheduledStartAt, aSignup, cSignup };
}

let aChar = "";
let bChar = "";
let bChar2 = "";
let cChar = "";
let noAccessChar = "";

beforeAll(async () => {
  assertIsolatedTestDatabase();
  await raidRepository.ensureReferenceRaids();
  lead = await createUser("PreStart Lead", { role: "RAID_LEAD" });
  otherLead = await createUser("PreStart Other Lead", { role: "RAID_LEAD" });
  playerA = await createUser("PreStart Player A", { isBooster: true });
  playerB = await createUser("PreStart Player B", { isBooster: true });
  playerC = await createUser("PreStart Player C", { isBooster: true });
  noAccess = await createUser("PreStart No Access");
  plainUser = await createUser("PreStart Plain");
  disabledId = (await createUser(`${SEARCH_TOKEN} Disabled`, { disabled: true })).id;
  discordOnlyId = (await createUser("Unrelated Name", { discordUsername: `${SEARCH_TOKEN.toLowerCase()}_discord` })).id;
  for (let index = 0; index < 12; index += 1) {
    await createUser(`${SEARCH_TOKEN} ${String(index).padStart(2, "0")}`);
  }
  aChar = await createCharacter(playerA.id, "PRIEST");
  bChar = await createCharacter(playerB.id, "PRIEST");
  bChar2 = await createCharacter(playerB.id, "SHAMAN");
  cChar = await createCharacter(playerC.id, "PALADIN");
  noAccessChar = await createCharacter(noAccess.id, "PRIEST");
}, 60_000);

afterEach(async () => {
  vi.restoreAllMocks();
  await deleteRuns();
  await orm.CharacterWeeklyUnavailability.where((row) => row.characterId.in(created.characterIds)).deleteAndCount();
});

afterAll(() => deleteCreatedRows(created), 60_000);

describe("manual registered participant (Add Player)", () => {
  it("B. a player who never signed up becomes a normal draft-selected BOOSTER signup — not an External Booster", async () => {
    const { runId } = await createOpenRun();

    const result = await addPlayer(runId, playerB.id, bChar, "HEALER");

    expect(result.created).toBe(true);
    const signups = await signupsFor(runId, playerB.id);
    expect(signups).toHaveLength(1);
    expect(signups[0]).toMatchObject({ id: result.signupId, participationType: "BOOSTER", status: "PENDING", characterId: bChar });
    const current = await view(runId);
    const slot = current.boosters.find((row) => row.id === result.signupId);
    expect(slot).toMatchObject({ draftSelected: true, selectedRole: "HEALER", userId: playerB.id });
    expect(current.roster.externalBoosters).toHaveLength(0);
    expect(current.run.status).toBe("ROSTERING");
    const activity = await orm.ActivityEvent.where({ userId: lead.id, type: "ROSTER_PLAYER_ADDED" }).all();
    expect(activity).toHaveLength(1);
  });

  it("D. an existing suitable signup is reused (no duplicate) and gains the assigned role when missing", async () => {
    const { runId } = await createOpenRun();
    const existing = await offerCharacter(playerB, runId, bChar, "HEALER");

    const same = await addPlayer(runId, playerB.id, bChar, "HEALER");
    expect(same).toEqual({ signupId: existing, created: false });

    const extended = await addPlayer(runId, playerB.id, bChar, "RANGED_DPS");
    expect(extended).toEqual({ signupId: existing, created: false });
    const signups = await signupsFor(runId, playerB.id);
    expect(signups).toHaveLength(1);
    const roles = (signups[0].offeredRoles as Array<{ role: string }>).map((row) => row.role).sort();
    expect(roles).toEqual(["HEALER", "RANGED_DPS"]);
    expect((await view(runId)).boosters.find((row) => row.id === existing)?.selectedRole).toBe("RANGED_DPS");
  });

  it("E. a WITHDRAWN signup is never revived; the character is listed as not eligible", async () => {
    const { runId } = await createOpenRun();
    const withdrawn = await offerCharacter(playerB, runId, bChar, "HEALER");
    await signupService.withdrawSignup(playerB, withdrawn);

    await expectCode(addPlayer(runId, playerB.id, bChar, "HEALER"), "SIGNUP_WITHDRAWN");
    const signups = await signupsFor(runId, playerB.id);
    expect(signups.map((row) => [row.id, row.status])).toEqual([[withdrawn, "WITHDRAWN"]]);
    const options = await rosterService.getManualAddOptions(lead, { runId, userId: playerB.id });
    expect(options.eligible.map((row) => row.characterId)).not.toContain(bChar);
    expect(options.ineligible.find((row) => row.characterId === bChar)?.message).toMatch(/Withdrew/);
  });

  it("F. missing Booster Access blocks (no Raid Lead bypass)", async () => {
    const { runId } = await createOpenRun();
    await expectCode(addPlayer(runId, noAccess.id, noAccessChar, "HEALER"), "BOOSTER_ACCESS_REQUIRED");
    expect(await signupsFor(runId, noAccess.id)).toHaveLength(0);
  });

  it("G. a Character marked unavailable for this difficulty and reset blocks", async () => {
    const { runId, scheduledStartAt } = await createOpenRun();
    const now = new Date().toISOString();
    await orm.CharacterWeeklyUnavailability.create({
      id: crypto.randomUUID(),
      characterId: bChar,
      resetIdentifier: lockoutService.getResetIdentifierForRun("EU", scheduledStartAt),
      difficulty: "HEROIC",
      createdAt: now,
      updatedAt: now,
    });
    await expectCode(addPlayer(runId, playerB.id, bChar, "HEALER"), "CHARACTER_UNAVAILABLE");
    expect(await signupsFor(runId, playerB.id)).toHaveLength(0);
  });

  it("H. a cross-Run reservation conflict blocks", async () => {
    const { runId, scheduledStartAt } = await createOpenRun();
    const other = await createOpenRun(otherLead, scheduledStartAt);
    const otherSignup = await offerCharacter(playerB, other.runId, bChar, "HEALER");
    await saveDraft(other.runId, [{ signupId: otherSignup, selectedRole: "HEALER" }], otherLead);

    await expectCode(addPlayer(runId, playerB.id, bChar, "HEALER"), "CHARACTER_ALREADY_SELECTED_OTHER_RUN");
    expect(await signupsFor(runId, playerB.id)).toHaveLength(0);
  });

  it("I. one selected BOOSTER per User: adding a second Character replaces the first slot", async () => {
    const { runId } = await createOpenRun();
    const first = await addPlayer(runId, playerB.id, bChar, "HEALER");
    const second = await addPlayer(runId, playerB.id, bChar2, "HEALER");

    const current = await view(runId);
    const selectedForB = current.boosters.filter((row) => row.userId === playerB.id && row.draftSelected);
    expect(selectedForB.map((row) => row.id)).toEqual([second.signupId]);
    // The first offer stays a normal (unselected) signup, like any swapped-out offer.
    expect(current.boosters.find((row) => row.id === first.signupId)?.draftSelected).toBe(false);
  });

  it("C. atomic failure — roster version race: no synthetic signup, no draft change", async () => {
    const { runId } = await createOpenRun();
    const validate = signupService.validateManagedBoosterCandidate.bind(signupService);
    vi.spyOn(signupService, "validateManagedBoosterCandidate").mockImplementation(async (input) => {
      const result = await validate(input);
      // Another manager changes the roster between validation and the write.
      const roster = await rosterRepository.findByRunId(runId);
      await rosterRepository.replaceExternalBoosters(roster!.id, roster!.version, []);
      return result;
    });
    const before = await view(runId);

    await expectCode(addPlayer(runId, playerB.id, bChar, "HEALER"), "ROSTER_ALREADY_CHANGED");

    expect(await signupsFor(runId, playerB.id)).toHaveLength(0);
    const after = await view(runId);
    expect(after.roster.version).toBe(before.roster.version + 1); // only the concurrent change
    expect(after.boosters.some((row) => row.draftSelected)).toBe(false);
  });

  it("C. atomic failure — role extension is rolled back with the rest", async () => {
    const { runId } = await createOpenRun();
    const existing = await offerCharacter(playerB, runId, bChar, "HEALER");
    const validate = signupService.validateManagedBoosterCandidate.bind(signupService);
    vi.spyOn(signupService, "validateManagedBoosterCandidate").mockImplementation(async (input) => {
      const result = await validate(input);
      const roster = await rosterRepository.findByRunId(runId);
      await rosterRepository.replaceExternalBoosters(roster!.id, roster!.version, []);
      return result;
    });

    await expectCode(addPlayer(runId, playerB.id, bChar, "RANGED_DPS"), "ROSTER_ALREADY_CHANGED");

    const signups = await signupsFor(runId, playerB.id);
    expect(signups.map((row) => row.id)).toEqual([existing]);
    expect((signups[0].offeredRoles as Array<{ role: string }>).map((row) => row.role)).toEqual(["HEALER"]);
    expect((await view(runId)).boosters.find((row) => row.id === existing)?.draftSelected).toBe(false);
  });

  it("C. atomic failure — the Character is reserved elsewhere meanwhile: everything rolls back", async () => {
    const { runId, scheduledStartAt } = await createOpenRun();
    const other = await createOpenRun(otherLead, scheduledStartAt);
    const otherSignup = await offerCharacter(playerB, other.runId, bChar, "HEALER");
    const validate = signupService.validateManagedBoosterCandidate.bind(signupService);
    let raced = false;
    vi.spyOn(signupService, "validateManagedBoosterCandidate").mockImplementation(async (input) => {
      const result = await validate(input);
      if (!raced) {
        raced = true;
        await saveDraft(other.runId, [{ signupId: otherSignup, selectedRole: "HEALER" }], otherLead);
      }
      return result;
    });

    await expect(addPlayer(runId, playerB.id, bChar, "HEALER")).rejects.toMatchObject({
      code: expect.stringMatching(/CHARACTER_ALREADY_SELECTED_OTHER_RUN|SCHEDULE_CONFLICT/),
    });
    expect(await signupsFor(runId, playerB.id)).toHaveLength(0);
    expect((await view(runId)).boosters).toHaveLength(0);
  });

  it("U. player search: server-side, ACTIVE only, max 10, name or Discord username, no sensitive fields", async () => {
    const { runId } = await createOpenRun();
    const matches = await rosterService.searchPlayers(lead, { runId, query: SEARCH_TOKEN.toLowerCase() });
    expect(matches).toHaveLength(10);
    expect(matches.some((row) => row.id === disabledId)).toBe(false);
    for (const row of matches) {
      expect(Object.keys(row).sort()).toEqual(["discordUsername", "id", "name"]);
    }
    const byDiscord = await rosterService.searchPlayers(lead, { runId, query: `${SEARCH_TOKEN.slice(4).toLowerCase()}_disc` });
    expect(byDiscord.map((row) => row.id)).toEqual([discordOnlyId]);
    await expectCode(rosterService.searchPlayers(plainUser, { runId, query: SEARCH_TOKEN }), "RUN_NOT_MANAGEABLE");
    await expectCode(
      rosterService.addRegisteredParticipant(plainUser, { runId, version: 1, userId: playerB.id, characterId: bChar, role: "HEALER" }),
      "RUN_NOT_MANAGEABLE",
    );
    expect(await signupsFor(runId, playerB.id)).toHaveLength(0);
  });

  it("Character options: eligible characters with class roles, ineligible ones with a reason — nothing private", async () => {
    const { runId } = await createOpenRun();
    const options = await rosterService.getManualAddOptions(lead, { runId, userId: playerB.id });
    expect(options.player).toEqual({ id: playerB.id, name: "PreStart Player B" });
    const priest = options.eligible.find((row) => row.characterId === bChar);
    expect(priest?.roles.sort()).toEqual(["HEALER", "RANGED_DPS"]);
    expect(Object.keys(priest!).sort()).toEqual(["characterId", "characterName", "defaultRole", "realm", "roles", "selectionRisk", "specialization", "wowClass"]);
    const noAccessOptions = await rosterService.getManualAddOptions(lead, { runId, userId: noAccess.id });
    expect(noAccessOptions.eligible).toHaveLength(0);
    expect(noAccessOptions.ineligible).toHaveLength(1);
  });
});

describe("published roster replacement and the Start lock", () => {
  it("A/M/N/O/T. replace A with B while PUBLISHED, Update Roster, then Start freezes B", async () => {
    const { runId, aSignup, cSignup } = await publishedRun();
    let current = await view(runId);
    expect(current.run.status).toBe("PUBLISHED");
    expect(current.roster.canEdit).toBe(true);
    expect(current.roster.hasUnpublishedChanges).toBe(false);
    const publishedVersion = current.roster.version;
    const notesBefore = async (userId: string) =>
      (await userNotificationRepository.listForUser(userId, 100)).filter((note) => note.runId === runId);
    const cNotesBefore = (await notesBefore(playerC.id)).length;

    // Raid Lead removes A from the draft and adds B (never signed up) as HEALER.
    await saveDraft(runId, [{ signupId: cSignup, selectedRole: "TANK" }]);
    const added = await addPlayer(runId, playerB.id, bChar, "HEALER");
    current = await view(runId);
    expect(current.run.status).toBe("PUBLISHED");
    expect(current.roster.hasUnpublishedChanges).toBe(true);

    // O. Start refuses the unpublished change instead of silently starting A.
    await expectCode(runService.startRun(lead, { runId }), "ROSTER_UNPUBLISHED_CHANGES");
    expect((await runRepository.findById(runId))?.status).toBe("PUBLISHED");
    expect(await orm.RunAttendance.where({ runId }).all()).toHaveLength(0);

    // Update Roster.
    await publish(runId);
    current = await view(runId);
    const bySignup = new Map(current.boosters.map((row) => [row.id, row]));
    expect(bySignup.get(aSignup)?.status).toBe("NOT_SELECTED");
    expect(bySignup.get(added.signupId)?.status).toBe("SELECTED");
    const bRow = (await orm.RunSignup.where({ id: added.signupId }).first()) as Record<string, unknown>;
    expect(bRow.publishedRole).toBe("HEALER");
    expect(current.roster.version).toBeGreaterThan(publishedVersion);
    expect(current.run.status).toBe("PUBLISHED");
    expect(current.roster.hasUnpublishedChanges).toBe(false);

    // T. Notifications: B selected once, A removed once (visible), C untouched.
    const bNotes = await notesBefore(playerB.id);
    expect(bNotes.filter((note) => note.type === "ROSTER_SELECTED")).toHaveLength(1);
    const aNotes = await notesBefore(playerA.id);
    expect(aNotes.filter((note) => note.type === "ROSTER_REMOVED" && note.visibleInApp)).toHaveLength(1);
    expect((await notesBefore(playerC.id)).length).toBe(cNotesBefore);

    // N. Start with a clean published roster freezes B (and C), not A.
    await runService.startRun(lead, { runId });
    const attendance = await attendanceService.getManagerAttendance(lead, runId);
    const attendedSignupIds = (await orm.RunAttendance.where({ runId }).include("rosterEntry").all()).map(
      (row) => ((row as Record<string, unknown>).rosterEntry as Record<string, unknown>).signupId,
    );
    expect(attendance.rows).toHaveLength(2);
    expect(attendedSignupIds.sort()).toEqual([added.signupId, cSignup].sort());
  });

  it("commitments: a manually added player is RESERVED while draft-selected and COMMITTED once published", async () => {
    const { runId } = await publishedRun();
    const other = await createOpenRun(otherLead);
    await addPlayer(runId, playerB.id, bChar, "RANGED_DPS");
    const reserved = (await commitmentsInRaidIdOf(runId, bChar, other.runId));
    expect(reserved?.find((row) => row.runId === runId)?.state).toBe("RESERVED");
    await publish(runId);
    const committed = (await commitmentsInRaidIdOf(runId, bChar, other.runId));
    expect(committed?.find((row) => row.runId === runId)?.state).toBe("COMMITTED");
  });

  it("S. Update Roster edits the existing Discord roster post in place (no second post)", async () => {
    const { runId, cSignup } = await publishedRun();
    await discordSyncService.recordRunChannel({ runId, channelId: "prestart-chan" });
    await discordSyncService.recordRosterPost({ runId, channelId: "prestart-chan", messageId: "prestart-roster-msg", postRevision: 1 });
    let work = await discordSyncService.listSyncWork();
    expect(work.roster.some((item) => item.runId === runId)).toBe(false);

    await saveDraft(runId, [{ signupId: cSignup, selectedRole: "TANK" }]);
    await addPlayer(runId, playerB.id, bChar, "HEALER");
    await publish(runId);

    work = await discordSyncService.listSyncWork();
    const rosterItems = work.roster.filter((item) => item.runId === runId);
    expect(rosterItems).toHaveLength(1);
    expect(rosterItems[0]).toMatchObject({ existingMessageId: "prestart-roster-msg", existingRunChannelId: "prestart-chan" });
  });

  it("Q/R. after Start the roster is locked everywhere; Attendance Replace still works and leaves the roster frozen", async () => {
    const { runId } = await publishedRun();
    await runService.startRun(lead, { runId });
    const current = await view(runId);
    expect(current.run.status).toBe("IN_PROGRESS");
    expect(current.roster.canEdit).toBe(false);
    const version = current.roster.version;

    const blocked: Array<() => Promise<unknown>> = [
      () => rosterService.addRegisteredParticipant(lead, { runId, version, userId: playerB.id, characterId: bChar, role: "HEALER" }),
      () => rosterService.saveDraftSelection(lead, { runId, version, selections: [] }),
      () =>
        rosterService.saveExternalBoosters(lead, {
          runId,
          version,
          externalBoosters: [{ name: "late", wowClass: "MAGE", participationType: "BOOSTER", role: "RANGED_DPS" }],
        }),
      () => rosterService.publishRoster(lead, { runId, version, acknowledgeWarnings: true }),
      () => rosterService.searchPlayers(lead, { runId, query: "prestart" }),
    ];
    for (const call of blocked) {
      await expectCode(call(), "INVALID_ROSTER_SELECTION");
    }
    expect(await signupsFor(runId, playerB.id)).toHaveLength(0);

    // Attendance Replace: the post-start operational substitution.
    const rows = (await attendanceService.getManagerAttendance(lead, runId)).rows;
    const target = rows.find((row) => row.userName === "PreStart Player A")!;
    await attendanceService.replaceParticipant(lead, {
      attendanceId: target.id,
      replacement: { kind: "external", name: "latehelp", wowClass: "PRIEST", participationType: "BOOSTER", role: "HEALER" },
    });
    const after = await attendanceService.getManagerAttendance(lead, runId);
    expect(after.rows.find((row) => row.id === target.id)?.status).toBe("NO_SHOW");
    const locked = await view(runId);
    expect(locked.roster.canEdit).toBe(false);
    expect(locked.roster.externalBoosters.map((row) => row.name)).toEqual(["latehelp"]);
  });

  it("P. Start vs a concurrent roster change: the started lineup always equals the published roster", async () => {
    for (let round = 0; round < 3; round += 1) {
      const { runId, cSignup } = await publishedRun();
      await saveDraft(runId, [
        { signupId: cSignup, selectedRole: "TANK" },
        ...(await view(runId)).boosters
          .filter((row) => row.userId === playerA.id)
          .map((row) => ({ signupId: row.id, selectedRole: "HEALER" as const })),
      ]);
      const version = (await view(runId)).roster.version;

      const [started, changed] = await Promise.allSettled([
        runService.startRun(lead, { runId }),
        rosterService.addRegisteredParticipant(lead, { runId, version, userId: playerB.id, characterId: bChar, role: "MELEE_DPS" }),
      ]);
      const run = await runRepository.findById(runId);
      const selected = ((await orm.RunSignup.where({ runId, status: "SELECTED" }).select("id").all()) as Array<{ id: string }>)
        .map((row) => row.id)
        .sort();
      if (run?.status === "IN_PROGRESS") {
        expect(started.status).toBe("fulfilled");
        const attended = (await orm.RunAttendance.where({ runId }).include("rosterEntry").all())
          .map((row) => ((row as Record<string, unknown>).rosterEntry as Record<string, unknown>).signupId as string)
          .sort();
        expect(attended).toEqual(selected);
        // A roster change that lost the race did not slip in afterwards.
        if (changed.status === "rejected") {
          expect(await signupsFor(runId, playerB.id)).toHaveLength(0);
        } else {
          // It committed first, so Start must have refused it … which contradicts IN_PROGRESS.
          throw new Error("roster change and Start both succeeded");
        }
      } else {
        expect(run?.status).toBe("PUBLISHED");
        expect(changed.status).toBe("fulfilled");
        expect(started).toMatchObject({ status: "rejected", reason: { code: "ROSTER_UNPUBLISHED_CHANGES" } });
        expect(await orm.RunAttendance.where({ runId }).all()).toHaveLength(0);
      }
      await deleteRuns();
    }
  });
});

describe("Start lock ordering", () => {
  it("P. a roster write queued behind the Start lock sees the committed IN_PROGRESS and fails, leaving nothing behind", async () => {
    const { runId } = await publishedRun();
    const roster = await rosterRepository.findByRunId(runId);
    let releaseStart!: () => void;
    const startMayCommit = new Promise<void>((resolve) => (releaseStart = resolve));
    let signalLocked!: () => void;
    const lockHeld = new Promise<void>((resolve) => (signalLocked = resolve));

    // Stand-in for Start: holds the roster lock, then commits IN_PROGRESS.
    const startTx = db.transaction(async (tx) => {
      const txOrm = tx.orm.public;
      await lockRosterInTx(txOrm, roster!.id);
      signalLocked();
      await startMayCommit;
      await txOrm.Run.where({ id: runId }).update({ status: "IN_PROGRESS", updatedAt: new Date().toISOString() });
    });
    await lockHeld;

    // The service pre-checks still see PUBLISHED; the write then queues on the lock.
    const add = addPlayer(runId, playerB.id, bChar, "HEALER");
    await waitForLockWaiter();
    releaseStart();
    await startTx;

    await expectCode(add, "INVALID_ROSTER_SELECTION");
    expect(await signupsFor(runId, playerB.id)).toHaveLength(0);
  });
});

describe("V. External Boosters (current semantics, pinned)", () => {
  it("are live roster data: saving while PUBLISHED changes the published roster at once, bumps the version, and is not an unpublished change", async () => {
    const { runId } = await publishedRun();
    const before = await view(runId);

    await rosterService.saveExternalBoosters(lead, {
      runId,
      version: before.roster.version,
      externalBoosters: [{ name: "dawn", wowClass: "WARRIOR", participationType: "BOOSTER", role: "MELEE_DPS" }],
    });

    const after = await view(runId);
    expect(after.roster.version).toBe(before.roster.version + 1);
    expect(after.roster.hasUnpublishedChanges).toBe(false);
    const published = await rosterService.getPublishedRosterView(runId);
    expect(published?.externalBoosters.map((row) => row.name)).toEqual(["dawn"]);
    // Start therefore needs no Update Roster for External Boosters.
    await runService.startRun(lead, { runId });
    expect((await runRepository.findById(runId))?.status).toBe("IN_PROGRESS");
  });
});
