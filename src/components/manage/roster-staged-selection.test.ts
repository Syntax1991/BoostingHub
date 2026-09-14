import { describe, expect, it } from "vitest";
import {
  applyRoleCopyToggle,
  buildRosterSavedSelectionKey,
  isRoleCopyChecked,
  syncStagedSelectionIds,
} from "@/components/manage/roster-staged-selection";
import type { CharacterRole } from "@/models/enums";

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

describe("role-copy toggle semantics", () => {
  const signupId = "signup-paladin";

  it("selects through the Tank copy with selectedRole TANK", () => {
    const staged = applyRoleCopyToggle({
      staged: new Map(),
      signupId,
      groupRole: "TANK",
      checked: true,
    });
    expect(staged.get(signupId)).toBe("TANK");
    expect(isRoleCopyChecked({ stagedRole: staged.get(signupId), groupRole: "TANK" })).toBe(true);
    expect(isRoleCopyChecked({ stagedRole: staged.get(signupId), groupRole: "HEALER" })).toBe(false);
  });

  it("reassigns through the Healer copy without creating a second slot", () => {
    let staged: Map<string, CharacterRole | null> = new Map([[signupId, "TANK"]]);
    staged = applyRoleCopyToggle({
      staged,
      signupId,
      groupRole: "HEALER",
      checked: true,
    });
    expect([...staged.keys()]).toEqual([signupId]);
    expect(staged.get(signupId)).toBe("HEALER");
    expect(isRoleCopyChecked({ stagedRole: staged.get(signupId), groupRole: "TANK" })).toBe(false);
    expect(isRoleCopyChecked({ stagedRole: staged.get(signupId), groupRole: "HEALER" })).toBe(true);
  });

  it("deselects when unchecking the currently assigned role copy", () => {
    let staged: Map<string, CharacterRole | null> = new Map([[signupId, "HEALER"]]);
    staged = applyRoleCopyToggle({
      staged,
      signupId,
      groupRole: "HEALER",
      checked: false,
    });
    expect(staged.has(signupId)).toBe(false);
    expect(isRoleCopyChecked({ stagedRole: staged.get(signupId), groupRole: "HEALER" })).toBe(false);
    expect(isRoleCopyChecked({ stagedRole: staged.get(signupId), groupRole: "TANK" })).toBe(false);
  });

  it("does not deselect when unchecking a non-assigned role copy", () => {
    let staged: Map<string, CharacterRole | null> = new Map([[signupId, "TANK"]]);
    staged = applyRoleCopyToggle({
      staged,
      signupId,
      groupRole: "HEALER",
      checked: false,
    });
    expect(staged.get(signupId)).toBe("TANK");
  });

  it("keeps save payload unique after visual multi-section selection", () => {
    let staged: Map<string, CharacterRole | null> = new Map();
    staged = applyRoleCopyToggle({ staged, signupId, groupRole: "TANK", checked: true });
    staged = applyRoleCopyToggle({ staged, signupId, groupRole: "HEALER", checked: true });
    staged = applyRoleCopyToggle({ staged, signupId, groupRole: "DPS", checked: true });
    const payload = [...staged].map(([id, selectedRole]) => ({ signupId: id, selectedRole }));
    expect(payload).toEqual([{ signupId, selectedRole: "DPS" }]);
  });

  it("syncs dropdown reassignment with checked copies", () => {
    const staged: Map<string, CharacterRole | null> = new Map([[signupId, "TANK"]]);
    staged.set(signupId, "HEALER");
    expect(isRoleCopyChecked({ stagedRole: staged.get(signupId), groupRole: "TANK" })).toBe(false);
    expect(isRoleCopyChecked({ stagedRole: staged.get(signupId), groupRole: "HEALER" })).toBe(true);
  });
});
