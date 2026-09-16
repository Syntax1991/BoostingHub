import { describe, expect, it } from "vitest";
import {
  projectCharacterScheduleConflicts,
  projectScheduleConflictsByCharacter,
} from "@/services/character-schedule-conflict";
import { CROSS_RUN_RESERVATION_MIN_GAP_MS, scheduledStartsCollideForReservation } from "@/repositories/signup.repository";
import { runStartFallsInAvailabilityBlock } from "@/lib/character-availability";

const block = {
  id: "block-1",
  characterId: "char-1",
  startsAt: "2026-09-18T16:00:00.000Z", // 18:00 Berlin
  endsAt: "2026-09-18T19:00:00.000Z", // 21:00 Berlin
  reason: "External boost",
};

describe("character schedule conflict domain", () => {
  it("uses half-open manual availability against the Run start", () => {
    expect(runStartFallsInAvailabilityBlock("2026-09-18T15:59:59.000Z", block)).toBe(false);
    expect(runStartFallsInAvailabilityBlock("2026-09-18T16:00:00.000Z", block)).toBe(true);
    expect(runStartFallsInAvailabilityBlock("2026-09-18T18:59:59.000Z", block)).toBe(true);
    expect(runStartFallsInAvailabilityBlock("2026-09-18T19:00:00.000Z", block)).toBe(false);
  });

  it("keeps the 2h reservation boundary", () => {
    const base = Date.parse("2026-09-18T16:00:00.000Z");
    expect(CROSS_RUN_RESERVATION_MIN_GAP_MS).toBe(2 * 60 * 60 * 1000);
    expect(scheduledStartsCollideForReservation(base, base + CROSS_RUN_RESERVATION_MIN_GAP_MS - 1)).toBe(true);
    expect(scheduledStartsCollideForReservation(base, base + CROSS_RUN_RESERVATION_MIN_GAP_MS)).toBe(false);
    expect(scheduledStartsCollideForReservation(base, base + CROSS_RUN_RESERVATION_MIN_GAP_MS + 1)).toBe(false);
  });

  it("projects both reservation and manual conflicts with deterministic ordering", () => {
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
    const blocks = [
      {
        id: "z-block",
        characterId: "char-1",
        startsAt: "2026-09-18T16:00:00.000Z",
        endsAt: "2026-09-18T22:00:00.000Z",
        reason: "Broad block",
      },
      {
        id: "a-block",
        characterId: "char-1",
        startsAt: "2026-09-18T16:00:00.000Z",
        endsAt: "2026-09-18T20:00:00.000Z",
        reason: "Another",
      },
    ];

    const forward = projectCharacterScheduleConflicts({
      runStartAt: "2026-09-18T16:30:00.000Z",
      reservations,
      availabilityBlocks: blocks,
    });
    const reverse = projectCharacterScheduleConflicts({
      runStartAt: "2026-09-18T16:30:00.000Z",
      reservations: [...reservations].reverse(),
      availabilityBlocks: [...blocks].reverse(),
    });

    expect(forward.map((row) => row.source)).toEqual([
      "RUN_RESERVATION",
      "RUN_RESERVATION",
      "MANUAL_AVAILABILITY",
      "MANUAL_AVAILABILITY",
    ]);
    expect(forward[0]).toMatchObject({ source: "RUN_RESERVATION", conflictingRunId: "run-a" });
    expect(forward[1]).toMatchObject({ source: "RUN_RESERVATION", conflictingRunId: "run-b" });
    expect(forward[2]).toMatchObject({ source: "MANUAL_AVAILABILITY", blockId: "a-block", reason: "Another" });
    expect(forward[3]).toMatchObject({ source: "MANUAL_AVAILABILITY", blockId: "z-block", reason: "Broad block" });
    expect(forward).toEqual(reverse);
    expect(forward[0]?.message).toContain("Earlier Conflict");
    expect(forward[2]?.message).toContain("External availability:");
    expect(forward[2]?.message).toContain("Another");
  });

  it("batches by Character and returns empty arrays for conflict-free ids", () => {
    const byCharacter = projectScheduleConflictsByCharacter({
      characterIds: ["char-1", "char-2"],
      runStartAt: "2026-09-18T16:30:00.000Z",
      reservations: [
        {
          characterId: "char-1",
          runId: "run-a",
          runTitle: "Other",
          scheduledStartAt: "2026-09-18T15:30:00.000Z",
        },
      ],
      availabilityBlocks: [block],
    });
    expect(byCharacter.get("char-1")?.map((row) => row.source)).toEqual([
      "RUN_RESERVATION",
      "MANUAL_AVAILABILITY",
    ]);
    expect(byCharacter.get("char-2")).toEqual([]);
  });
});
