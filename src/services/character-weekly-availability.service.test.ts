import { afterAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import { characterWeeklyAvailabilityRepository } from "@/repositories/character-weekly-availability.repository";
import { characterWeeklyAvailabilityService } from "@/services/character-weekly-availability.service";
import { lockoutService } from "@/services/lockout.service";
import { venomousCreateInput } from "@/lib/test-run-input";
import { runService } from "@/services/run.service";
import { rosterService } from "@/services/roster.service";
import { signupService } from "@/services/signup.service";

const ids = {
  kael: "11111111-1111-4111-8111-111111111111",
  mira: "22222222-2222-4222-8222-222222222222",
  thorne: "33333333-3333-4333-8333-333333333333",
  kaelResto: "c1111111-1111-4111-8111-111111111111",
  kaelEle: "c1111111-1111-4111-8111-111111111112",
  miraChar: "c2222222-2222-4222-8222-222222222222",
};

const createdRunIds: string[] = [];

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
const mira = asUser(ids.mira, "Mira Dawnward");
const thorne = asUser(ids.thorne, "Thorne Ironvein", "RAID_LEAD");

afterAll(async () => {
  for (const characterId of [ids.kaelResto, ids.kaelEle, ids.miraChar]) {
    await orm.CharacterWeeklyUnavailability.where({ characterId }).delete().catch(() => {});
  }
  for (const runId of createdRunIds) {
    const roster = await orm.RunRoster.where({ runId }).first();
    if (roster) {
      await orm.RunRosterEntry.where({ rosterId: (roster as { id: string }).id }).delete().catch(() => {});
      await orm.RunRoster.where({ id: (roster as { id: string }).id }).delete().catch(() => {});
    }
    const signups = await orm.RunSignup.where({ runId }).select("id").all();
    for (const signup of signups as Array<{ id: string }>) {
      await orm.RunSignupRole.where({ signupId: signup.id }).delete().catch(() => {});
    }
    await orm.RunSignup.where({ runId }).delete().catch(() => {});
    await orm.RunRaidContent.where({ runId }).delete().catch(() => {});
    await orm.Run.where({ id: runId }).delete().catch(() => {});
  }
});

describe("characterWeeklyAvailabilityService", () => {
  it("defaults to Available when no current-reset record exists", async () => {
    const current = getRegionalWeeklyReset("EU").resetIdentifier;
    await characterWeeklyAvailabilityRepository.clearUnavailable(ids.kaelResto, current);
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
    await expectDomainCode(
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
    await expectDomainCode(
      characterWeeklyAvailabilityService.setCurrentResetAvailability(mira, {
        characterId: ids.kaelResto,
        available: false,
        unavailableDifficulties: ["HEROIC"],
      }),
      "CHARACTER_NOT_OWNED",
    );
  });

  it("blocks matching difficulty signup/selection and allows other difficulties", async () => {
    const heroicRun = await runService.createRun(
      thorne,
      venomousCreateInput({
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        venomousPlannedBossCount: 8,
        scheduledStartAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      }),
    );
    createdRunIds.push(heroicRun.id);
    await runService.openRun(thorne, heroicRun.id);
    const heroicView = await rosterService.getRosterManagementView(thorne, heroicRun.id);
    const resetForRun = lockoutService.getResetIdentifierForRun(
      "EU",
      heroicView.run.scheduledStartAt,
    );

    await characterWeeklyAvailabilityRepository.replaceUnavailableDifficulties(
      ids.kaelResto,
      resetForRun,
      ["HEROIC"],
    );

    await expectDomainCode(
      signupService.createBoosterSignup(kael, {
        runId: heroicRun.id,
        characterId: ids.kaelResto,
        role: "HEALER",
        isBackup: false,
      }),
      "CHARACTER_UNAVAILABLE",
    );

    // Ensure Mythic eligibility exists so the non-matching difficulty path is not
    // blocked by Booster Access — only weekly availability should gate Heroic.
    const { boosterQualificationService } = await import("@/services/booster-qualification.service");
    const admin = asUser("44444444-4444-4444-8444-444444444444", "Aelira Softstep", "ADMIN");
    try {
      await boosterQualificationService.grant(admin, { userId: ids.kael, difficulty: "MYTHIC" });
    } catch (error) {
      if (!(isDomainError(error) && error.code === "BOOSTER_ACCESS_ALREADY_APPROVED")) {
        throw error;
      }
    }

    const mythicRun = await runService.createRun(
      thorne,
      venomousCreateInput({
        difficulty: "MYTHIC",
        lootType: "UNSAVED",
        venomousPlannedBossCount: 8,
        scheduledStartAt: new Date(Date.now() + 4.5 * 24 * 60 * 60 * 1000).toISOString(),
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      }),
    );
    createdRunIds.push(mythicRun.id);
    await runService.openRun(thorne, mythicRun.id);

    const mythicSignup = await signupService.createBoosterSignup(kael, {
      runId: mythicRun.id,
      characterId: ids.kaelResto,
      role: "HEALER",
      isBackup: false,
    });
    expect(mythicSignup.id).toBeTruthy();

    await characterWeeklyAvailabilityRepository.clearUnavailable(ids.kaelResto, resetForRun);
    const signup = await signupService.createBoosterSignup(kael, {
      runId: heroicRun.id,
      characterId: ids.kaelResto,
      role: "HEALER",
      isBackup: false,
    });

    await characterWeeklyAvailabilityRepository.replaceUnavailableDifficulties(
      ids.kaelResto,
      resetForRun,
      ["HEROIC"],
    );
    const view = await rosterService.getRosterManagementView(thorne, heroicRun.id);
    await expectDomainCode(
      rosterService.setDraftSelection(thorne, {
        runId: heroicRun.id,
        signupId: signup.id,
        selected: true,
        version: view.roster.version,
      }),
      "CHARACTER_SCHEDULE_CONFLICT",
    );
  });

  it("keeps existing selection when later marked Unavailable and blocks publish until cleared", async () => {
    const scheduledStartAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const run = await runService.createRun(
      thorne,
      venomousCreateInput({
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        venomousPlannedBossCount: 8,
        scheduledStartAt,
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      }),
    );
    createdRunIds.push(run.id);
    await runService.openRun(thorne, run.id);

    const resetForRun = lockoutService.getResetIdentifierForRun("EU", scheduledStartAt);
    await characterWeeklyAvailabilityRepository.clearUnavailable(ids.kaelResto, resetForRun);

    const signup = await signupService.createBoosterSignup(kael, {
      runId: run.id,
      characterId: ids.kaelResto,
      role: "HEALER",
      isBackup: false,
    });
    let view = await rosterService.getRosterManagementView(thorne, run.id);
    await rosterService.setDraftSelection(thorne, {
      runId: run.id,
      signupId: signup.id,
      selected: true,
      version: view.roster.version,
    });

    await characterWeeklyAvailabilityRepository.replaceUnavailableDifficulties(
      ids.kaelResto,
      resetForRun,
      ["HEROIC"],
    );
    view = await rosterService.getRosterManagementView(thorne, run.id);
    const selected = view.boosters.find((item) => item.id === signup.id);
    expect(selected?.draftSelected).toBe(true);
    expect(selected?.scheduleConflicts.some((row) => row.source === "WEEKLY_UNAVAILABLE")).toBe(
      true,
    );
    expect(selected?.scheduleConflicts.find((row) => row.source === "WEEKLY_UNAVAILABLE")?.message).toContain(
      "Heroic",
    );

    await expectDomainCode(
      rosterService.publishRoster(thorne, {
        runId: run.id,
        version: view.roster.version,
        acknowledgeWarnings: true,
      }),
      "ROSTER_HAS_SCHEDULE_CONFLICTS",
    );

    await characterWeeklyAvailabilityRepository.clearUnavailable(ids.kaelResto, resetForRun);
    view = await rosterService.getRosterManagementView(thorne, run.id);
    expect(
      view.boosters.find((item) => item.id === signup.id)?.scheduleConflicts.some(
        (row) => row.source === "WEEKLY_UNAVAILABLE",
      ),
    ).toBe(false);
  });

  it("ignores deprecated CharacterAvailabilityBlock rows", async () => {
    const current = getRegionalWeeklyReset("EU");
    await characterWeeklyAvailabilityRepository.clearUnavailable(ids.kaelResto, current.resetIdentifier);
    const blockId = crypto.randomUUID();
    await orm.CharacterAvailabilityBlock.create({
      id: blockId,
      characterId: ids.kaelResto,
      startsAt: current.start.toISOString(),
      endsAt: current.end.toISOString(),
      reason: "Legacy external",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const projection = await characterWeeklyAvailabilityService.getCurrentForOwner(kael, ids.kaelResto);
    expect(projection.status).toBe("AVAILABLE");

    await orm.CharacterAvailabilityBlock.where({ id: blockId }).delete();
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
          isActive: true,
          warcraftLogsId: null,
          boosterQualifications: [{ difficulty: "HEROIC", status: "APPROVED" }],
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
          },
        ],
      },
    );
    expect(result.eligible).toHaveLength(0);
    expect(result.ineligible[0]?.reason).toBe("CHARACTER_UNAVAILABLE");
  });
});
