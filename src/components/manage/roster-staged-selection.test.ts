import { describe, expect, it } from "vitest";
import {
  buildRosterSavedSelectionKey,
  syncStagedSelectionIds,
} from "@/components/manage/roster-staged-selection";

describe("roster staged selection sync", () => {
  it("builds a stable primitive key from version and sorted ids", () => {
    expect(buildRosterSavedSelectionKey(3, ["b", "a"])).toBe("3:a,b");
    expect(buildRosterSavedSelectionKey(3, ["a", "b"])).toBe("3:a,b");
  });

  it("preserves staged edits when the server snapshot key is unchanged", () => {
    const serverKey = buildRosterSavedSelectionKey(1, ["s1"]);
    const result = syncStagedSelectionIds({
      previousServerKey: serverKey,
      nextServerKey: serverKey,
      previousStagedIds: new Set(["s1", "s2"]),
      nextServerSelectedIds: ["s1"],
    });
    expect([...result.stagedIds].sort()).toEqual(["s1", "s2"]);
    expect(result.serverKey).toBe(serverKey);
  });

  it("resets staged selection when the server snapshot key changes", () => {
    const previousKey = buildRosterSavedSelectionKey(1, ["s1"]);
    const nextKey = buildRosterSavedSelectionKey(2, ["s1", "s3"]);
    const result = syncStagedSelectionIds({
      previousServerKey: previousKey,
      nextServerKey: nextKey,
      previousStagedIds: new Set(["s1", "s2"]),
      nextServerSelectedIds: ["s1", "s3"],
    });
    expect([...result.stagedIds].sort()).toEqual(["s1", "s3"]);
    expect(result.serverKey).toBe(nextKey);
  });
});
