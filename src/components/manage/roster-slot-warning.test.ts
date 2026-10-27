import { describe, expect, it } from "vitest";
import { rosterSlotWarningReasons } from "@/components/manage/roster-slot-warning";

const saved = { raidName: "Tide", label: { kind: "saved" as const, text: "HC 3/8 · Saved", attention: true } };
const unsaved = { raidName: "Venom", label: { kind: "unsaved" as const, text: "HC 0/8 · Unsaved", attention: false } };

describe("rosterSlotWarningReasons", () => {
  it("no attention → no reasons (no warning icon)", () => {
    expect(rosterSlotWarningReasons({ contentSaves: [unsaved], scheduleConflicts: [], runCommitments: [], issue: null })).toEqual([]);
  });

  it("names each concrete problem instead of a generic 'Needs attention'", () => {
    expect(
      rosterSlotWarningReasons({
        contentSaves: [unsaved, saved],
        scheduleConflicts: [{ message: "Starts 1h after Fri 21:00 Venom" }],
        runCommitments: [{ runTitle: "Sat 20:00 HC VIP", scheduledStartAt: "2026-10-31T19:00:00.000Z" }],
        issue: "No Blizzard sync yet",
      }),
    ).toEqual([
      "Starts 1h after Fri 21:00 Venom",
      "Already planned: Sat 20:00 HC VIP",
      "Tide: HC 3/8 · Saved",
      "No Blizzard sync yet",
    ]);
  });

  it("an unknown lockout on a fresh-lockout Run reads as Unknown", () => {
    const unknown = { raidName: "Kithix", label: { kind: "unknown" as const, text: "HC ?/1 · Unknown", attention: true } };
    expect(rosterSlotWarningReasons({ contentSaves: [unknown] })).toEqual(["Kithix: HC ?/1 · Unknown"]);
  });
});
