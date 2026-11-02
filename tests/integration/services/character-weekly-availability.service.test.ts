import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import { characterWeeklyAvailabilityRepository } from "@/repositories/character-weekly-availability.repository";
import { characterWeeklyAvailabilityService } from "@/services/character-weekly-availability.service";
import { lockoutService } from "@/services/lockout.service";
import { anyContentRunInput } from "@tests/fixtures/test-run-input";
import { runService } from "@/services/run.service";
import { rosterService } from "@/services/roster.service";
import { testActor } from "@tests/fixtures/actors";
import { assertIsolatedTestDatabase, createTestCharacter, createTestUser, deleteCreatedRows } from "@tests/fixtures/db-fixtures";
import { expectDomainError } from "@tests/helpers/domain-error";
import { DAY_MS } from "@tests/fixtures/time";
import { offerCharacter } from "@tests/helpers/signup-offers";

/** Runs cascade; Characters and their availability rows go with the owners. */
const created = { runIds: [] as string[], userIds: [] as string[] };
const ids = { kael: "", kaelResto: "", kaelEle: "" };
let kael: AuthenticatedUser;
let mira: AuthenticatedUser;
let lead: AuthenticatedUser;

beforeAll(async () => {
  assertIsolatedTestDatabase();
  ids.kael = await createTestUser({ name: "Weekly Owner", isBooster: true });
  const miraId = await createTestUser({ name: "Weekly Other" });
  const leadId = await createTestUser({ name: "Weekly Lead", accountRole: "RAID_LEAD" });
  created.userIds.push(ids.kael, miraId, leadId);
  kael = testActor(ids.kael);
  mira = testActor(miraId);
  lead = testActor(leadId, "RAID_LEAD");
  const shaman = (name: string, specialization: string, primaryRole: "HEALER" | "RANGED_DPS") =>
    createTestCharacter({ userId: ids.kael, name, realm: "Twisting Nether", wowClass: "SHAMAN", specialization, primaryRole });
  ids.kaelResto = await shaman("Weeklyresto", "Restoration", "HEALER");
  ids.kaelEle = await shaman("Weeklyele", "Elemental", "RANGED_DPS");
});

afterAll(() => deleteCreatedRows(created));

/** An OPEN Run of the suite's Raid Lead `days` from now. */
async function openRun(difficulty: "HEROIC" | "MYTHIC", days: number) {
  const scheduledStartAt = new Date(Date.now() + days * DAY_MS).toISOString();
  const run = await runService.createRun(lead, anyContentRunInput({ difficulty, scheduledStartAt }));
  created.runIds.push(run.id);
  await runService.openRun(lead, run.id);
  return { id: run.id, scheduledStartAt };
}

