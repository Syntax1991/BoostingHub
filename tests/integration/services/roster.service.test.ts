import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import type { ConfirmedRosterWarning } from "@/domain/roster-selection-risk";
import { orm } from "@/lib/prisma";
import type { CharacterRole } from "@/models/enums";
import { SEED_IDS } from "@/prisma/seed-ids";
import { activityRepository } from "@/repositories/activity.repository";
import { rosterRepository } from "@/repositories/roster.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { lockoutService } from "@/services/lockout.service";
import { rosterService } from "@/services/roster.service";
import { runDetailService } from "@/services/run-detail.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";
import { testActor } from "@tests/fixtures/actors";
import { assertIsolatedTestDatabase } from "@tests/fixtures/db-fixtures";
import { FEED_TEST_CLOCK, freezeSystemTime, restoreSystemTime } from "@tests/fixtures/time";
import { venomousCreateInput } from "@tests/fixtures/test-run-input";
import { expectDomainError } from "@tests/helpers/domain-error";
import { offerCharacter } from "@tests/helpers/signup-offers";

const ids = {
  kael: SEED_IDS.users.kael,
  thorne: SEED_IDS.users.thorne,
  aelira: SEED_IDS.users.aelira,
  lab: SEED_IDS.runs.rosterLab,
  weekend: SEED_IDS.runs.heroicWeekend,
  normal: SEED_IDS.runs.normalOpen,
  published: SEED_IDS.runs.heroicPublished,
  draft: SEED_IDS.runs.mythicDraft,
  sunday: SEED_IDS.runs.heroicRostering,
  labKaelResto: SEED_IDS.signups.labKaelResto,
  labKaelEle: SEED_IDS.signups.labKaelEle,
  labBrannTank: SEED_IDS.signups.labBrannTank,
  labBrannHoly: SEED_IDS.signups.labBrannHoly,
  labMira: SEED_IDS.signups.labMira,
  labSylva: SEED_IDS.signups.labSylva,
  labThorne: SEED_IDS.signups.labThorne,
  labAelira: SEED_IDS.signups.labAelira,
  publishedKael: SEED_IDS.signups.publishedKael,
  kaelResto: SEED_IDS.characters.kaelResto,
  raid: SEED_IDS.raid,
};

const lockoutIds: string[] = [];
const ownedRunIds: string[] = [];

async function cleanupOwnedRun(runId: string) {
  assertIsolatedTestDatabase();
  const attendance = await orm.RunAttendance.where({ runId }).select("id").all();
  for (const row of attendance) {
    await orm.RunAttendance.where({ id: (row as { id: string }).id }).deleteAndCount();
  }
  const start = await orm.RunStartSnapshot.where({ runId }).first();
  if (start) await orm.RunStartSnapshot.where({ runId }).deleteAndCount();
  await clearRosterRows(runId);
  const roster = await orm.RunRoster.where({ runId }).first();
  if (roster) await orm.RunRoster.where({ id: (roster as { id: string }).id }).deleteAndCount();
  const signups = await orm.RunSignup.where({ runId }).select("id").all();
  for (const row of signups) {
    const signupId = (row as { id: string }).id;
    const roles = await orm.RunSignupRole.where({ signupId }).select("id").all();
    for (const role of roles) {
      await orm.RunSignupRole.where({ id: (role as { id: string }).id }).deleteAndCount();
    }
    await orm.RunSignup.where({ id: signupId }).deleteAndCount();
  }
  await orm.Run.where({ id: runId }).deleteAndCount();
}

/** Unique BOOSTER signups across role projections (dedupe by signup id). */
function rosterBoosters<T extends { id: string }>(view: { boosters: T[] }): T[] {
  return view.boosters;
}

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
): AuthenticatedUser {
  return testActor(id, accountRole, { name, email: `${id}@dev.boostting.local` });
}

/** Test-local adapter: production path is saveDraftSelection (full draft replace). */
async function setDraftSelection(
  actor: AuthenticatedUser,
  input: {
    runId: string;
    signupId: string;
    selected: boolean;
    version: number;
    selectedRole?: CharacterRole | null;
    confirmedWarnings?: ConfirmedRosterWarning[];
  },
) {
  const view = await rosterService.getRosterManagementView(actor, input.runId);
  const all = [...view.boosters, ...view.groups.lootbuddies];
  const target = all.find((row) => row.id === input.signupId);
  const others = all
    .filter((row) => {
      if (!row.draftSelected || row.id === input.signupId) return false;
      if (
        input.selected &&
        target?.participationType === "BOOSTER" &&
        row.participationType === "BOOSTER" &&
        row.userId === target.userId
      ) {
        return false;
      }
      return true;
    })
    .map((row) => ({ signupId: row.id, selectedRole: row.selectedRole }));
  const selections = input.selected
    ? [...others, { signupId: input.signupId, selectedRole: input.selectedRole ?? null }]
    : others;
  await rosterService.saveDraftSelection(actor, {
    runId: input.runId,
    version: input.version,
    selections,
    confirmedWarnings: input.confirmedWarnings,
  });
}

async function clearRosterRows(runId: string) {
  assertIsolatedTestDatabase();
  const roster = await orm.RunRoster.where({ runId }).first();
  if (!roster) return;
  const rosterId = (roster as { id: string }).id;
  const entries = await orm.RunRosterEntry.where({ rosterId }).all();
  for (const entry of entries) {
    await orm.RunRosterEntry.where({ id: (entry as { id: string }).id }).deleteAndCount();
  }
}

/**
 * Restore the seeded roster-lab + published runs so this suite is repeatable
 * without `test:db:reset`. Only touches SEED_IDS rows this file mutates.
 */
