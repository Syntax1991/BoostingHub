import { afterAll, describe, expect, it, vi } from "vitest";
import { orm } from "@/lib/prisma";
import { characterWeeklyAvailabilityRepository } from "@/repositories/character-weekly-availability.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { getScheduleConflictsForCharacters } from "@/services/character-schedule-conflict.service";
import { characterWeeklyAvailabilityService } from "@/services/character-weekly-availability.service";
import { lockoutService } from "@/services/lockout.service";

const ids = {
  kaelResto: "c1111111-1111-4111-8111-111111111111",
  kaelEle: "c1111111-1111-4111-8111-111111111112",
  miraPriest: "c2222222-2222-4222-8222-222222222221",
  thorneWarrior: "c3333333-3333-4333-8333-333333333331",
};

const CURRENT = "eu-test-current-reset";
const OTHER = "eu-test-other-reset";
const RUN_START = "2026-09-10T19:00:00.000Z";
const RUN_RESET = lockoutService.getResetIdentifierForRun("EU", RUN_START);
const FIXTURE_RESETS = [CURRENT, OTHER, RUN_RESET] as const;

async function clearFixtureRows() {
  for (const characterId of Object.values(ids)) {
    for (const resetIdentifier of FIXTURE_RESETS) {
      await characterWeeklyAvailabilityRepository.clearUnavailable(characterId, resetIdentifier);
    }
  }
}

afterAll(async () => {
  await clearFixtureRows();
});

describe("characterWeeklyAvailabilityRepository.listUnavailableDifficultiesByKeys", () => {
  it("performs no query for an empty Character list", async () => {
    const spy = vi.spyOn(orm.CharacterWeeklyUnavailability, "where");
    try {
      const result = await characterWeeklyAvailabilityRepository.listUnavailableDifficultiesByKeys([]);
      expect(result.size).toBe(0);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("dedupes duplicate Character keys without expanding query work", async () => {
    await clearFixtureRows();
    await characterWeeklyAvailabilityRepository.replaceUnavailableDifficulties(
      ids.kaelResto,
      CURRENT,
      ["HEROIC"],
    );

    const spy = vi.spyOn(orm.CharacterWeeklyUnavailability, "where");
    try {
      const result = await characterWeeklyAvailabilityRepository.listUnavailableDifficultiesByKeys([
        { characterId: ids.kaelResto, resetIdentifier: CURRENT },
        { characterId: ids.kaelResto, resetIdentifier: CURRENT },
        { characterId: ids.kaelResto, resetIdentifier: CURRENT },
      ]);
      expect(result.get(`${ids.kaelResto}:${CURRENT}`)).toEqual(["HEROIC"]);
      // One entry onto the model collection — chained .where(reset) is on the builder.
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns only rows for the requested reset keys, not other resets", async () => {
    await clearFixtureRows();
    await characterWeeklyAvailabilityRepository.replaceUnavailableDifficulties(
      ids.kaelResto,
      CURRENT,
      ["HEROIC"],
    );
    await characterWeeklyAvailabilityRepository.replaceUnavailableDifficulties(
      ids.kaelResto,
      OTHER,
      ["MYTHIC"],
    );
    await characterWeeklyAvailabilityRepository.replaceUnavailableDifficulties(
      ids.miraPriest,
      CURRENT,
      ["NORMAL", "HEROIC"],
    );

    const byKey = await characterWeeklyAvailabilityRepository.listUnavailableDifficultiesByKeys([
      { characterId: ids.kaelResto, resetIdentifier: CURRENT },
      { characterId: ids.miraPriest, resetIdentifier: CURRENT },
    ]);

    expect(byKey.get(`${ids.kaelResto}:${CURRENT}`)).toEqual(["HEROIC"]);
    expect(byKey.get(`${ids.miraPriest}:${CURRENT}`)).toEqual(["NORMAL", "HEROIC"]);
    expect(byKey.has(`${ids.kaelResto}:${OTHER}`)).toBe(false);
  });

  it("batches many Characters in one lookup (no per-character fan-out)", async () => {
    await clearFixtureRows();
    const characterIds = [ids.kaelResto, ids.miraPriest, ids.thorneWarrior, ids.kaelEle];
    for (const characterId of characterIds) {
      await characterWeeklyAvailabilityRepository.replaceUnavailableDifficulties(
        characterId,
        CURRENT,
        ["HEROIC"],
      );
    }

    const spy = vi.spyOn(orm.CharacterWeeklyUnavailability, "where");
    try {
      const keys = characterIds.map((characterId) => ({
        characterId,
        resetIdentifier: CURRENT,
      }));
      const byKey = await characterWeeklyAvailabilityRepository.listUnavailableDifficultiesByKeys(keys);
      expect(byKey.size).toBe(characterIds.length);
      for (const characterId of characterIds) {
        expect(byKey.get(`${characterId}:${CURRENT}`)).toEqual(["HEROIC"]);
      }
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("getScheduleConflictsForCharacters availability batching", () => {
  it("does not fan out listUnavailableForRun per Character on a large roster", async () => {
    const characters = Array.from({ length: 25 }, (_, i) => ({
      id: `char-batch-${i}`,
      name: `Char${i}`,
      region: "EU" as const,
    }));

    const listSpy = vi
      .spyOn(characterWeeklyAvailabilityService, "listUnavailableForRun")
      .mockResolvedValue(new Set());
    const reservationSpy = vi
      .spyOn(signupRepository, "findAllReservationConflicts")
      .mockResolvedValue([]);

    try {
      await getScheduleConflictsForCharacters({
        targetRunId: "run-batch-test",
        scheduledStartAt: "2026-09-10T19:00:00.000Z",
        difficulty: "HEROIC",
        characters: [...characters, characters[0]!],
      });
      expect(listSpy).toHaveBeenCalledTimes(1);
      expect(listSpy.mock.calls[0]![0]).toHaveLength(25);
      expect(reservationSpy).toHaveBeenCalledTimes(1);
    } finally {
      listSpy.mockRestore();
      reservationSpy.mockRestore();
    }
  });

  it("returns an empty Map and skips lookups for an empty Character list", async () => {
    const listSpy = vi.spyOn(characterWeeklyAvailabilityService, "listUnavailableForRun");
    try {
      const result = await getScheduleConflictsForCharacters({
        targetRunId: "run-empty",
        scheduledStartAt: "2026-09-10T19:00:00.000Z",
        difficulty: "HEROIC",
        characters: [],
      });
      expect(result.size).toBe(0);
      expect(listSpy).not.toHaveBeenCalled();
    } finally {
      listSpy.mockRestore();
    }
  });

  it("preserves weekly-unavailability conflict semantics via the batched path", async () => {
    await clearFixtureRows();
    await characterWeeklyAvailabilityRepository.replaceUnavailableDifficulties(
      ids.kaelResto,
      RUN_RESET,
      ["HEROIC"],
    );

    const byCharacter = await getScheduleConflictsForCharacters({
      targetRunId: "run-semantics",
      scheduledStartAt: RUN_START,
      difficulty: "HEROIC",
      characters: [{ id: ids.kaelResto, name: "Stormhowl", region: "EU" }],
    });

    const conflicts = byCharacter.get(ids.kaelResto) ?? [];
    expect(conflicts.some((row) => row.source === "WEEKLY_UNAVAILABLE")).toBe(true);
  });
});

