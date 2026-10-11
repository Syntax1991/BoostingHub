import { describe, expect, it } from "vitest";
import {
  diffRunScope,
  formatRunScopeChangeLines,
  parseRunScopeChanges,
  serializeRunScopeChanges,
  type RunScopeContent,
} from "@/lib/run-scope-change";

const venom = (planned: number, sortOrder = 1): RunScopeContent => ({
  raidId: "raid-venom",
  raidName: "The Venomous Abyss",
  sortOrder,
  plannedBossCount: planned,
  totalBossCount: 9,
});
const tide = (planned: number, sortOrder = 2): RunScopeContent => ({
  raidId: "raid-tide",
  raidName: "The Tidebound Grotto",
  sortOrder,
  plannedBossCount: planned,
  totalBossCount: 1,
});

describe("diffRunScope", () => {
  it("9/9 → 7/9 is a material change", () => {
    const changes = diffRunScope([venom(9)], [venom(7)]);
    expect(changes).toEqual([
      {
        raidId: "raid-venom",
        raidName: "The Venomous Abyss",
        totalBossCount: 9,
        kind: "CHANGED",
        beforePlannedBossCount: 9,
        afterPlannedBossCount: 7,
      },
    ]);
    expect(formatRunScopeChangeLines(changes)).toEqual(["The Venomous Abyss: 9/9 → 7/9 bosses"]);
  });

  it("7/9 → 9/9 is a material change", () => {
    expect(formatRunScopeChangeLines(diffRunScope([venom(7)], [venom(9)]))).toEqual([
      "The Venomous Abyss: 7/9 → 9/9 bosses",
    ]);
  });

  it("7/9 → 7/9 and a pure reorder are no-ops", () => {
    expect(diffRunScope([venom(7)], [venom(7)])).toEqual([]);
    expect(diffRunScope([venom(7, 1), tide(1, 2)], [tide(1, 1), venom(7, 2)])).toEqual([]);
  });

  it("multi-content: reports only the content that changed", () => {
    const changes = diffRunScope([tide(1, 1), venom(9, 2)], [tide(1, 1), venom(7, 2)]);
    expect(formatRunScopeChangeLines(changes)).toEqual(["The Venomous Abyss: 9/9 → 7/9 bosses"]);
  });

  it("represents added and removed contents (a replaced raid is removed + added)", () => {
    const removed = diffRunScope([venom(9, 1), tide(1, 2)], [venom(9, 1)]);
    expect(formatRunScopeChangeLines(removed)).toEqual(["The Tidebound Grotto: 1/1 → removed"]);

    const added = diffRunScope([venom(9, 1)], [venom(9, 1), tide(1, 2)]);
    expect(formatRunScopeChangeLines(added)).toEqual(["The Tidebound Grotto: added · 1/1 bosses"]);

    const replaced = diffRunScope([venom(9, 1)], [tide(1, 1)]);
    expect(replaced.map((change) => change.kind)).toEqual(["ADDED", "REMOVED"]);
  });
});

describe("run scope change snapshot", () => {
  it("round-trips and drops malformed entries", () => {
    const changes = diffRunScope([venom(9)], [venom(7)]);
    expect(parseRunScopeChanges(serializeRunScopeChanges(changes))).toEqual(changes);
    expect(parseRunScopeChanges(null)).toEqual([]);
    expect(parseRunScopeChanges("not json")).toEqual([]);
    expect(parseRunScopeChanges(JSON.stringify([{ raidId: 1 }, ...changes]))).toEqual(changes);
  });
});
