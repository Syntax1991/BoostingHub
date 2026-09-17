import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { CROSS_RUN_RESERVATION_MIN_GAP_MS } from "@/repositories/signup.repository";
import { boosterQualificationService } from "@/services/booster-qualification.service";
import { characterScheduleCommitmentsService } from "@/services/character-schedule-commitments.service";
import { characterService } from "@/services/character.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";
import { CharacterScheduleCommitmentsSection } from "@/components/characters/character-schedule-commitments-section";

const ids = {
  owner: "cccccccc-cccc-4ccc-8ccc-csc000000001",
  other: "cccccccc-cccc-4ccc-8ccc-csc000000002",
  lead: "cccccccc-cccc-4ccc-8ccc-csc000000003",
  admin: "cccccccc-cccc-4ccc-8ccc-csc000000004",
};

const createdCharacterIds: string[] = [];
const createdRunIds: string[] = [];

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@csc.boostting.local`,
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

async function ensureUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]) {
  await orm.User.create({
    id,
    name,
    email: `${id}@csc.boostting.local`,
    emailVerified: false,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).catch(() => {});
}

async function createOpenRun(lead: AuthenticatedUser, scheduledStartAt: string) {
  const run = await runService.createRun(
    lead,
    venomousCreateInput({
      scheduledStartAt,
      desiredTankCount: 0,
      desiredHealerCount: 1,
      desiredDpsCount: 0,
    }),
  );
  createdRunIds.push(run.id);
  await runService.openRun(lead, run.id);
  return run;
}

async function cleanupRun(runId: string) {
  const roster = await orm.RunRoster.where({ runId }).first();
  if (roster) {
    const rosterId = (roster as { id: string }).id;
    await orm.RunRosterEntry.where({ rosterId }).delete().catch(() => {});
    await orm.RunRoster.where({ id: rosterId }).delete().catch(() => {});
  }
  const signups = (await orm.RunSignup.where({ runId }).all()) as Array<{ id: string }>;
  for (const signup of signups) {
    await orm.RunSignupRole.where({ signupId: signup.id }).delete().catch(() => {});
  }
  await orm.RunSignup.where({ runId }).delete().catch(() => {});
  await orm.RunRaidContent.where({ runId }).delete().catch(() => {});
  await orm.Run.where({ id: runId }).delete().catch(() => {});
}

beforeAll(async () => {
  await ensureUser(ids.owner, "CSC Owner", "USER");
  await ensureUser(ids.other, "CSC Other", "USER");
  await ensureUser(ids.lead, "CSC Lead", "RAID_LEAD");
  await ensureUser(ids.admin, "CSC Admin", "ADMIN");
});

afterAll(async () => {
  for (const runId of createdRunIds) {
    await cleanupRun(runId);
  }
  for (const id of createdCharacterIds) {
    await orm.Character.where({ id }).delete().catch(() => {});
  }
  await orm.BoosterQualification.where({ userId: ids.owner }).delete().catch(() => {});
});

describe("characterScheduleCommitmentsService", () => {
  const owner = asUser(ids.owner, "CSC Owner");
  const other = asUser(ids.other, "CSC Other");
  const lead = asUser(ids.lead, "CSC Lead", "RAID_LEAD");
  const admin = asUser(ids.admin, "CSC Admin", "ADMIN");

  it("lists SELECTED reservations, omits PENDING-only, rejects foreign owners", async () => {
    await boosterQualificationService.grant(admin, {
      userId: ids.owner,
      difficulty: "HEROIC",
    });

    const character = await characterService.createCharacter(owner, {
      name: "Commitstorm",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 700,
    });
    createdCharacterIds.push(character.id);

    const empty = await characterScheduleCommitmentsService.listForOwner(owner, character.id);
    expect(empty).toEqual([]);

    const t0 = Date.now() + 3 * 24 * 60 * 60 * 1000;
    const runPending = await createOpenRun(lead, new Date(t0).toISOString());
    const runSelected = await createOpenRun(
      lead,
      new Date(t0 + CROSS_RUN_RESERVATION_MIN_GAP_MS + 60_000).toISOString(),
    );

    await signupService.createBoosterSignup(owner, {
      runId: runPending.id,
      characterId: character.id,
      role: "HEALER",
      isBackup: false,
    });
    const selectedSignup = await signupService.createBoosterSignup(owner, {
      runId: runSelected.id,
      characterId: character.id,
      role: "HEALER",
      isBackup: false,
    });

    await rosterService.saveDraftSelection(lead, {
      runId: runSelected.id,
      version: (await rosterService.getRosterManagementView(lead, runSelected.id)).roster.version,
      selections: [{ signupId: selectedSignup.id, selectedRole: "HEALER" }],
    });
    await rosterService.publishRoster(lead, {
      runId: runSelected.id,
      version: (await rosterService.getRosterManagementView(lead, runSelected.id)).roster.version,
      acknowledgeWarnings: true,
    });

    const commitments = await characterScheduleCommitmentsService.listForOwner(owner, character.id);
    expect(commitments).toHaveLength(1);
    expect(commitments[0]?.runId).toBe(runSelected.id);
    expect(commitments[0]?.signupStatus).toBe("SELECTED");
    expect(commitments[0]?.role).toBe("HEALER");

    const details = await characterService.getCharacterDetails(owner, character.id);
    expect(details.scheduleCommitments).toHaveLength(1);
    expect(details.scheduleCommitments[0]?.runId).toBe(runSelected.id);

    await expectDomainCode(
      characterScheduleCommitmentsService.listForOwner(other, character.id),
      "CHARACTER_NOT_OWNED",
    );
  });

  it("includes draft-selected reservations and ignores deprecated manual blocks", async () => {
    await boosterQualificationService.grant(admin, {
      userId: ids.owner,
      difficulty: "HEROIC",
    }).catch(() => {});

    const character = await characterService.createCharacter(owner, {
      name: "Draftstorm",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 700,
    });
    createdCharacterIds.push(character.id);

    const start = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const run = await createOpenRun(lead, start.toISOString());
    const signup = await signupService.createBoosterSignup(owner, {
      runId: run.id,
      characterId: character.id,
      role: "HEALER",
      isBackup: false,
    });

    await rosterService.saveDraftSelection(lead, {
      runId: run.id,
      version: (await rosterService.getRosterManagementView(lead, run.id)).roster.version,
      selections: [{ signupId: signup.id, selectedRole: "HEALER" }],
    });

    const beforeBlock = await characterScheduleCommitmentsService.listForOwner(owner, character.id);
    expect(beforeBlock).toHaveLength(1);
    expect(beforeBlock[0]?.draftSelected).toBe(true);
    expect(beforeBlock[0]?.signupStatus).toBe("PENDING");
    expect(beforeBlock[0]?.scheduleConflicts).toEqual([]);

    const { characterAvailabilityRepository } = await import(
      "@/repositories/character-availability.repository"
    );
    const block = await characterAvailabilityRepository.create({
      characterId: character.id,
      startsAt: new Date(start.getTime() - 60 * 60 * 1000).toISOString(),
      endsAt: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
      reason: "External boost",
    });

    const afterBlock = await characterScheduleCommitmentsService.listForOwner(owner, character.id);
    expect(afterBlock).toHaveLength(1);
    expect(afterBlock[0]?.scheduleConflicts).toEqual([]);

    await orm.CharacterAvailabilityBlock.where({ id: block.id }).delete().catch(() => {});
  });
});

describe("CharacterScheduleCommitmentsSection", () => {
  it("renders empty state and conflict messages", () => {
    const empty = renderToStaticMarkup(
      createElement(CharacterScheduleCommitmentsSection, { commitments: [] }),
    );
    expect(empty).toContain("No upcoming BoostingHub reservations");

    const withConflict = renderToStaticMarkup(
      createElement(CharacterScheduleCommitmentsSection, {
        commitments: [
          {
            signupId: "s1",
            runId: "r1",
            runTitle: "Thu 21:00 HC Unsaved 8/8 Lead",
            productLabel: "The Venomous Abyss",
            contentSummary: "The Venomous Abyss 8/8",
            difficulty: "HEROIC",
            scheduledStartAt: "2026-09-17T19:00:00.000Z",
            runStatus: "ROSTERING",
            signupStatus: "PENDING",
            draftSelected: true,
            role: "HEALER",
            scheduleConflicts: [
              {
                source: "RUN_RESERVATION",
                conflictingRunId: "r2",
                conflictingRunTitle: "Other Run",
                conflictingScheduledStartAt: "2026-09-17T20:00:00.000Z",
                message: "Another BoostingHub Run: Other Run at Wed 17/09/2026 22:00",
              },
            ],
          },
        ],
      }),
    );
    expect(withConflict).toContain("Thu 21:00 HC Unsaved 8/8 Lead");
    expect(withConflict).toContain("Draft selected");
    expect(withConflict).toContain("Another BoostingHub Run");
    expect(withConflict).toContain(`/runs/r1`);
  });
});
