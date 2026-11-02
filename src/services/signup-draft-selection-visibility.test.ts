import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { attendanceRepository } from "@/repositories/attendance.repository";
import { rosterRepository } from "@/repositories/roster.repository";
import { runRepository } from "@/repositories/run.repository";
import { userNotificationRepository } from "@/repositories/user-notification.repository";
import { characterService } from "@/services/character.service";
import { rosterBuilderService } from "@/services/roster-builder.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";
import { groupMyRunsByRun } from "@/lib/my-runs-groups";
import { testActor } from "@/test/actors";
import { assertIsolatedTestDatabase, createTestUser, deleteCreatedRows } from "@/test/db-fixtures";
import { offerCharacter, offerCharacters } from "@/test/signup-offers";
import { CURRENT_WEEK_RUN_START, DAY_MS, HOUR_MS, RAID_WEEK_TEST_CLOCK, freezeSystemTime, restoreSystemTime } from "@/test/time";

// Warcraft Logs auto-link enrichment runs after Character writes/syncs; keep it
// offline (a real WARCRAFT_LOGS_* in .env would otherwise hit the live API).
vi.mock("@/integrations/warcraft-logs/warcraft-logs-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/warcraft-logs/warcraft-logs-api-client")>()),
  warcraftLogsApiClient: {
    isConfigured: () => true,
    findCharacter: async () => ({ status: "NOT_FOUND" as const }),
  },
}));

const created = { runIds: [] as string[], characterIds: [] as string[], userIds: [] as string[] };
let owner: AuthenticatedUser;
let other: AuthenticatedUser;
let lead: AuthenticatedUser;
let nameSeq = 0;

function charName(prefix: string) {
  nameSeq += 1;
  // Letters only (WoW name rules); unique within this suite run.
  return `${prefix}${String.fromCharCode(96 + (nameSeq % 26 || 26))}${String.fromCharCode(96 + ((nameSeq * 3) % 26 || 26))}`.slice(
    0,
    12,
  );
}

async function createUser(name: string, accountRole: AuthenticatedUser["accountRole"], isBooster: boolean) {
  const id = await createTestUser({ name, accountRole, isBooster });
  created.userIds.push(id);
  return testActor(id, accountRole, { name });
}

async function createHealer(prefix: string, specialization: "Holy" | "Discipline", extra: { playableSpecs?: string[] } = {}) {
  const character = await characterService.createCharacter(owner, {
    name: charName(prefix),
    realm: "Antonidas",
    region: "EU",
    wowClass: "PRIEST",
    specialization,
    itemLevel: 640,
    ...extra,
  });
  created.characterIds.push(character.id);
  return character;
}

/** Distinct start times inside the frozen raid week, so no two Runs of the owner overlap. */
let startSlot = 0;
function nextStartInRaidWeek() {
  startSlot += 1;
  return new Date(Date.parse(RAID_WEEK_TEST_CLOCK) + startSlot * 6 * HOUR_MS).toISOString();
}

async function createOpenRun(scheduledStartAt: string, targets: { tanks?: number; healers?: number; dps?: number } = {}) {
  const run = await runService.createRun(
    lead,
    venomousCreateInput({
      scheduledStartAt,
      desiredTankCount: targets.tanks ?? 0,
      desiredHealerCount: targets.healers ?? 1,
      desiredDpsCount: targets.dps ?? 0,
    }),
  );
  created.runIds.push(run.id);
  await runService.openRun(lead, run.id);
  return run;
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  freezeSystemTime(RAID_WEEK_TEST_CLOCK, { advance: true });
  owner = await createUser("DSV Owner", "USER", true);
  other = await createUser("DSV Other", "USER", true);
  lead = await createUser("DSV Lead", "RAID_LEAD", false);
});

afterAll(async () => {
  assertIsolatedTestDatabase();
  // Attendance references roster entries with RESTRICT, so it goes before its Run.
  for (const runId of created.runIds) await orm.RunAttendance.where({ runId }).deleteAndCount();
  await deleteCreatedRows(created);
  restoreSystemTime();
});