describe("characterWeeklyAvailabilityService", () => {
  it("defaults to Available when no current-reset record exists", async () => {
    const current = getRegionalWeeklyReset("EU").resetIdentifier;
    const projection = await characterWeeklyAvailabilityService.getCurrentForOwner(kael, ids.kaelResto);
    expect(projection.status).toBe("AVAILABLE");
    expect(projection.unavailableDifficulties).toEqual([]);
    expect(projection.resetIdentifier).toBe(current);
  });

  it("sets difficulty-specific unavailability and replaces atomically", async () => {
    const current = getRegionalWeeklyReset("EU").resetIdentifier;
    await characterWeeklyAvailabilityRepository.clearUnavailable(ids.kaelResto, current);

    let projection = await characterWeeklyAvailabilityService.setCurrentResetAvailability(kael, {
      characterId: ids.kaelResto,
      available: false,
      unavailableDifficulties: ["HEROIC"],
    });
    expect(projection.status).toBe("UNAVAILABLE");
    expect(projection.unavailableDifficulties).toEqual(["HEROIC"]);

    projection = await characterWeeklyAvailabilityService.setCurrentResetAvailability(kael, {
      characterId: ids.kaelResto,
      available: false,
      unavailableDifficulties: ["MYTHIC", "NORMAL", "HEROIC", "HEROIC"],
    });
    expect(projection.unavailableDifficulties).toEqual(["NORMAL", "HEROIC", "MYTHIC"]);

    projection = await characterWeeklyAvailabilityService.setCurrentResetAvailability(kael, {
      characterId: ids.kaelResto,
      available: false,
      unavailableDifficulties: ["NORMAL", "HEROIC"],
    });
    expect(projection.unavailableDifficulties).toEqual(["NORMAL", "HEROIC"]);

    const rows = await characterWeeklyAvailabilityRepository.listByCharacterAndReset(
      ids.kaelResto,
      current,
    );
    expect(rows.map((row) => row.difficulty).sort()).toEqual(["HEROIC", "NORMAL"]);
  });

  it("rejects unavailable with zero difficulties and clears on Available", async () => {
    await expectDomainError(
      characterWeeklyAvailabilityService.setCurrentResetAvailability(kael, {
        characterId: ids.kaelResto,
        available: false,
        unavailableDifficulties: [],
      }),
      "VALIDATION_FAILED",
    );

    await characterWeeklyAvailabilityService.setCurrentResetAvailability(kael, {
      characterId: ids.kaelResto,
      available: false,
      unavailableDifficulties: ["MYTHIC"],
    });
    const cleared = await characterWeeklyAvailabilityService.setCurrentResetAvailability(kael, {
      characterId: ids.kaelResto,
      available: true,
    });
    expect(cleared.status).toBe("AVAILABLE");
    expect(cleared.unavailableDifficulties).toEqual([]);
  });

  it("rolls over automatically and keeps Characters scoped", async () => {
    const current = getRegionalWeeklyReset("EU").resetIdentifier;
    await characterWeeklyAvailabilityRepository.clearUnavailable(ids.kaelResto, current);
    await characterWeeklyAvailabilityRepository.replaceUnavailableDifficulties(
      ids.kaelResto,
      "2020-W01",
      ["HEROIC", "MYTHIC"],
    );

    const rolled = await characterWeeklyAvailabilityService.getCurrentForOwner(kael, ids.kaelResto);
    expect(rolled.status).toBe("AVAILABLE");

    await characterWeeklyAvailabilityService.setCurrentResetAvailability(kael, {
      characterId: ids.kaelResto,
      available: false,
      unavailableDifficulties: ["HEROIC"],
    });
    await characterWeeklyAvailabilityService.setCurrentResetAvailability(kael, {
      characterId: ids.kaelEle,
      available: true,
    });

    const batch = await characterWeeklyAvailabilityService.projectCurrentForCharacters([
      { id: ids.kaelResto, region: "EU" },
      { id: ids.kaelEle, region: "EU" },
    ]);
    expect(batch.get(ids.kaelResto)?.unavailableDifficulties).toEqual(["HEROIC"]);
    expect(batch.get(ids.kaelEle)?.status).toBe("AVAILABLE");
  });

  it("rejects foreign Character ownership", async () => {
    await expectDomainError(
      characterWeeklyAvailabilityService.setCurrentResetAvailability(mira, {
        characterId: ids.kaelResto,
        available: false,
        unavailableDifficulties: ["HEROIC"],
      }),
      "CHARACTER_NOT_OWNED",
    );
  });

  it("blocks matching difficulty signup/selection and allows other difficulties", async () => {
    const heroicRun = await openRun("HEROIC", 4);
    const resetForRun = lockoutService.getResetIdentifierForRun("EU", heroicRun.scheduledStartAt);

    await characterWeeklyAvailabilityRepository.replaceUnavailableDifficulties(
      ids.kaelResto,
      resetForRun,
      ["HEROIC"],
    );

    await expectDomainError(
      offerCharacter(kael, heroicRun.id, ids.kaelResto, "HEALER"),
      "CHARACTER_UNAVAILABLE",
    );

    // The owner holds the Booster role, so only weekly availability gates Heroic here.
    const mythicRun = await openRun("MYTHIC", 4.5);

    // Unavailable for Heroic only: the Mythic offer is accepted.
    await offerCharacter(kael, mythicRun.id, ids.kaelResto, "HEALER");

    await characterWeeklyAvailabilityRepository.clearUnavailable(ids.kaelResto, resetForRun);
    const signupId = await offerCharacter(kael, heroicRun.id, ids.kaelResto, "HEALER");

    await characterWeeklyAvailabilityRepository.replaceUnavailableDifficulties(
      ids.kaelResto,
      resetForRun,
      ["HEROIC"],
    );
    const view = await rosterService.getRosterManagementView(lead, heroicRun.id);
    await expectDomainError(
      rosterService.setDraftSelection(lead, {
        runId: heroicRun.id,
        signupId,
        selected: true,
        version: view.roster.version,
      }),
      "CHARACTER_SCHEDULE_CONFLICT",
    );
  });

  it("keeps existing selection when later marked Unavailable and blocks publish until cleared", async () => {
    const run = await openRun("HEROIC", 5);
    const resetForRun = lockoutService.getResetIdentifierForRun("EU", run.scheduledStartAt);
    await characterWeeklyAvailabilityRepository.clearUnavailable(ids.kaelResto, resetForRun);

    const signupId = await offerCharacter(kael, run.id, ids.kaelResto, "HEALER");
    let view = await rosterService.getRosterManagementView(lead, run.id);
    await rosterService.setDraftSelection(lead, {
      runId: run.id,
      signupId,
      selected: true,
      version: view.roster.version,
    });

    await characterWeeklyAvailabilityRepository.replaceUnavailableDifficulties(
      ids.kaelResto,
      resetForRun,
      ["HEROIC"],
    );
    view = await rosterService.getRosterManagementView(lead, run.id);
    const selected = view.boosters.find((item) => item.id === signupId);
    expect(selected?.draftSelected).toBe(true);
    expect(selected?.scheduleConflicts.some((row) => row.source === "WEEKLY_UNAVAILABLE")).toBe(
      true,
    );
    expect(selected?.scheduleConflicts.find((row) => row.source === "WEEKLY_UNAVAILABLE")?.message).toContain(
      "Heroic",
    );

    await expectDomainError(
      rosterService.publishRoster(lead, {
        runId: run.id,
        version: view.roster.version,
        acknowledgeWarnings: true,
      }),
      "ROSTER_HAS_SCHEDULE_CONFLICTS",
    );

    await characterWeeklyAvailabilityRepository.clearUnavailable(ids.kaelResto, resetForRun);
    view = await rosterService.getRosterManagementView(lead, run.id);
    expect(
      view.boosters.find((item) => item.id === signupId)?.scheduleConflicts.some(
        (row) => row.source === "WEEKLY_UNAVAILABLE",
      ),
    ).toBe(false);
  });

  it("ignores deprecated CharacterAvailabilityBlock rows", async () => {
    const current = getRegionalWeeklyReset("EU");
    await characterWeeklyAvailabilityRepository.clearUnavailable(ids.kaelResto, current.resetIdentifier);
    await orm.CharacterAvailabilityBlock.create({
      id: crypto.randomUUID(),
      characterId: ids.kaelResto,
      startsAt: current.start.toISOString(),
      endsAt: current.end.toISOString(),
      reason: "Legacy external",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const projection = await characterWeeklyAvailabilityService.getCurrentForOwner(kael, ids.kaelResto);
    expect(projection.status).toBe("AVAILABLE");
  });
});

describe("signup eligibility weekly unavailable", () => {
  it("marks CHARACTER_UNAVAILABLE when weeklyUnavailable is set", async () => {
    const { evaluateBoosterOptions } = await import("@/services/signup-eligibility");
    const result = evaluateBoosterOptions(
      [
        {
          id: "char-1",
          userId: ids.kael,
          name: "Stormhowl",
          realm: "Twisting Nether",
          region: "EU",
          wowClass: "SHAMAN",
          specialization: "Restoration",
          playableSpecs: [],
          isActive: true,
          warcraftLogsId: null,
          ownerIsBooster: true,
          lockouts: [],
          reservationConflict: null,
          weeklyUnavailable: true,
        },
      ],
      {
        id: "run-1",
        difficulty: "HEROIC",
        status: "OPEN",
        signupsOpen: true,
        lootType: "UNSAVED",
        scheduledStartAt: new Date().toISOString(),
        contents: [
          {
            raidId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            raidName: "The Venomous Abyss",
            sortOrder: 1,
            plannedBossCount: 8,
            totalBossCount: 8,
            bosses: [],
          },
        ],
      },
    );
    expect(result.eligible).toHaveLength(0);
    expect(result.ineligible[0]?.reason).toBe("CHARACTER_UNAVAILABLE");
  });
});
