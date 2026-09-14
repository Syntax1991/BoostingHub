import { afterAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import { activityRepository } from "@/repositories/activity.repository";
import { rosterRepository } from "@/repositories/roster.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { lockoutService } from "@/services/lockout.service";
import { rosterService } from "@/services/roster.service";
import { runDetailService } from "@/services/run-detail.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";

const ids = {
  kael: "11111111-1111-4111-8111-111111111111",
  thorne: "33333333-3333-4333-8333-333333333333",
  aelira: "44444444-4444-4444-8444-444444444444",
  lab: "r8888888-8888-4888-8888-888888888888",
  weekend: "r7777777-7777-4777-8777-777777777777",
  normal: "r4444444-4444-4444-8444-444444444444",
  published: "r5555555-5555-4555-8555-555555555555",
  draft: "r6666666-6666-4666-8666-666666666666",
  sunday: "r3333333-3333-4333-8333-333333333333",
  labKaelResto: "s8888888-8888-4888-8888-888888888881",
  labKaelEle: "s8888888-8888-4888-8888-888888888882",
  labBrannTank: "s8888888-8888-4888-8888-888888888883",
  labBrannHoly: "s8888888-8888-4888-8888-888888888884",
  labMira: "s8888888-8888-4888-8888-888888888885",
  labSylva: "s8888888-8888-4888-8888-888888888886",
  labThorne: "s8888888-8888-4888-8888-888888888887",
  labAelira: "s8888888-8888-4888-8888-888888888888",
  publishedKael: "s5555555-5555-4555-8555-555555555551",
  kaelResto: "c1111111-1111-4111-8111-111111111111",
  raid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

const lockoutIds: string[] = [];

/** Unique BOOSTER signups across role projections (dedupe by signup id). */
function rosterBoosters<T extends { id: string }>(view: { boosters: T[] }): T[] {
  return view.boosters;
}

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@dev.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function expectDomainCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected domain error ${code}`);
  } catch (error) {
    expect(isDomainError(error) && error.code).toBe(code);
  }
}

const kael = asUser(ids.kael, "Kael Stormhowl");
const thorne = asUser(ids.thorne, "Thorne Ironvein", "RAID_LEAD");
const aelira = asUser(ids.aelira, "Aelira Nightwatch", "ADMIN");
const otherLead = asUser(ids.kael, "Kael Stormhowl", "RAID_LEAD");

afterAll(async () => {
  for (const id of lockoutIds) {
    await orm.CharacterRaidLockout.where({ id }).delete();
  }
});

describe("rosterService authorization", () => {
  it("rejects USER roster reads and mutations", async () => {
    await expectDomainCode(rosterService.getRosterManagementView(kael, ids.lab), "RUN_NOT_MANAGEABLE");
    await expectDomainCode(
      rosterService.setDraftSelection(kael, {
        runId: ids.lab,
        signupId: ids.labKaelResto,
        selected: true,
        version: 1,
      }),
      "RUN_NOT_MANAGEABLE",
    );
    await expectDomainCode(
      rosterService.publishRoster(kael, { runId: ids.lab, version: 1, acknowledgeWarnings: true }),
      "RUN_NOT_MANAGEABLE",
    );
  });

  it("lets a raid lead manage an assigned run and rejects another lead's run", async () => {
    const own = await rosterService.getRosterManagementView(thorne, ids.weekend);
    expect(own.run.id).toBe(ids.weekend);
    await expectDomainCode(rosterService.getRosterManagementView(thorne, ids.normal), "RUN_NOT_MANAGEABLE");
    await expectDomainCode(rosterService.getRosterManagementView(otherLead, ids.weekend), "RUN_NOT_MANAGEABLE");
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
    await rosterService.setDraftSelection(thorne, {
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
    await rosterService.setDraftSelection(thorne, {
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
    await expectDomainCode(
      rosterService.setDraftSelection(thorne, {
        runId: ids.lab,
        signupId: ids.labBrannHoly,
        selected: true,
        version: view.roster.version,
      }),
      "SIGNUP_WITHDRAWN",
    );
    await expectDomainCode(
      rosterService.setDraftSelection(thorne, {
        runId: ids.lab,
        signupId: "s0000000-0000-4000-8000-000000000000",
        selected: true,
        version: view.roster.version,
      }),
      "NOT_FOUND",
    );
    await expectDomainCode(
      rosterService.setDraftSelection(thorne, {
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
    await rosterService.setDraftSelection(thorne, {
      runId: ids.lab,
      signupId: ids.labKaelResto,
      selected: true,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(thorne, ids.lab);
    await rosterService.setDraftSelection(thorne, {
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
    await rosterService.setDraftSelection(thorne, {
      runId: ids.lab,
      signupId: ids.labThorne,
      selected: true,
      version: view.roster.version,
    });
    await expectDomainCode(
      rosterService.setDraftSelection(thorne, {
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
    await expectDomainCode(
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
    await expectDomainCode(
      rosterService.saveDraftSelection(thorne, {
        runId: ids.lab,
        version: view.roster.version,
        selections: [{ signupId: ids.labBrannHoly, selectedRole: null }],
      }),
      "SIGNUP_WITHDRAWN",
    );
    await expectDomainCode(
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
    await expectDomainCode(
      rosterService.saveDraftSelection(thorne, {
        runId: ids.lab,
        version: view.roster.version,
        selections: [{ signupId: ids.labBrannTank, selectedRole: null }],
      }),
      "ROSTER_ALREADY_CHANGED",
    );
  });

  it("transitions OPEN to ROSTERING only when the saved selection is non-empty", async () => {
    const run = await runService.createRun(thorne, {
      raidId: VENOMOUS_ABYSS_RAID_ID,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt: "2030-06-15T18:00:00.000Z",
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    await runService.openRun(thorne, run.id);
    const signup = await signupService.createBoosterSignup(kael, {
      runId: run.id,
      characterId: ids.kaelResto,
      role: "HEALER",
      isBackup: false,
    });

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
      selections: [{ signupId: signup.id, selectedRole: null }],
    });
    expect((await rosterService.getRosterManagementView(thorne, run.id)).run.status).toBe("ROSTERING");
  });
});

describe("rosterService publish validation", () => {
  it("blocks publishing a selected booster whose access is not approved", async () => {
    let view = await rosterService.getRosterManagementView(thorne, ids.lab);
    await rosterService.setDraftSelection(thorne, {
      runId: ids.lab,
      signupId: ids.labSylva,
      selected: true,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(thorne, ids.lab);
    expect(view.validation.canPublish).toBe(false);
    expect(view.validation.blockers.some((item) => item.code === "BOOSTER_ACCESS_INVALID")).toBe(true);
    await expectDomainCode(
      rosterService.publishRoster(thorne, {
        runId: ids.lab,
        version: view.roster.version,
        acknowledgeWarnings: true,
      }),
      "ROSTER_VALIDATION_FAILED",
    );
    await rosterService.setDraftSelection(thorne, {
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
      await rosterService.setDraftSelection(thorne, {
        runId: ids.lab,
        signupId: ids.labKaelResto,
        selected: true,
        version: view.roster.version,
      });
      view = await rosterService.getRosterManagementView(thorne, ids.lab);
    }
    const candidate = rosterBoosters(view).find((item) => item.id === ids.labKaelResto);
    expect(candidate?.raidSave).toEqual({
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
    await rosterService.setDraftSelection(thorne, {
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
    expect(view.composition.lootbuddies).toBe(1);
  });

  it("rejects publishing a draft-status run", async () => {
    const view = await rosterService.getRosterManagementView(thorne, ids.draft);
    expect(view.validation.canPublish).toBe(false);
    await expectDomainCode(
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
        await rosterService.setDraftSelection(thorne, {
          runId: ids.lab,
          signupId,
          selected: true,
          version: current.roster.version,
        });
      }
    }
    const kaelEle = await rosterService.getRosterManagementView(thorne, ids.lab);
    if (rosterBoosters(kaelEle).find((item) => item.id === ids.labKaelEle)?.draftSelected) {
      await rosterService.setDraftSelection(thorne, {
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
    const events = await activityRepository.listRecent(20);
    expect(events.some((event) => event.type === "ROSTER_PUBLISHED" && event.message === "Published a roster.")).toBe(true);
  });

  it("republishes replacements without leaving a partial roster", async () => {
    let view = await rosterService.getRosterManagementView(thorne, ids.lab);
    await rosterService.setDraftSelection(thorne, {
      runId: ids.lab,
      signupId: ids.labKaelEle,
      selected: true,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(thorne, ids.lab);
    await rosterService.setDraftSelection(thorne, {
      runId: ids.lab,
      signupId: ids.labAelira,
      selected: true,
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
    const events = await activityRepository.listRecent(20);
    expect(events.some((event) => event.type === "ROSTER_UPDATED" && event.message === "Updated a published roster.")).toBe(true);
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

  it("still forbids self-withdraw of a selected signup on a published run", async () => {
    await expectDomainCode(signupService.withdrawSignup(kael, ids.publishedKael), "INVALID_STATE_TRANSITION");
  });
});

describe("rosterService publishedRole snapshot", () => {
  const createdCharacterIds: string[] = [];
  const createdRunIds: string[] = [];

  afterAll(async () => {
    for (const runId of createdRunIds) {
      const attendance = await orm.RunAttendance.where({ runId }).select("id").all();
      for (const row of attendance) {
        await orm.RunAttendance.where({ id: (row as { id: string }).id }).delete();
      }
      const start = await orm.RunStartSnapshot.where({ runId }).first();
      if (start) await orm.RunStartSnapshot.where({ id: (start as { id: string }).id }).delete();
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
          await orm.RunSignupRole.where({ id: (role as { id: string }).id }).delete();
        }
        await orm.RunSignup.where({ id: signupId }).delete();
      }
      await orm.Run.where({ id: runId }).delete();
    }
    for (const id of createdCharacterIds) {
      await orm.Character.where({ id }).delete();
    }
  });

  it("freezes publishedRole across a replacement draft role change until republish", async () => {
    const shamanId = crypto.randomUUID();
    createdCharacterIds.push(shamanId);
    const now = new Date().toISOString();
    await orm.Character.create({
      id: shamanId,
      userId: ids.kael,
      name: "Synblast",
      realm: "Antonidas",
      normalizedName: "synblast",
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

    const run = await runService.createRun(thorne, {
      raidId: VENOMOUS_ABYSS_RAID_ID,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      desiredTankCount: 0,
      desiredHealerCount: 1,
      desiredDpsCount: 0,
    });
    createdRunIds.push(run.id);
    await runService.openRun(thorne, run.id);

    await signupService.setCharacterOffers(kael, {
      runId: run.id,
      offers: [{ characterId: shamanId, offeredRoles: ["HEALER", "DPS"] }],
    });
    const signup = (await signupRepository.listByRunAndUser(run.id, ids.kael)).find(
      (row) => row.status === "PENDING",
    )!;

    let view = await rosterService.getRosterManagementView(thorne, run.id);
    // Multi-role offer projects into every offered role section (visual duplication).
    expect(view.groups.healers.filter((item) => item.id === signup.id)).toHaveLength(1);
    expect(view.groups.dps.filter((item) => item.id === signup.id)).toHaveLength(1);
    expect(view.groups.tanks.filter((item) => item.id === signup.id)).toHaveLength(0);
    expect(view.groups.healers.find((item) => item.id === signup.id)?.groupRole).toBe("HEALER");
    expect(view.groups.dps.find((item) => item.id === signup.id)?.groupRole).toBe("DPS");
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
    expect(detailBefore.finalSetupPreview?.groups.healers.some((m) => m.characterName === "Synblast")).toBe(true);
    expect(detailBefore.finalSetupPreview?.groups.dps.some((m) => m.characterName === "Synblast")).toBe(false);

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
      selections: [{ signupId: signup.id, selectedRole: "DPS" }],
    });

    const draft = await rosterRepository.findByRunId(run.id);
    expect(draft?.selections.find((s) => s.signupId === signup.id)?.selectedRole).toBe("DPS");
    live = await signupRepository.findById(signup.id);
    expect(live?.publishedRole).toBe("HEALER");
    expect((await rosterService.getPublishedRosterView(run.id))?.members.find((m) => m.signupId === signup.id)?.selectedRole).toBe(
      "HEALER",
    );

    const detailDraft = await runDetailService.getRunDetail(thorne, run.id);
    expect(detailDraft.finalSetupPreview?.groups.healers.some((m) => m.characterName === "Synblast")).toBe(true);
    expect(detailDraft.finalSetupPreview?.groups.dps.some((m) => m.characterName === "Synblast")).toBe(false);

    view = await rosterService.getRosterManagementView(thorne, run.id);
    await rosterService.publishRoster(thorne, {
      runId: run.id,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });
    live = await signupRepository.findById(signup.id);
    expect(live?.publishedRole).toBe("DPS");
    expect((await rosterService.getPublishedRosterView(run.id))?.members.find((m) => m.signupId === signup.id)?.selectedRole).toBe(
      "DPS",
    );

    const detailAfter = await runDetailService.getRunDetail(thorne, run.id);
    expect(detailAfter.finalSetupPreview?.groups.dps.some((m) => m.characterName === "Synblast")).toBe(true);
    expect(detailAfter.finalSetupPreview?.groups.healers.some((m) => m.characterName === "Synblast")).toBe(false);
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
      name: "Synpal",
      realm: "Antonidas",
      normalizedName: "synpal",
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

    const run = await runService.createRun(thorne, {
      raidId: VENOMOUS_ABYSS_RAID_ID,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString(),
      desiredTankCount: 1,
      desiredHealerCount: 1,
      desiredDpsCount: 1,
    });
    createdRunIds.push(run.id);
    await runService.openRun(thorne, run.id);

    await signupService.setCharacterOffers(kael, {
      runId: run.id,
      offers: [{ characterId: paladinId, offeredRoles: ["TANK", "HEALER", "DPS"] }],
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

    const defs: Array<{ name: string; wowClass: "MAGE" | "PRIEST" | "SHAMAN"; roles: Array<"TANK" | "HEALER" | "DPS">; primary: "DPS" | "HEALER" }> = [
      { name: "CountA", wowClass: "MAGE", roles: ["DPS"], primary: "DPS" },
      { name: "CountB", wowClass: "PRIEST", roles: ["HEALER"], primary: "HEALER" },
      { name: "CountC", wowClass: "SHAMAN", roles: ["HEALER", "DPS"], primary: "HEALER" },
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
        specialization: def.primary === "HEALER" ? "Restoration" : "Frost",
        primaryRole: def.primary,
        itemLevel: 700,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    const run = await runService.createRun(thorne, {
      raidId: VENOMOUS_ABYSS_RAID_ID,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      desiredTankCount: 0,
      desiredHealerCount: 2,
      desiredDpsCount: 2,
    });
    createdRunIds.push(run.id);
    await runService.openRun(thorne, run.id);

    await signupService.setCharacterOffers(kael, {
      runId: run.id,
      offers: defs.map((def, i) => ({ characterId: characterIds[i]!, offeredRoles: def.roles })),
    });

    const view = await rosterService.getRosterManagementView(thorne, run.id);
    expect(view.boosters).toHaveLength(3);
    expect(view.groups.healers).toHaveLength(2);
    expect(view.groups.dps).toHaveLength(2);
    expect(view.groups.tanks).toHaveLength(0);
    expect(view.groups.healers.length + view.groups.dps.length).toBe(4);
  });
});