async function restoreSeededRosterFixtures() {
  assertIsolatedTestDatabase();

  // Lab: OPEN, no draft selection, seed signup statuses.
  await orm.Run.where({ id: ids.lab }).update({
    status: "OPEN",
    signupsOpen: true,
  });
  await clearRosterRows(ids.lab);
  const labRoster = await orm.RunRoster.where({ runId: ids.lab }).first();
  if (labRoster) {
    await orm.RunRoster.where({ id: (labRoster as { id: string }).id }).update({
      state: "DRAFT",
      version: 1,
      publishedAt: null,
      publishedById: null,
      runChangedSinceAck: false,
    });
  }
  const labStatuses: Array<[string, "PENDING" | "WITHDRAWN"]> = [
    [ids.labKaelResto, "PENDING"],
    [ids.labKaelEle, "PENDING"],
    [ids.labBrannTank, "PENDING"],
    [ids.labBrannHoly, "WITHDRAWN"],
    [ids.labMira, "PENDING"],
    [ids.labSylva, "PENDING"],
    [ids.labThorne, "PENDING"],
    [ids.labAelira, "PENDING"],
  ];
  for (const [signupId, status] of labStatuses) {
    await orm.RunSignup.where({ id: signupId }).update({
      status,
      publishedRole: null,
    });
  }

  // Published: keep PUBLISHED + publishedAt, empty draft at version 1 (needsPublishSeed).
  await orm.Run.where({ id: ids.published }).update({
    status: "PUBLISHED",
    signupsOpen: false,
  });
  await clearRosterRows(ids.published);
  const publishedRoster = await orm.RunRoster.where({ runId: ids.published }).first();
  if (publishedRoster) {
    const now = (publishedRoster as { publishedAt: string | null }).publishedAt ?? new Date().toISOString();
    await orm.RunRoster.where({ id: (publishedRoster as { id: string }).id }).update({
      state: "PUBLISHED",
      version: 1,
      publishedAt: now,
      publishedById: ids.thorne,
      runChangedSinceAck: false,
    });
  }
  await orm.RunSignup.where({ id: ids.publishedKael }).update({ status: "SELECTED", publishedRole: "RANGED_DPS" });
  await orm.RunSignup.where({ id: SEED_IDS.signups.publishedMira }).update({ status: "SELECTED", publishedRole: null });
  await orm.RunSignup.where({ id: SEED_IDS.signups.publishedBrann }).update({
    status: "NOT_SELECTED",
    publishedRole: null,
  });
}


const kael = asUser(ids.kael, "Kael Stormhowl");
const thorne = asUser(ids.thorne, "Thorne Ironvein", "RAID_LEAD");
const aelira = asUser(ids.aelira, "Aelira Nightwatch", "ADMIN");
const otherLead = asUser(ids.kael, "Kael Stormhowl", "RAID_LEAD");

// Seeded Sylva is an approved booster; the Booster role is account-level (not
// difficulty-scoped), so the "unapproved booster" fixture for the lab Run is a
// revoked Booster role, restored afterwards for the rest of the suite.
const SYLVA_USER_ID = "66666666-6666-4666-8666-666666666666";

async function setSylvaBooster(isBooster: boolean) {
  await orm.User.where({ id: SYLVA_USER_ID }).update({ isBooster });
}

// Deterministic wall clock (see FEED_TEST_CLOCK), frozen once for the whole file
// so time stays monotonic across tests that share state; the global newest-first
// feeds asserted on here must not be outranked by rows other suites left behind.
beforeAll(() => freezeSystemTime(FEED_TEST_CLOCK, { advance: true }));
afterAll(() => restoreSystemTime());

beforeAll(async () => {
  assertIsolatedTestDatabase();
  await restoreSeededRosterFixtures();
  await setSylvaBooster(false);
});

afterAll(async () => {
  assertIsolatedTestDatabase();
  for (const runId of ownedRunIds.splice(0)) {
    await cleanupOwnedRun(runId);
  }
  for (const id of lockoutIds) {
    await orm.CharacterRaidLockout.where({ id }).deleteAndCount();
  }
  await setSylvaBooster(true);
  await restoreSeededRosterFixtures();
});

describe("rosterService authorization", () => {
  it("rejects USER roster reads and mutations", async () => {
    await expectDomainError(rosterService.getRosterManagementView(kael, ids.lab), "RUN_NOT_MANAGEABLE");
    await expectDomainError(
      setDraftSelection(kael, {
        runId: ids.lab,
        signupId: ids.labKaelResto,
        selected: true,
        version: 1,
      }),
      "RUN_NOT_MANAGEABLE",
    );
    await expectDomainError(
      rosterService.publishRoster(kael, { runId: ids.lab, version: 1, acknowledgeWarnings: true }),
      "RUN_NOT_MANAGEABLE",
    );
  });

  it("lets a raid lead manage an assigned run and rejects another lead's run", async () => {
    const own = await rosterService.getRosterManagementView(thorne, ids.weekend);
    expect(own.run.id).toBe(ids.weekend);
    await expectDomainError(rosterService.getRosterManagementView(thorne, ids.normal), "RUN_NOT_MANAGEABLE");
    await expectDomainError(rosterService.getRosterManagementView(otherLead, ids.weekend), "RUN_NOT_MANAGEABLE");
  });

  it("lets an admin manage a run assigned to another raid lead", async () => {
    const view = await rosterService.getRosterManagementView(aelira, ids.normal);
    expect(view.run.id).toBe(ids.normal);
  });
});

describe("rosterService groups — active offer filtering", () => {
  it("excludes a WITHDRAWN offer from the roster candidate groups while keeping the same User's other active offer", async () => {
    const view = await rosterService.getRosterManagementView(thorne, ids.lab);
    const allIds = [...rosterBoosters(view), ...view.groups.lootbuddies].map(
      (item) => item.id,
    );
    // Brann has two offers on this run: labBrannTank (PENDING) and labBrannHoly (WITHDRAWN).
    expect(allIds).not.toContain(ids.labBrannHoly);
    expect(allIds).toContain(ids.labBrannTank);
  });
});

