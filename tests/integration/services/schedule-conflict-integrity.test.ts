import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { venomousCreateInput, venomousUpdateInput } from "@tests/fixtures/test-run-input";
import { runRepository } from "@/repositories/run.repository";
import { characterAvailabilityRepository } from "@/repositories/character-availability.repository";
import { characterWeeklyAvailabilityService } from "@/services/character-weekly-availability.service";
import { characterService } from "@/services/character.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";
import { testActor } from "@tests/fixtures/actors";
import { assertIsolatedTestDatabase, createTestUser, deleteCreatedRows } from "@tests/fixtures/db-fixtures";
import { expectDomainError } from "@tests/helpers/domain-error";
import { CURRENT_WEEK_RUN_START, HOUR_MS, RAID_WEEK_TEST_CLOCK, freezeSystemTime, restoreSystemTime } from "@tests/fixtures/time";
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

/** The product rule under test: a Character's Runs must start at least two hours apart. */
const RESERVATION_GAP_MS = 2 * HOUR_MS;

/** Runs (signups, rosters) cascade; Characters and their availability blocks go with the owner. */
const created = { runIds: [] as string[], userIds: [] as string[] };
let owner: AuthenticatedUser;
let lead: AuthenticatedUser;

const at = (hoursAfterBase: number) => new Date(Date.parse(CURRENT_WEEK_RUN_START) + hoursAfterBase * HOUR_MS).toISOString();

async function createOpenRun(scheduledStartAt: string, targets: { healers?: number; dps?: number }) {
  const run = await runService.createRun(
    lead,
    venomousCreateInput({
      scheduledStartAt,
      desiredTankCount: 0,
      desiredHealerCount: targets.healers ?? 0,
      desiredDpsCount: targets.dps ?? 0,
    }),
  );
  created.runIds.push(run.id);
  await runService.openRun(lead, run.id);
  return run;
}

/** Draft-selects the owner's signup of `characterId` on `runId` in `role`; returns the refreshed view. */
async function draftSelect(runId: string, characterId: string, role: "HEALER" | "RANGED_DPS") {
  const view = await rosterService.getRosterManagementView(lead, runId);
  const signup = view.boosters.find((row) => row.character?.id === characterId)!;
  await rosterService.saveDraftSelection(lead, {
    runId,
    version: view.roster.version,
    selections: [{ signupId: signup.id, selectedRole: role }],
  });
  return rosterService.getRosterManagementView(lead, runId);
}

const ownerRow = (view: Awaited<ReturnType<typeof rosterService.getRosterManagementView>>, characterId: string) =>
  view.boosters.find((row) => row.character?.id === characterId)!;

beforeAll(async () => {
  assertIsolatedTestDatabase();
  freezeSystemTime(RAID_WEEK_TEST_CLOCK, { advance: true });
  const ownerId = await createTestUser({ name: "SCI Owner", isBooster: true });
  const leadId = await createTestUser({ name: "SCI Lead", accountRole: "RAID_LEAD" });
  created.userIds.push(ownerId, leadId);
  owner = testActor(ownerId);
  lead = testActor(leadId, "RAID_LEAD");
});

afterAll(async () => {
  try {
    await deleteCreatedRows(created);
  } finally {
    restoreSystemTime();
  }
});

describe("schedule conflict integrity", () => {
  it("ignores deprecated CharacterAvailabilityBlock rows for roster, My Runs, and weekly availability", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Scisyn",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 640,
    });
    const start = at(0);
    const run = await createOpenRun(start, { healers: 1 });
    await offerCharacter(owner, run.id, character.id, "HEALER");
    await draftSelect(run.id, character.id, "HEALER");

    // A legacy block covering the whole Run.
    await characterAvailabilityRepository.create({
      characterId: character.id,
      startsAt: at(-1),
      endsAt: at(2),
      reason: "External boost",
    });

    const view = await rosterService.getRosterManagementView(lead, run.id);
    expect(ownerRow(view, character.id).draftSelected).toBe(true);
    expect(ownerRow(view, character.id).scheduleConflicts).toEqual([]);

    const myRuns = await signupService.getMyRuns(owner);
    const mine = [...myRuns.pending, ...myRuns.selected].find((row) => row.runId === run.id);
    expect(mine?.scheduleConflicts).toEqual([]);

    const weekly = await characterWeeklyAvailabilityService.getCurrentForOwner(owner, character.id);
    expect(weekly.status).toBe("AVAILABLE");

    // Publishing is not blocked by the legacy row either.
    await rosterService.publishRoster(lead, { runId: run.id, version: view.roster.version, acknowledgeWarnings: true });
  });

  it("surfaces reservation conflicts after a cross-run time edit and clears at exactly 2h", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Scires",
      realm: "Silvermoon",
      region: "EU",
      wowClass: "WARLOCK",
      specialization: "Affliction",
      itemLevel: 625,
    });
    // Run A, then Run B three hours later: far enough apart to start with.
    const runA = await createOpenRun(at(24), { dps: 1 });
    const runB = await createOpenRun(at(27), { dps: 1 });

    await offerCharacter(owner, runA.id, character.id, "RANGED_DPS");
    await draftSelect(runA.id, character.id, "RANGED_DPS");

    await offerCharacter(owner, runB.id, character.id, "RANGED_DPS");
    let viewB = await rosterService.getRosterManagementView(lead, runB.id);
    expect(ownerRow(viewB, character.id).scheduleConflicts).toEqual([]);
    await draftSelect(runB.id, character.id, "RANGED_DPS");

    // Run B moves to 90 minutes after Run A: the picked Character is now double-booked.
    await runService.updateRun(
      lead,
      venomousUpdateInput(runB.id, (await runRepository.findById(runB.id))!, { scheduledStartAt: at(25.5) }),
    );
    viewB = await rosterService.getRosterManagementView(lead, runB.id);
    expect(ownerRow(viewB, character.id).draftSelected).toBe(true);
    expect(ownerRow(viewB, character.id).scheduleConflicts.some((c) => c.source === "RUN_RESERVATION")).toBe(true);
    await expectDomainError(
      rosterService.publishRoster(lead, { runId: runB.id, version: viewB.roster.version, acknowledgeWarnings: true }),
      "ROSTER_HAS_SCHEDULE_CONFLICTS",
    );

    // Exactly the minimum gap is allowed again.
    const exactGap = new Date(Date.parse(at(24)) + RESERVATION_GAP_MS).toISOString();
    await runService.updateRun(
      lead,
      venomousUpdateInput(runB.id, (await runRepository.findById(runB.id))!, { scheduledStartAt: exactGap }),
    );
    viewB = await rosterService.getRosterManagementView(lead, runB.id);
    expect(ownerRow(viewB, character.id).scheduleConflicts.filter((c) => c.source === "RUN_RESERVATION")).toEqual([]);
  });
});
