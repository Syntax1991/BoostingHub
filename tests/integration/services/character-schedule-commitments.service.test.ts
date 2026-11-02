import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AuthenticatedUser } from "@/auth/authorization";
import { venomousCreateInput } from "@tests/fixtures/test-run-input";
import { characterScheduleCommitmentsService } from "@/services/character-schedule-commitments.service";
import { characterService } from "@/services/character.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { CharacterScheduleCommitmentsSection } from "@/components/characters/character-schedule-commitments-section";
import { testActor } from "@tests/fixtures/actors";
import { assertIsolatedTestDatabase, createTestUser, deleteCreatedRows } from "@tests/fixtures/db-fixtures";
import { expectDomainError } from "@tests/helpers/domain-error";
import { CURRENT_WEEK_RUN_START, DAY_MS, HOUR_MS, RAID_WEEK_TEST_CLOCK, freezeSystemTime, restoreSystemTime } from "@tests/fixtures/time";
import { offerCharacter } from "@tests/helpers/signup-offers";

// Warcraft Logs auto-link enrichment runs after Character writes/syncs; keep it
// offline (a real WARCRAFT_LOGS_* in .env would otherwise hit the live API).
vi.mock("@/integrations/warcraft-logs/warcraft-logs-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/warcraft-logs/warcraft-logs-api-client")>()),
  warcraftLogsApiClient: {
    isConfigured: () => true,
    findCharacter: async () => ({ status: "NOT_FOUND" as const }),
  },
}));

/** Runs cascade; Characters and their availability blocks go with the owner. */
const created = { runIds: [] as string[], userIds: [] as string[] };
let owner: AuthenticatedUser;
let other: AuthenticatedUser;
let lead: AuthenticatedUser;

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
  created.runIds.push(run.id);
  await runService.openRun(lead, run.id);
  return run;
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  freezeSystemTime(RAID_WEEK_TEST_CLOCK, { advance: true });
  const ownerId = await createTestUser({ name: "CSC Owner", isBooster: true });
  const otherId = await createTestUser({ name: "CSC Other" });
  const leadId = await createTestUser({ name: "CSC Lead", accountRole: "RAID_LEAD" });
  created.userIds.push(ownerId, otherId, leadId);
  owner = testActor(ownerId);
  other = testActor(otherId);
  lead = testActor(leadId, "RAID_LEAD");
});

afterAll(async () => {
  try {
    await deleteCreatedRows(created);
  } finally {
    restoreSystemTime();
  }
});

describe("characterScheduleCommitmentsService", () => {
  it("lists SELECTED reservations, omits PENDING-only, rejects foreign owners", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Commitstorm",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 700,
    });

    const empty = await characterScheduleCommitmentsService.listForOwner(owner, character.id);
    expect(empty).toEqual([]);

    // Three hours apart: both signups can coexist (the minimum gap is two hours).
    const t0 = Date.parse(CURRENT_WEEK_RUN_START);
    const runPending = await createOpenRun(lead, new Date(t0).toISOString());
    const runSelected = await createOpenRun(lead, new Date(t0 + 3 * HOUR_MS).toISOString());

    await offerCharacter(owner, runPending.id, character.id, "HEALER");
    const selectedSignupId = await offerCharacter(owner, runSelected.id, character.id, "HEALER");

    await rosterService.saveDraftSelection(lead, {
      runId: runSelected.id,
      version: (await rosterService.getRosterManagementView(lead, runSelected.id)).roster.version,
      selections: [{ signupId: selectedSignupId, selectedRole: "HEALER" }],
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

    await expectDomainError(characterScheduleCommitmentsService.listForOwner(other, character.id), "CHARACTER_NOT_OWNED");
  });

  it("includes draft-selected reservations and ignores deprecated manual blocks", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Draftstorm",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 700,
    });

    const start = new Date(Date.parse(CURRENT_WEEK_RUN_START) + DAY_MS);
    const run = await createOpenRun(lead, start.toISOString());
    const signupId = await offerCharacter(owner, run.id, character.id, "HEALER");

    await rosterService.saveDraftSelection(lead, {
      runId: run.id,
      version: (await rosterService.getRosterManagementView(lead, run.id)).roster.version,
      selections: [{ signupId, selectedRole: "HEALER" }],
    });

    const beforeBlock = await characterScheduleCommitmentsService.listForOwner(owner, character.id);
    expect(beforeBlock).toHaveLength(1);
    expect(beforeBlock[0]?.draftSelected).toBe(true);
    expect(beforeBlock[0]?.signupStatus).toBe("PENDING");
    expect(beforeBlock[0]?.scheduleConflicts).toEqual([]);

    const { characterAvailabilityRepository } = await import(
      "@/repositories/character-availability.repository"
    );
    await characterAvailabilityRepository.create({
      characterId: character.id,
      startsAt: new Date(start.getTime() - 60 * 60 * 1000).toISOString(),
      endsAt: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
      reason: "External boost",
    });

    const afterBlock = await characterScheduleCommitmentsService.listForOwner(owner, character.id);
    expect(afterBlock).toHaveLength(1);
    expect(afterBlock[0]?.scheduleConflicts).toEqual([]);
  });
});

describe("CharacterScheduleCommitmentsSection", () => {
  it("renders empty state and conflict messages", () => {
    const empty = renderToStaticMarkup(
      createElement(CharacterScheduleCommitmentsSection, { commitments: [] }),
    );
    expect(empty).toContain("No upcoming Manawyrm Hub commitments");

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
                message: "Another Manawyrm Hub Run: Other Run at Wed 17/09/2026 22:00",
              },
            ],
          },
        ],
      }),
    );
    expect(withConflict).toContain("Thu 21:00 HC Unsaved 8/8 Lead");
    expect(withConflict).toContain("Draft roster");
    expect(withConflict).toContain("Schedule conflict");
    expect(withConflict).toContain("Another Manawyrm Hub Run");
    expect(withConflict).toContain(`/runs/r1`);
    expect(withConflict).not.toContain("Draft selected");
    expect(withConflict).not.toContain("Reserved elsewhere");
  });
});
