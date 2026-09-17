import { describe, expect, it } from "vitest";
import {
  projectCharacterScheduleConflicts,
  projectScheduleConflictsByCharacter,
} from "@/services/character-schedule-conflict";
import { CROSS_RUN_RESERVATION_MIN_GAP_MS, scheduledStartsCollideForReservation } from "@/repositories/signup.repository";

describe("character schedule conflict domain", () => {
  it("keeps the 2h reservation boundary", () => {
    const base = Date.parse("2026-09-18T16:00:00.000Z");
    expect(CROSS_RUN_RESERVATION_MIN_GAP_MS).toBe(2 * 60 * 60 * 1000);
    expect(scheduledStartsCollideForReservation(base, base + CROSS_RUN_RESERVATION_MIN_GAP_MS - 1)).toBe(true);
    expect(scheduledStartsCollideForReservation(base, base + CROSS_RUN_RESERVATION_MIN_GAP_MS)).toBe(false);
    expect(scheduledStartsCollideForReservation(base, base + CROSS_RUN_RESERVATION_MIN_GAP_MS + 1)).toBe(false);
  });

  it("projects reservation conflicts with deterministic ordering", () => {
    const reservations = [
      {
        characterId: "char-1",
        runId: "run-b",
        runTitle: "Later Conflict",
        scheduledStartAt: "2026-09-18T17:30:00.000Z",
      },
      {
        characterId: "char-1",
        runId: "run-a",
        runTitle: "Earlier Conflict",
        scheduledStartAt: "2026-09-18T15:30:00.000Z",
      },
    ];

    const forward = projectCharacterScheduleConflicts({ reservations });
    const reverse = projectCharacterScheduleConflicts({
      reservations: [...reservations].reverse(),
    });

    expect(forward.map((row) => row.source)).toEqual(["RUN_RESERVATION", "RUN_RESERVATION"]);
    expect(forward[0]).toMatchObject({ source: "RUN_RESERVATION", conflictingRunId: "run-a" });
    expect(forward[1]).toMatchObject({ source: "RUN_RESERVATION", conflictingRunId: "run-b" });
    expect(forward).toEqual(reverse);
    expect(forward[0]?.message).toContain("Earlier Conflict");
  });

  it("batches by Character and returns empty arrays for conflict-free ids", () => {
    const byCharacter = projectScheduleConflictsByCharacter({
      characterIds: ["char-1", "char-2"],
      reservations: [
        {
          characterId: "char-1",
          runId: "run-a",
          runTitle: "Other",
          scheduledStartAt: "2026-09-18T15:30:00.000Z",
        },
      ],
    });
    expect(byCharacter.get("char-1")?.map((row) => row.source)).toEqual(["RUN_RESERVATION"]);
    expect(byCharacter.get("char-2")).toEqual([]);
  });
});