describe("rosterService draft", () => {
  it("selects a pending signup, persists it, and returns it after reload", async () => {
    const before = await rosterService.getRosterManagementView(thorne, ids.lab);
    await setDraftSelection(thorne, {
      runId: ids.lab,
      signupId: ids.labKaelResto,
      selected: true,
      version: before.roster.version,
    });
    const after = await rosterService.getRosterManagementView(thorne, ids.lab);
    const selected = rosterBoosters(after).find((item) => item.id === ids.labKaelResto);
    expect(selected?.draftSelected).toBe(true);
    expect(after.run.status).toBe("ROSTERING");
    const roster = await rosterRepository.findByRunId(ids.lab);
    expect(roster?.selectedSignupIds).toContain(ids.labKaelResto);
  });

  it("deselects a draft signup", async () => {
    const view = await rosterService.getRosterManagementView(thorne, ids.lab);
    await setDraftSelection(thorne, {
      runId: ids.lab,
      signupId: ids.labKaelResto,
      selected: false,
      version: view.roster.version,
    });
    const after = await rosterService.getRosterManagementView(thorne, ids.lab);
    expect(rosterBoosters(after).find((item) => item.id === ids.labKaelResto)?.draftSelected).toBe(false);
  });

  it("rejects withdrawn signups, unknown IDs, and signups from another run", async () => {
    const view = await rosterService.getRosterManagementView(thorne, ids.lab);
    await expectDomainError(
      setDraftSelection(thorne, {
        runId: ids.lab,
        signupId: ids.labBrannHoly,
        selected: true,
        version: view.roster.version,
      }),
      "SIGNUP_WITHDRAWN",
    );
    await expectDomainError(
      setDraftSelection(thorne, {
        runId: ids.lab,
        signupId: "s0000000-0000-4000-8000-000000000000",
        selected: true,
        version: view.roster.version,
      }),
      "NOT_FOUND",
    );
    await expectDomainError(
      setDraftSelection(thorne, {
        runId: ids.lab,
        signupId: ids.publishedKael,
        selected: true,
        version: view.roster.version,
      }),
      "INVALID_ROSTER_SELECTION",
    );
  });

  it("replaces a user's previously selected signup instead of stacking two slots", async () => {
    let view = await rosterService.getRosterManagementView(thorne, ids.lab);
    await setDraftSelection(thorne, {
      runId: ids.lab,
      signupId: ids.labKaelResto,
      selected: true,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(thorne, ids.lab);
    await setDraftSelection(thorne, {
      runId: ids.lab,
      signupId: ids.labKaelEle,
      selected: true,
      version: view.roster.version,
    });
    const after = await rosterService.getRosterManagementView(thorne, ids.lab);
    expect(rosterBoosters(after).find((item) => item.id === ids.labKaelResto)?.draftSelected).toBe(false);
    expect(rosterBoosters(after).find((item) => item.id === ids.labKaelEle)?.draftSelected).toBe(true);
  });

  it("rejects a stale roster version", async () => {
    const view = await rosterService.getRosterManagementView(thorne, ids.lab);
    await setDraftSelection(thorne, {
      runId: ids.lab,
      signupId: ids.labThorne,
      selected: true,
      version: view.roster.version,
    });
    await expectDomainError(
      setDraftSelection(thorne, {
        runId: ids.lab,
        signupId: ids.labBrannTank,
        selected: true,
        version: view.roster.version,
      }),
      "ROSTER_ALREADY_CHANGED",
    );
  });
});

describe("rosterService saveDraftSelection", () => {
  it("saves multiple selections atomically and increments version once", async () => {
    const lab = await rosterService.getRosterManagementView(thorne, ids.lab);
    const selectedSignupIds = [ids.labThorne, ids.labBrannTank, ids.labKaelResto];
    await rosterService.saveDraftSelection(thorne, {
      runId: ids.lab,
      version: lab.roster.version,
      selections: selectedSignupIds.map((signupId) => ({ signupId, selectedRole: null })),
    });
    const after = await rosterService.getRosterManagementView(thorne, ids.lab);
    expect(after.roster.version).toBe(lab.roster.version + 1);
    expect(rosterBoosters(after).find((item) => item.id === ids.labThorne)?.draftSelected).toBe(true);
    expect(rosterBoosters(after).find((item) => item.id === ids.labBrannTank)?.draftSelected).toBe(true);
    expect(rosterBoosters(after).find((item) => item.id === ids.labKaelResto)?.draftSelected).toBe(true);
    const roster = await rosterRepository.findByRunId(ids.lab);
    expect(roster?.selectedSignupIds.sort()).toEqual([...selectedSignupIds].sort());
  });

  it("replaces the previous draft selection set", async () => {
    const view = await rosterService.getRosterManagementView(thorne, ids.lab);
    await rosterService.saveDraftSelection(thorne, {
      runId: ids.lab,
      version: view.roster.version,
      selections: [{ signupId: ids.labBrannTank, selectedRole: null }, { signupId: ids.labKaelEle, selectedRole: null }],
    });
    const after = await rosterService.getRosterManagementView(thorne, ids.lab);
    expect(rosterBoosters(after).find((item) => item.id === ids.labThorne)?.draftSelected).toBe(false);
    expect(rosterBoosters(after).find((item) => item.id === ids.labKaelResto)?.draftSelected).toBe(false);
    expect(rosterBoosters(after).find((item) => item.id === ids.labBrannTank)?.draftSelected).toBe(true);
    expect(rosterBoosters(after).find((item) => item.id === ids.labKaelEle)?.draftSelected).toBe(true);
  });

  it("rejects two booster offers from the same user in one batch", async () => {
    const view = await rosterService.getRosterManagementView(thorne, ids.lab);
    await expectDomainError(
      rosterService.saveDraftSelection(thorne, {
        runId: ids.lab,
        version: view.roster.version,
        selections: [{ signupId: ids.labKaelResto, selectedRole: null }, { signupId: ids.labKaelEle, selectedRole: null }],
      }),
      "INVALID_ROSTER_SELECTION",
    );
  });

  it("allows booster plus lootbuddy and multiple lootbuddies", async () => {
    const secondLootbuddyId = "s8888888-8888-4888-8888-888888888889";
    if (!(await signupRepository.findById(secondLootbuddyId))) {
      await orm.RunSignup.create({
        id: secondLootbuddyId,
        runId: ids.lab,
        userId: ids.aelira,
        characterId: null,
        participationType: "LOOTBUDDY",

        isBackup: false,
        status: "PENDING",
        publishedRole: null,
        lootbuddyClass: "MAGE",
        lootbuddyMode: "LOOT_ONLY",
        lootbuddyVerification: "NONE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    const view = await rosterService.getRosterManagementView(thorne, ids.lab);
    await rosterService.saveDraftSelection(thorne, {
      runId: ids.lab,
      version: view.roster.version,
      selections: [{ signupId: ids.labKaelResto, selectedRole: null }, { signupId: ids.labMira, selectedRole: null }, { signupId: secondLootbuddyId, selectedRole: null }],
    });
    const after = await rosterService.getRosterManagementView(thorne, ids.lab);
    expect(rosterBoosters(after).find((item) => item.id === ids.labKaelResto)?.draftSelected).toBe(true);
    expect(after.groups.lootbuddies.find((item) => item.id === ids.labMira)?.draftSelected).toBe(true);
    expect(after.groups.lootbuddies.find((item) => item.id === secondLootbuddyId)?.draftSelected).toBe(true);
  });

  it("rejects withdrawn and unapproved booster selections", async () => {
    const view = await rosterService.getRosterManagementView(thorne, ids.lab);
    await expectDomainError(
      rosterService.saveDraftSelection(thorne, {
        runId: ids.lab,
        version: view.roster.version,
        selections: [{ signupId: ids.labBrannHoly, selectedRole: null }],
      }),
      "SIGNUP_WITHDRAWN",
    );
    await expectDomainError(
      rosterService.saveDraftSelection(thorne, {
        runId: ids.lab,
        version: view.roster.version,
        selections: [{ signupId: ids.labSylva, selectedRole: null }],
      }),
      "INVALID_ROSTER_SELECTION",
    );
  });

  it("rejects a stale roster version on batch save", async () => {
    const view = await rosterService.getRosterManagementView(thorne, ids.lab);
    await rosterService.saveDraftSelection(thorne, {
      runId: ids.lab,
      version: view.roster.version,
      selections: [{ signupId: ids.labThorne, selectedRole: null }],
    });
    await expectDomainError(
      rosterService.saveDraftSelection(thorne, {
        runId: ids.lab,
        version: view.roster.version,
        selections: [{ signupId: ids.labBrannTank, selectedRole: null }],
      }),
      "ROSTER_ALREADY_CHANGED",
    );
  });

  it("transitions OPEN to ROSTERING only when the saved selection is non-empty", async () => {
    const run = await runService.createRun(thorne, venomousCreateInput({ difficulty: "HEROIC", lootType: "UNSAVED", venomousPlannedBossCount: 8, scheduledStartAt: "2030-06-15T18:00:00.000Z", desiredTankCount: 2, desiredHealerCount: 4, desiredDpsCount: 14 }));
    ownedRunIds.push(run.id);
    await runService.openRun(thorne, run.id);
    const signupId = await offerCharacter(kael, run.id, ids.kaelResto, "HEALER");

    const empty = await rosterService.getRosterManagementView(thorne, run.id);
    expect(empty.run.status).toBe("OPEN");
    await rosterService.saveDraftSelection(thorne, {
      runId: run.id,
      version: empty.roster.version,
      selections: [],
    });
    expect((await rosterService.getRosterManagementView(thorne, run.id)).run.status).toBe("OPEN");

    const openView = await rosterService.getRosterManagementView(thorne, run.id);
    await rosterService.saveDraftSelection(thorne, {
      runId: run.id,
      version: openView.roster.version,
      selections: [{ signupId, selectedRole: null }],
    });
    expect((await rosterService.getRosterManagementView(thorne, run.id)).run.status).toBe("ROSTERING");
  });
});

describe("rosterService publish validation", () => {
  it("blocks publishing a selected booster whose access is not approved", async () => {
    let view = await rosterService.getRosterManagementView(thorne, ids.lab);
    // Production saveDraftSelection refuses unapproved Boosters; plant the
    // draft row via the repository so publish validation still has a target.
    await expectDomainError(
      setDraftSelection(thorne, {
        runId: ids.lab,
        signupId: ids.labSylva,
        selected: true,
        version: view.roster.version,
      }),
      "INVALID_ROSTER_SELECTION",
    );
    const roster = await rosterRepository.ensure(ids.lab);
    const labRun = await orm.Run.where({ id: ids.lab }).first();
    await rosterRepository.setSignupSelected({
      rosterId: roster.id,
      expectedVersion: (roster as { version: number }).version,
      signupId: ids.labSylva,
      selected: true,
      selectedRole: "RANGED_DPS",
      replaceSignupIds: [],
      characterId: SEED_IDS.characters.sylvaHunter,
      targetRunId: ids.lab,
      scheduledStartAt: (labRun as { scheduledStartAt: string }).scheduledStartAt,
    });
    view = await rosterService.getRosterManagementView(thorne, ids.lab);
    expect(view.validation.canPublish).toBe(false);
    expect(view.validation.blockers.some((item) => item.code === "BOOSTER_ACCESS_INVALID")).toBe(true);
    await expectDomainError(
      rosterService.publishRoster(thorne, {
        runId: ids.lab,
        version: view.roster.version,
        acknowledgeWarnings: true,
      }),
      "ROSTER_VALIDATION_FAILED",
    );
    view = await rosterService.getRosterManagementView(thorne, ids.lab);
    await setDraftSelection(thorne, {
      runId: ids.lab,
      signupId: ids.labSylva,
      selected: false,
      version: view.roster.version,
    });
  });

  it("shows raid-save info for a selected character locked for the run reset — informational only, never a publish blocker", async () => {
    const lockoutId = crypto.randomUUID();
    lockoutIds.push(lockoutId);
    const resetIdentifier = lockoutService.getResetIdentifierForRun("EU", "2026-09-28T18:00:00.000Z");
    await orm.CharacterRaidLockout.create({
      id: lockoutId,
      characterId: ids.kaelResto,
      raidId: ids.raid,
      difficulty: "HEROIC",
      resetIdentifier,
      bossesDefeated: 8,
      isComplete: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    let view = await rosterService.getRosterManagementView(thorne, ids.lab);
    if (!rosterBoosters(view).find((item) => item.id === ids.labKaelResto)?.draftSelected) {
      // A known save on this UNSAVED Run is a WARNING — the pick carries the
      // Raid Lead's acknowledgement of the warning the roster card shows.
      const pick = rosterBoosters(view).find((item) => item.id === ids.labKaelResto)!;
      await setDraftSelection(thorne, {
        runId: ids.lab,
        signupId: ids.labKaelResto,
        selected: true,
        version: view.roster.version,
        confirmedWarnings: pick.selectionRisk.warnings.map((warning) => ({
          signupId: pick.id,
          type: warning.type,
          fingerprint: warning.fingerprint,
        })),
      });
      view = await rosterService.getRosterManagementView(thorne, ids.lab);
    }
    const candidate = rosterBoosters(view).find((item) => item.id === ids.labKaelResto);
    expect(candidate?.contentSaves[0]?.raidSave).toEqual({
      raidId: ids.raid,
      difficulty: "HEROIC",
      resetIdentifier,
      bossesDefeated: 8,
      totalBossCount: 8,
      isComplete: true,
    });
    // No LOCKOUT_CONFLICT blocker exists anymore at all — raid saves never block.
    expect(view.validation.blockers.some((item) => item.code === "LOCKOUT_CONFLICT")).toBe(false);

    await orm.CharacterRaidLockout.where({ id: lockoutId }).delete();
    lockoutIds.splice(lockoutIds.indexOf(lockoutId), 1);
    await setDraftSelection(thorne, {
      runId: ids.lab,
      signupId: ids.labKaelResto,
      selected: false,
      version: view.roster.version,
    });
  });

  it("keeps composition mismatch as warnings on the Sunday draft", async () => {
    const view = await rosterService.getRosterManagementView(thorne, ids.sunday);
    expect(view.validation.canPublish).toBe(true);
    expect(view.validation.warnings.some((item) => item.message.includes("Healer composition is 3 / 4"))).toBe(true);
    expect(view.composition.lootbuddies.selected).toBe(1);
  });

  it("rejects publishing a draft-status run", async () => {
    const view = await rosterService.getRosterManagementView(thorne, ids.draft);
    expect(view.validation.canPublish).toBe(false);
    await expectDomainError(
      rosterService.publishRoster(thorne, {
        runId: ids.draft,
        version: view.roster.version,
        acknowledgeWarnings: true,
      }),
      "ROSTER_VALIDATION_FAILED",
    );
  });
});

describe("rosterService publish and republish", () => {
  it("publishes selected draft rows atomically and leaves withdrawn rows withdrawn", async () => {
    let view = await rosterService.getRosterManagementView(thorne, ids.lab);
    for (const signupId of [ids.labThorne, ids.labBrannTank, ids.labKaelResto, ids.labMira]) {
      const current = await rosterService.getRosterManagementView(thorne, ids.lab);
      if (![...rosterBoosters(current), ...current.groups.lootbuddies]
        .find((item) => item.id === signupId)?.draftSelected) {
        await setDraftSelection(thorne, {
          runId: ids.lab,
          signupId,
          selected: true,
          version: current.roster.version,
        });
      }
    }
    const kaelEle = await rosterService.getRosterManagementView(thorne, ids.lab);
    if (rosterBoosters(kaelEle).find((item) => item.id === ids.labKaelEle)?.draftSelected) {
      await setDraftSelection(thorne, {
        runId: ids.lab,
        signupId: ids.labKaelEle,
        selected: false,
        version: kaelEle.roster.version,
      });
    }

    view = await rosterService.getRosterManagementView(thorne, ids.lab);
    await rosterService.publishRoster(thorne, {
      runId: ids.lab,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });

    expect((await signupRepository.findById(ids.labThorne))?.status).toBe("SELECTED");
    expect((await signupRepository.findById(ids.labBrannTank))?.status).toBe("SELECTED");
    expect((await signupRepository.findById(ids.labKaelResto))?.status).toBe("SELECTED");
    expect((await signupRepository.findById(ids.labMira))?.status).toBe("SELECTED");
    expect((await signupRepository.findById(ids.labKaelEle))?.status).toBe("NOT_SELECTED");
    expect((await signupRepository.findById(ids.labSylva))?.status).toBe("NOT_SELECTED");
    expect((await signupRepository.findById(ids.labAelira))?.status).toBe("NOT_SELECTED");
    expect((await signupRepository.findById(ids.labBrannHoly))?.status).toBe("WITHDRAWN");

    const published = await rosterService.getRosterManagementView(thorne, ids.lab);
    expect(published.run.status).toBe("PUBLISHED");
    expect(published.roster.publishedByName).toBe("Thorne Ironvein");
    expect(published.roster.publishedAt).toBeTruthy();
    expect(published.roster.state).toBe("PUBLISHED");
  });

  it("records a roster published activity event", async () => {
    const latest = await activityRepository.findLatestByType("ROSTER_PUBLISHED");
    expect(latest).toBeTruthy();
    const row = await orm.ActivityEvent.where({ id: latest!.id }).first();
    expect((row as { message: string } | null)?.message).toBe("Published a roster.");
  });

  it("republishes replacements without leaving a partial roster", async () => {
    let view = await rosterService.getRosterManagementView(thorne, ids.lab);
    await setDraftSelection(thorne, {
      runId: ids.lab,
      signupId: ids.labKaelEle,
      selected: true,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(thorne, ids.lab);
    await setDraftSelection(thorne, {
      runId: ids.lab,
      signupId: ids.labAelira,
      selected: true,
      // Multi-role Mistweaver/Windwalker fixture — concrete role required.
      selectedRole: "HEALER",
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(thorne, ids.lab);
    await rosterService.publishRoster(thorne, {
      runId: ids.lab,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });

    expect((await signupRepository.findById(ids.labKaelEle))?.status).toBe("SELECTED");
    expect((await signupRepository.findById(ids.labKaelResto))?.status).toBe("NOT_SELECTED");
    expect((await signupRepository.findById(ids.labAelira))?.status).toBe("SELECTED");
    expect((await signupRepository.findById(ids.labThorne))?.status).toBe("SELECTED");
    expect((await signupRepository.findById(ids.labBrannHoly))?.status).toBe("WITHDRAWN");
    expect((await rosterService.getRosterManagementView(thorne, ids.lab)).run.status).toBe("PUBLISHED");
  });

  it("records a roster updated event on republication", async () => {
    const latest = await activityRepository.findLatestByType("ROSTER_UPDATED");
    expect(latest).toBeTruthy();
    const row = await orm.ActivityEvent.where({ id: latest!.id }).first();
    expect((row as { message: string } | null)?.message).toBe("Updated a published roster.");
  });

  it("seeds a published roster draft without reverting live signup statuses", async () => {
    const view = await rosterService.getRosterManagementView(thorne, ids.published);
    expect(view.roster.needsPublishSeed).toBe(true);
    expect((await signupRepository.findById(ids.publishedKael))?.status).toBe("SELECTED");
    await rosterService.preparePublishedRosterForEditing(thorne, {
      runId: ids.published,
      version: view.roster.version,
    });
    const after = await rosterService.getRosterManagementView(thorne, ids.published);
    expect(rosterBoosters(after).find((item) => item.id === ids.publishedKael)?.draftSelected).toBe(true);
    expect((await signupRepository.findById(ids.publishedKael))?.status).toBe("SELECTED");
  });

  it("a selected player on a published run can only withdraw with a reason", async () => {
    await expectDomainError(signupService.withdrawSignup(kael, ids.publishedKael), "WITHDRAW_REASON_REQUIRED");
  });
});

/** Runs start with Booster signups for the Raid Lead's Characters; these tests count only their own offers. */
async function withdrawRaidLeadBootstrap(runId: string) {
  const thorneActor = asUser(ids.thorne, "Thorne Ironvein", "RAID_LEAD");
  const rows = (await orm.RunSignup.where({ runId, userId: ids.thorne }).select("id").all()) as Array<{ id: string }>;
  for (const row of rows) await signupService.withdrawSignup(thorneActor, row.id);
}

describe("rosterService publishedRole snapshot", () => {
  const createdCharacterIds: string[] = [];
  const createdRunIds: string[] = [];

  afterAll(async () => {
    assertIsolatedTestDatabase();
    for (const runId of createdRunIds) {
      await cleanupOwnedRun(runId);
    }
    for (const id of createdCharacterIds) {
      await orm.Character.where({ id }).deleteAndCount();
    }
  });

  it("freezes publishedRole across a replacement draft role change until republish", async () => {
    const shamanId = crypto.randomUUID();
    createdCharacterIds.push(shamanId);
    const now = new Date().toISOString();
    await orm.Character.create({
      id: shamanId,
      userId: ids.kael,
      name: "Testblast",
      realm: "Antonidas",
      normalizedName: "testblast",
      normalizedRealm: "antonidas",
      region: "EU",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      primaryRole: "HEALER",
      itemLevel: 700,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await orm.CharacterPlayableSpec.create({
      id: crypto.randomUUID(),
      characterId: shamanId,
      specialization: "Elemental",
      createdAt: now,
    });

    const run = await runService.createRun(thorne, venomousCreateInput({ difficulty: "HEROIC", lootType: "UNSAVED", venomousPlannedBossCount: 8, scheduledStartAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(), desiredTankCount: 0, desiredHealerCount: 1, desiredDpsCount: 0 }));
    createdRunIds.push(run.id);
    await runService.openRun(thorne, run.id);

    await signupService.setCharacterOffers(kael, {
      runId: run.id,
      offers: [{ characterId: shamanId, offeredRoles: ["HEALER", "RANGED_DPS"] }],
    });
    const signup = (await signupRepository.listByRunAndUser(run.id, ids.kael)).find(
      (row) => row.status === "PENDING",
    )!;

    let view = await rosterService.getRosterManagementView(thorne, run.id);
    // Multi-role offer projects into every offered role section (visual duplication).
    expect(view.groups.healers.filter((item) => item.id === signup.id)).toHaveLength(1);
    expect(view.groups.rangedDps.filter((item) => item.id === signup.id)).toHaveLength(1);
    expect(view.groups.meleeDps.filter((item) => item.id === signup.id)).toHaveLength(0);
    expect(view.groups.legacyDps.filter((item) => item.id === signup.id)).toHaveLength(0);
    expect(view.groups.dps.filter((item) => item.id === signup.id)).toHaveLength(1);
    expect(view.groups.tanks.filter((item) => item.id === signup.id)).toHaveLength(0);
    expect(view.groups.healers.find((item) => item.id === signup.id)?.groupRole).toBe("HEALER");
    expect(view.groups.rangedDps.find((item) => item.id === signup.id)?.groupRole).toBe("RANGED_DPS");
    expect(view.groups.dps.find((item) => item.id === signup.id)?.groupRole).toBe("RANGED_DPS");
    // Domain identity remains one signup.
    expect(rosterBoosters(view).filter((item) => item.id === signup.id)).toHaveLength(1);

    await rosterService.saveDraftSelection(thorne, {
      runId: run.id,
      version: view.roster.version,
      selections: [{ signupId: signup.id, selectedRole: "HEALER" }],
    });
    view = await rosterService.getRosterManagementView(thorne, run.id);
    await rosterService.publishRoster(thorne, {
      runId: run.id,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });

    let live = await signupRepository.findById(signup.id);
    expect(live?.status).toBe("SELECTED");
    expect(live?.publishedRole).toBe("HEALER");

    const publishedView = await rosterService.getPublishedRosterView(run.id);
    expect(publishedView?.members.find((m) => m.signupId === signup.id)?.selectedRole).toBe("HEALER");

    const detailBefore = await runDetailService.getRunDetail(thorne, run.id);
    expect(detailBefore.finalSetupPreview?.groups.healers.some((m) => m.characterName === "Testblast")).toBe(true);
    expect(detailBefore.finalSetupPreview?.groups.dps.some((m) => m.characterName === "Testblast")).toBe(false);

    view = await rosterService.getRosterManagementView(thorne, run.id);
    await rosterService.preparePublishedRosterForEditing(thorne, {
      runId: run.id,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(thorne, run.id);
    expect(rosterBoosters(view).find((item) => item.id === signup.id)?.selectedRole).toBe("HEALER");

    await rosterService.saveDraftSelection(thorne, {
      runId: run.id,
      version: view.roster.version,
      selections: [{ signupId: signup.id, selectedRole: "RANGED_DPS" }],
    });

    const draft = await rosterRepository.findByRunId(run.id);
    expect(draft?.selections.find((s) => s.signupId === signup.id)?.selectedRole).toBe("RANGED_DPS");
    live = await signupRepository.findById(signup.id);
    expect(live?.publishedRole).toBe("HEALER");
    expect((await rosterService.getPublishedRosterView(run.id))?.members.find((m) => m.signupId === signup.id)?.selectedRole).toBe(
      "HEALER",
    );

    const detailDraft = await runDetailService.getRunDetail(thorne, run.id);
    expect(detailDraft.finalSetupPreview?.groups.healers.some((m) => m.characterName === "Testblast")).toBe(true);
    expect(detailDraft.finalSetupPreview?.groups.dps.some((m) => m.characterName === "Testblast")).toBe(false);

    view = await rosterService.getRosterManagementView(thorne, run.id);
    await rosterService.publishRoster(thorne, {
      runId: run.id,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });
    live = await signupRepository.findById(signup.id);
    expect(live?.publishedRole).toBe("RANGED_DPS");
    expect((await rosterService.getPublishedRosterView(run.id))?.members.find((m) => m.signupId === signup.id)?.selectedRole).toBe(
      "RANGED_DPS",
    );

    const detailAfter = await runDetailService.getRunDetail(thorne, run.id);
    expect(detailAfter.finalSetupPreview?.groups.dps.some((m) => m.characterName === "Testblast")).toBe(true);
    expect(detailAfter.finalSetupPreview?.groups.healers.some((m) => m.characterName === "Testblast")).toBe(false);
  });

  it("projects a three-role offer into tanks/healers/dps once each and counts composition once", async () => {
    const thorne = asUser(ids.thorne, "Thorne Ironvein", "RAID_LEAD");
    const kael = asUser(ids.kael, "Kael Stormeye");
    const now = new Date().toISOString();
    const paladinId = crypto.randomUUID();
    createdCharacterIds.push(paladinId);

    await orm.Character.create({
      id: paladinId,
      userId: ids.kael,
      name: "Testpal",
      realm: "Antonidas",
      normalizedName: "testpal",
      normalizedRealm: "antonidas",
      region: "EU",
      wowClass: "PALADIN",
      specialization: "Holy",
      primaryRole: "HEALER",
      itemLevel: 700,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await orm.CharacterPlayableSpec.create({
      id: crypto.randomUUID(),
      characterId: paladinId,
      specialization: "Protection",
      createdAt: now,
    });
    await orm.CharacterPlayableSpec.create({
      id: crypto.randomUUID(),
      characterId: paladinId,
      specialization: "Retribution",
      createdAt: now,
    });

    const run = await runService.createRun(thorne, venomousCreateInput({ difficulty: "HEROIC", lootType: "UNSAVED", venomousPlannedBossCount: 8, scheduledStartAt: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString(), desiredTankCount: 1, desiredHealerCount: 1, desiredDpsCount: 1 }));
    createdRunIds.push(run.id);
    await runService.openRun(thorne, run.id);
    await withdrawRaidLeadBootstrap(run.id);

    await signupService.setCharacterOffers(kael, {
      runId: run.id,
      offers: [{ characterId: paladinId, offeredRoles: ["TANK", "HEALER", "MELEE_DPS"] }],
    });
    const signup = (await signupRepository.listByRunAndUser(run.id, ids.kael)).find(
      (row) => row.status === "PENDING",
    )!;

    let view = await rosterService.getRosterManagementView(thorne, run.id);
    expect(view.groups.tanks.filter((item) => item.id === signup.id)).toHaveLength(1);
    expect(view.groups.healers.filter((item) => item.id === signup.id)).toHaveLength(1);
    expect(view.groups.dps.filter((item) => item.id === signup.id)).toHaveLength(1);
    expect(view.boosters.filter((item) => item.id === signup.id)).toHaveLength(1);
    expect(view.boosters).toHaveLength(1);
    expect(view.groups.tanks.length + view.groups.healers.length + view.groups.dps.length).toBe(3);

    await rosterService.saveDraftSelection(thorne, {
      runId: run.id,
      version: view.roster.version,
      selections: [{ signupId: signup.id, selectedRole: "HEALER" }],
    });
    view = await rosterService.getRosterManagementView(thorne, run.id);
    expect(view.composition.tanks.selected).toBe(0);
    expect(view.composition.healers.selected).toBe(1);
    expect(view.composition.dps.selected).toBe(0);
    expect(view.composition.boosterTotal).toBe(1);

    const draft = await rosterRepository.findByRunId(run.id);
    expect(draft?.selections.filter((s) => s.signupId === signup.id)).toHaveLength(1);
    expect(draft?.selections.find((s) => s.signupId === signup.id)?.selectedRole).toBe("HEALER");
  });

  it("keeps unique Booster count below projected role-card total for multi-role offers", async () => {
    const thorne = asUser(ids.thorne, "Thorne Ironvein", "RAID_LEAD");
    const kael = asUser(ids.kael, "Kael Stormeye");
    const now = new Date().toISOString();

    const defs: Array<{ name: string; wowClass: "MAGE" | "PRIEST" | "SHAMAN"; roles: Array<"TANK" | "HEALER" | "RANGED_DPS" | "RANGED_DPS">; primary: "RANGED_DPS" | "RANGED_DPS" | "HEALER" }> = [
      { name: "CountA", wowClass: "MAGE", roles: ["RANGED_DPS"], primary: "RANGED_DPS" },
      { name: "CountB", wowClass: "PRIEST", roles: ["HEALER"], primary: "HEALER" },
      { name: "CountC", wowClass: "SHAMAN", roles: ["HEALER", "RANGED_DPS"], primary: "HEALER" },
    ];
    const characterIds: string[] = [];
    for (const def of defs) {
      const characterId = crypto.randomUUID();
      characterIds.push(characterId);
      createdCharacterIds.push(characterId);
      await orm.Character.create({
        id: characterId,
        userId: ids.kael,
        name: def.name,
        realm: "Antonidas",
        normalizedName: def.name.toLowerCase(),
        normalizedRealm: "antonidas",
        region: "EU",
        wowClass: def.wowClass,
        specialization:
          def.wowClass === "MAGE" ? "Frost" : def.wowClass === "PRIEST" ? "Holy" : "Restoration",
        primaryRole: def.primary,
        itemLevel: 700,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      if (def.wowClass === "SHAMAN" && def.roles.includes("RANGED_DPS")) {
        await orm.CharacterPlayableSpec.create({
          id: crypto.randomUUID(),
          characterId,
          specialization: "Elemental",
          createdAt: now,
        });
      }
    }

    const run = await runService.createRun(thorne, venomousCreateInput({ difficulty: "HEROIC", lootType: "UNSAVED", venomousPlannedBossCount: 8, scheduledStartAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), desiredTankCount: 0, desiredHealerCount: 2, desiredDpsCount: 2 }));
    createdRunIds.push(run.id);
    await runService.openRun(thorne, run.id);
    await withdrawRaidLeadBootstrap(run.id);

    await signupService.setCharacterOffers(kael, {
      runId: run.id,
      offers: defs.map((def, i) => ({ characterId: characterIds[i]!, offeredRoles: def.roles })),
    });

    const view = await rosterService.getRosterManagementView(thorne, run.id);
    expect(view.boosters).toHaveLength(3);
    expect(view.groups.healers).toHaveLength(2);
    expect(view.groups.rangedDps).toHaveLength(2);
    expect(view.groups.meleeDps).toHaveLength(0);
    expect(view.groups.legacyDps).toHaveLength(0);
    expect(view.groups.dps).toHaveLength(2);
    expect(view.groups.tanks).toHaveLength(0);
    expect(view.groups.healers.length + view.groups.dps.length).toBe(4);
  });

  it("rejects generic DPS assignment and buckets concrete external boosters", async () => {
    const thorne = asUser(ids.thorne, "Thorne Ironvein", "RAID_LEAD");
    const kael = asUser(ids.kael, "Kael Stormeye");
    const now = new Date().toISOString();
    const mageId = crypto.randomUUID();
    createdCharacterIds.push(mageId);
    await orm.Character.create({
      id: mageId,
      userId: ids.kael,
      name: "Testmage",
      realm: "Antonidas",
      normalizedName: "testmage",
      normalizedRealm: "antonidas",
      region: "EU",
      wowClass: "MAGE",
      specialization: "Fire",
      primaryRole: "RANGED_DPS",
      itemLevel: 700,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const run = await runService.createRun(
      thorne,
      venomousCreateInput({
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        venomousPlannedBossCount: 8,
        scheduledStartAt: new Date(Date.now() + 16 * 24 * 60 * 60 * 1000).toISOString(),
        desiredTankCount: 0,
        desiredHealerCount: 0,
        desiredDpsCount: 2,
      }),
    );
    createdRunIds.push(run.id);
    await runService.openRun(thorne, run.id);

    await signupService.setCharacterOffers(kael, {
      runId: run.id,
      offers: [{ characterId: mageId, offeredRoles: ["RANGED_DPS"] }],
    });
    const signup = (await signupRepository.listByRunAndUser(run.id, ids.kael)).find(
      (row) => row.status === "PENDING",
    )!;
    let view = await rosterService.getRosterManagementView(thorne, run.id);

    await expect(
      rosterService.saveDraftSelection(thorne, {
        runId: run.id,
        version: view.roster.version,
        selections: [{ signupId: signup.id, selectedRole: "DPS" }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_ROSTER_SELECTION" });

    await rosterService.saveDraftSelection(thorne, {
      runId: run.id,
      version: view.roster.version,
      selections: [{ signupId: signup.id, selectedRole: "RANGED_DPS" }],
    });
    view = await rosterService.getRosterManagementView(thorne, run.id);
    await rosterService.saveExternalBoosters(thorne, {
      runId: run.id,
      version: view.roster.version,
      externalBoosters: [
        { name: "dawn", wowClass: "MAGE", participationType: "BOOSTER", role: "RANGED_DPS" },
        { name: "shadow", wowClass: "ROGUE", participationType: "BOOSTER", role: "MELEE_DPS" },
      ],
    });
    view = await rosterService.getRosterManagementView(thorne, run.id);
    expect(
      view.roster.externalBoosters
        .map((b) => [b.name, b.role] as const)
        .sort((a, b) => a[0].localeCompare(b[0])),
    ).toEqual([
      ["dawn", "RANGED_DPS"],
      ["shadow", "MELEE_DPS"],
    ]);
    expect(view.summary.rangedDps).toBe(2);
    expect(view.summary.meleeDps).toBe(1);
    expect(view.summary.legacyDps).toBe(0);
    expect(view.summary.dps).toBe(3);
  });
});