describe("draft selection user visibility", () => {
  it("signup only stays offered; manual draft select/deselect/change/publish update projection", async () => {
    const charA = await createHealer("Dsvmist", "Holy");
    const charB = await createHealer("Dsvlight", "Discipline");
    const charC = await characterService.createCharacter(owner, {
      name: charName("Dsvbloom"),
      realm: "Antonidas",
      region: "EU",
      wowClass: "DRUID",
      specialization: "Restoration",
      itemLevel: 640,
    });
    created.characterIds.push(charC.id);

    const run = await createOpenRun(nextStartInRaidWeek(), { healers: 1 });
    const [offerA, offerB, offerC] = await offerCharacters(owner, run.id, [
      { characterId: charA.id, roles: ["HEALER"] },
      { characterId: charB.id, roles: ["HEALER"] },
      { characterId: charC.id, roles: ["HEALER"] },
    ]);
    const notesBeforeDraft = await userNotificationRepository.listForUser(owner.id);

    let mine = await signupService.getMyRuns(owner);
    expect(mine.pending.filter((row) => row.runId === run.id)).toHaveLength(3);
    expect(mine.selected.filter((row) => row.runId === run.id)).toHaveLength(0);
    expect(
      mine.pending.filter((row) => row.runId === run.id).every((row) => row.selectionState === "OFFERED"),
    ).toBe(true);

    let detail = await signupService.listOwnForRun(owner, run.id);
    expect(detail.every((row) => row.selectionState === "OFFERED")).toBe(true);

    const before = await rosterService.getRosterManagementView(lead, run.id);
    await rosterService.saveDraftSelection(lead, {
      runId: run.id,
      version: before.roster.version,
      selections: [{ signupId: offerA!, selectedRole: "HEALER" }],
    });

    mine = await signupService.getMyRuns(owner);
    const draftSelected = mine.selected.filter((row) => row.runId === run.id);
    const stillPending = mine.pending.filter((row) => row.runId === run.id);
    expect(draftSelected).toHaveLength(1);
    expect(draftSelected[0]?.id).toBe(offerA);
    expect(draftSelected[0]?.selectionState).toBe("DRAFT");
    expect(draftSelected[0]?.displayRole).toBe("HEALER");
    expect(draftSelected[0]?.status).toBe("PENDING");
    expect(stillPending).toHaveLength(2);
    expect(stillPending.every((row) => row.selectionState === "OFFERED")).toBe(true);

    detail = await signupService.listOwnForRun(owner, run.id);
    expect(detail.find((row) => row.id === offerA)?.selectionState).toBe("DRAFT");
    expect(detail.filter((row) => row.selectionState === "DRAFT")).toHaveLength(1);

    const otherMine = await signupService.getMyRuns(other);
    expect([...otherMine.pending, ...otherMine.selected].some((row) => row.runId === run.id)).toBe(false);

    // A non-empty draft save moves OPEN → ROSTERING; it never publishes, starts or completes.
    expect((await runRepository.findById(run.id))?.status).toBe("ROSTERING");
    expect(await attendanceRepository.listByRunId(run.id)).toHaveLength(0);
    const notesAfterDraft = await userNotificationRepository.listForUser(owner.id);
    // Established Save Roster path already emits ROSTER_SELECTED on draft save —
    // leave that unchanged; draft visibility must not invent publish-only types.
    const newNotes = notesAfterDraft.filter((row) => !notesBeforeDraft.some((earlier) => earlier.id === row.id));
    expect(newNotes.every((row) => row.type === "ROSTER_SELECTED")).toBe(true);

    const mid = await rosterService.getRosterManagementView(lead, run.id);
    await rosterService.saveDraftSelection(lead, {
      runId: run.id,
      version: mid.roster.version,
      selections: [{ signupId: offerB!, selectedRole: "HEALER" }],
    });

    mine = await signupService.getMyRuns(owner);
    expect(mine.selected.filter((row) => row.runId === run.id).map((row) => row.id)).toEqual([offerB]);
    expect(mine.pending.filter((row) => row.runId === run.id).map((row) => row.id).sort()).toEqual([offerA, offerC].sort());

    const cleared = await rosterService.getRosterManagementView(lead, run.id);
    await rosterService.saveDraftSelection(lead, {
      runId: run.id,
      version: cleared.roster.version,
      selections: [],
    });

    mine = await signupService.getMyRuns(owner);
    expect(mine.selected.filter((row) => row.runId === run.id)).toHaveLength(0);
    expect(mine.pending.filter((row) => row.runId === run.id)).toHaveLength(3);

    const reselect = await rosterService.getRosterManagementView(lead, run.id);
    await rosterService.saveDraftSelection(lead, {
      runId: run.id,
      version: reselect.roster.version,
      selections: [{ signupId: offerA!, selectedRole: "HEALER" }],
    });

    const publishedView = await rosterService.getRosterManagementView(lead, run.id);
    await rosterService.publishRoster(lead, {
      runId: run.id,
      version: publishedView.roster.version,
      acknowledgeWarnings: true,
    });

    mine = await signupService.getMyRuns(owner);
    const publishedSelected = mine.selected.filter((row) => row.runId === run.id);
    // Same Run appears once in selected — no duplicate selected entry after publish.
    expect(publishedSelected.map((row) => row.id)).toEqual([offerA]);
    expect(publishedSelected[0]?.selectionState).toBe("PUBLISHED");
    expect(publishedSelected[0]?.status).toBe("SELECTED");
    expect(mine.pending.filter((row) => row.runId === run.id)).toHaveLength(0);
    expect(mine.notSelected.filter((row) => row.runId === run.id)).toHaveLength(2);
  });

  it("offspec draft role is shown, not character primary role", async () => {
    const character = await createHealer("Dsvoff", "Holy", { playableSpecs: ["Shadow"] });
    expect(character.primaryRole).toBe("HEALER");

    const run = await createOpenRun(nextStartInRaidWeek(), { healers: 0, dps: 1 });
    const signupId = await offerCharacter(owner, run.id, character.id, "RANGED_DPS");

    const before = await rosterService.getRosterManagementView(lead, run.id);
    await rosterService.saveDraftSelection(lead, {
      runId: run.id,
      version: before.roster.version,
      selections: [{ signupId, selectedRole: "RANGED_DPS" }],
    });

    const mine = await signupService.getMyRuns(owner);
    const selected = mine.selected.find((row) => row.id === signupId);
    expect(selected?.selectionState).toBe("DRAFT");
    expect(selected?.displayRole).toBe("RANGED_DPS");
  });

  it("Auto Build Apply surfaces SELECTED_DRAFT without publish", async () => {
    const healer = await createHealer("Dsvauto", "Holy");

    const run = await createOpenRun(nextStartInRaidWeek(), { healers: 1, dps: 0 });
    const signupId = await offerCharacter(owner, run.id, healer.id, "HEALER");

    const proposal = await rosterBuilderService.proposeRoster(lead, run.id);
    expect(proposal.applySelections.some((row) => row.signupId === signupId)).toBe(true);

    await rosterBuilderService.applyRosterProposal(lead, {
      runId: run.id,
      expectedVersion: proposal.rosterVersion,
      selections: proposal.applySelections,
    });

    const roster = await rosterRepository.findByRunId(run.id);
    expect(roster?.publishedAt).toBeNull();

    const mine = await signupService.getMyRuns(owner);
    const selected = mine.selected.find((row) => row.id === signupId);
    expect(selected?.selectionState).toBe("DRAFT");
    expect(selected?.displayRole).toBe("HEALER");
    expect(selected?.status).toBe("PENDING");

    expect(await attendanceRepository.listByRunId(run.id)).toHaveLength(0);
    expect((await runRepository.findById(run.id))?.status).toBe("ROSTERING");
  });

  it("batches draft selection lookup once for many signups", async () => {
    const chars = [];
    for (const prefix of ["Dsvba", "Dsvbb", "Dsvbc"]) chars.push(await createHealer(prefix, "Holy"));

    const run = await createOpenRun(nextStartInRaidWeek(), { healers: 1 });
    const offerIds = await offerCharacters(
      owner,
      run.id,
      chars.map((character) => ({ characterId: character.id, roles: ["HEALER"] })),
    );

    const spy = vi.spyOn(rosterRepository, "listDraftSelectedRolesBySignupIds");
    let lookups: string[][];
    try {
      await signupService.getMyRuns(owner);
    } finally {
      lookups = spy.mock.calls.map(([signupIds]) => [...signupIds]);
      spy.mockRestore();
    }
    expect(lookups).toHaveLength(1);
    expect(lookups[0]).toEqual(expect.arrayContaining(offerIds));
  });

  it("My Runs: a Pending Run block gets the same Run's draft pick as context; raid-ID filtering keeps weeks apart", async () => {
    const blast = await createHealer("Dsvca", "Holy");
    const beast = await createHealer("Dsvcb", "Holy");
    const other1 = await createHealer("Dsvcc", "Holy");

    // Two different raid IDs (weekly reset Wednesday 06:00 Europe/Berlin).
    const thisWeek = await createOpenRun(CURRENT_WEEK_RUN_START, { healers: 1 });
    const nextWeek = await createOpenRun(new Date(Date.parse(CURRENT_WEEK_RUN_START) + 7 * DAY_MS).toISOString(), { healers: 1 });
    const [pickedOffer] = await offerCharacters(owner, thisWeek.id, [
      { characterId: blast.id, roles: ["HEALER"] },
      { characterId: beast.id, roles: ["HEALER"] },
    ]);
    await offerCharacter(owner, nextWeek.id, other1.id, "HEALER");
    const view = await rosterService.getRosterManagementView(lead, thisWeek.id);
    await rosterService.saveDraftSelection(lead, {
      runId: thisWeek.id,
      version: view.roster.version,
      selections: [{ signupId: pickedOffer!, selectedRole: "HEALER" }],
    });

    const now = new Date(RAID_WEEK_TEST_CLOCK);
    const current = await signupService.getMyRuns(owner, { raidId: "current", now });
    expect(current.pending.some((row) => row.runId === nextWeek.id)).toBe(false);
    const groups = groupMyRunsByRun(current.pending, current.selected);
    const block = groups.find((group) => group.runId === thisWeek.id)!;
    expect(block.selectedContext.map((pick) => [pick.id, pick.selectionState, pick.displayRole])).toEqual([
      [pickedOffer, "DRAFT", "HEALER"],
    ]);
    expect(block.offers.map((offer) => offer.characterId)).toEqual([beast.id]);
    // Shared compact title (`contentShortTitle`), not the full raid names.
    expect(block.contentTitle).toBe("Venom");

    const next = await signupService.getMyRuns(owner, { raidId: "next", now });
    const nextGroups = groupMyRunsByRun(next.pending, next.selected);
    expect(nextGroups.map((group) => group.runId)).toContain(nextWeek.id);
    expect(nextGroups.find((group) => group.runId === nextWeek.id)!.selectedContext).toEqual([]);
    expect(nextGroups.some((group) => group.runId === thisWeek.id)).toBe(false);
  });
});
