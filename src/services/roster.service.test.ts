import { afterAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { activityRepository } from "@/repositories/activity.repository";
import { rosterRepository } from "@/repositories/roster.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { lockoutService } from "@/services/lockout.service";
import { rosterService } from "@/services/roster.service";
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
    const allIds = [...view.groups.tanks, ...view.groups.healers, ...view.groups.dps, ...view.groups.lootbuddies].map(
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
    const selected = after.groups.healers.find((item) => item.id === ids.labKaelResto);
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
    expect(after.groups.healers.find((item) => item.id === ids.labKaelResto)?.draftSelected).toBe(false);
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
    expect(after.groups.healers.find((item) => item.id === ids.labKaelResto)?.draftSelected).toBe(false);
    expect(after.groups.dps.find((item) => item.id === ids.labKaelEle)?.draftSelected).toBe(true);
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
    if (!view.groups.healers.find((item) => item.id === ids.labKaelResto)?.draftSelected) {
      await rosterService.setDraftSelection(thorne, {
        runId: ids.lab,
        signupId: ids.labKaelResto,
        selected: true,
        version: view.roster.version,
      });
      view = await rosterService.getRosterManagementView(thorne, ids.lab);
    }
    const candidate = view.groups.healers.find((item) => item.id === ids.labKaelResto);
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
      if (![...current.groups.tanks, ...current.groups.healers, ...current.groups.dps, ...current.groups.lootbuddies]
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
    if (kaelEle.groups.dps.find((item) => item.id === ids.labKaelEle)?.draftSelected) {
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
    expect(after.groups.dps.find((item) => item.id === ids.publishedKael)?.draftSelected).toBe(true);
    expect((await signupRepository.findById(ids.publishedKael))?.status).toBe("SELECTED");
  });

  it("still forbids self-withdraw of a selected signup on a published run", async () => {
    await expectDomainCode(signupService.withdrawSignup(kael, ids.publishedKael), "INVALID_STATE_TRANSITION");
  });
});
