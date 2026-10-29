import { describe, expect, it } from "vitest";
import {
  SIGNUP_GROUP_BY_STORAGE_KEY,
  buildSignupGroups,
  groupSignupTilesByPlayer,
  readSignupGroupBy,
  signupGroupCountLabel,
  signupRoleBuckets,
  writeSignupGroupBy,
  getSignupGroupByServerSnapshot,
  getSignupGroupBySnapshot,
  setSignupGroupBy,
  type GroupableSignupTile,
  type SignupRenderGroup,
} from "@/components/manage/roster-signup-grouping";
import type { CharacterRole } from "@/models/enums";

function tile(id: string, userId: string, userName: string, roles: CharacterRole[] = ["RANGED_DPS"]): GroupableSignupTile {
  return { id, userId, userName, participationType: "BOOSTER", assignableRoles: roles };
}
const lootbuddy = (id: string, userId: string, userName: string): GroupableSignupTile => ({
  id,
  userId,
  userName,
  participationType: "LOOTBUDDY",
  assignableRoles: [],
});

const zedHeal = tile("s1", "u-zed", "zed", ["HEALER", "RANGED_DPS"]);
const annaTank = tile("s2", "u-anna", "Änna", ["TANK"]);
const zedMage = tile("s3", "u-zed", "zed", ["RANGED_DPS"]);
const bobPaladin = tile("s4", "u-bob", "Bob", ["TANK", "HEALER", "MELEE_DPS"]);
const annaLb = lootbuddy("s5", "u-anna", "Änna");
const tiles = [zedHeal, annaTank, zedMage, bobPaladin, annaLb];
const externals = [
  { id: "e1", participationType: "BOOSTER" as const, role: "HEALER" as const },
  { id: "e2", participationType: "LOOTBUDDY" as const, role: null },
];

const shape = <E extends { id: string }>(groups: SignupRenderGroup<GroupableSignupTile, E>[]) =>
  groups.map((group) => [group.label, group.tiles.map((row) => row.id), group.externals.map((row) => row.id)]);

describe("Group by: None", () => {
  it("one plain grid, exactly the given tiles and externals in their order (the current compact view)", () => {
    expect(shape(buildSignupGroups({ mode: "NONE", tiles, externals }))).toEqual([
      [null, ["s1", "s2", "s3", "s4", "s5"], ["e1", "e2"]],
    ]);
    expect(buildSignupGroups({ mode: "NONE", tiles: [], externals: [] })).toEqual([]);
  });
});

describe("Group by: Player", () => {
  it("players alphabetically (case/accent-insensitive), tile order kept, externals last", () => {
    expect(shape(buildSignupGroups({ mode: "PLAYER", tiles, externals }))).toEqual([
      ["Änna", ["s2", "s5"], []],
      ["Bob", ["s4"], []],
      ["zed", ["s1", "s3"], []],
      ["External", [], ["e1", "e2"]],
    ]);
  });

  it("two players with the same name stay separate in a stable order", () => {
    expect(groupSignupTilesByPlayer([tile("a", "u2", "Kiri"), tile("b", "u1", "kiri")]).map((group) => group.tiles[0]!.id)).toEqual([
      "b",
      "a",
    ]);
  });
});

describe("Group by: Role", () => {
  it("Tank, Healer, DPS, Lootbuddies in that order; a multi-role Character under every role it offers", () => {
    expect(shape(buildSignupGroups({ mode: "ROLE", tiles, externals }))).toEqual([
      ["Tank", ["s2", "s4"], []],
      ["Healer", ["s1", "s4"], ["e1"]],
      ["DPS", ["s1", "s3", "s4"], []],
      ["Lootbuddies", ["s5"], ["e2"]],
    ]);
  });

  it("no duplicated records: the very same tile object appears in each of its role groups", () => {
    const groups = buildSignupGroups({ mode: "ROLE", tiles, externals: [] });
    const bobs = groups.flatMap((group) => group.tiles.filter((row) => row.id === "s4"));
    expect(bobs).toHaveLength(3);
    expect(bobs.every((row) => row === bobPaladin)).toBe(true);
    // Melee + Ranged both count as DPS once.
    expect(signupRoleBuckets(tile("x", "u", "U", ["MELEE_DPS", "RANGED_DPS"]))).toEqual(["DPS"]);
  });

  it("an active role filter shows only that role group; empty groups never appear", () => {
    const filtered = [annaTank, bobPaladin]; // what the Role = Tank filter leaves
    expect(shape(buildSignupGroups({ mode: "ROLE", tiles: filtered, externals, roleFilter: "TANK" }))).toEqual([
      ["Tank", ["s2", "s4"], []],
    ]);
    expect(shape(buildSignupGroups({ mode: "ROLE", tiles: [zedMage], externals: [], roleFilter: "MELEE_DPS" }))).toEqual([
      ["DPS", ["s3"], []],
    ]);
    expect(buildSignupGroups({ mode: "ROLE", tiles: [], externals: [], roleFilter: "ALL" })).toEqual([]);
  });
});

describe("group heading counts", () => {
  it("reads naturally", () => {
    expect(signupGroupCountLabel(1)).toBe("1 Character");
    expect(signupGroupCountLabel(3)).toBe("3 Characters");
  });
});

describe("Group by preference (browser-local)", () => {
  function memoryStorage() {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      values,
    };
  }

  it("defaults to None; remembers the chosen mode; ignores unknown values", () => {
    const storage = memoryStorage();
    expect(readSignupGroupBy(storage)).toBe("NONE");
    writeSignupGroupBy(storage, "ROLE");
    expect(storage.values.get(SIGNUP_GROUP_BY_STORAGE_KEY)).toBe("ROLE");
    expect(readSignupGroupBy(storage)).toBe("ROLE");
    writeSignupGroupBy(storage, "PLAYER");
    expect(readSignupGroupBy(storage)).toBe("PLAYER");
    storage.values.set(SIGNUP_GROUP_BY_STORAGE_KEY, "class");
    expect(readSignupGroupBy(storage)).toBe("NONE");
  });

  it("blocked or missing storage never breaks the page", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    };
    expect(readSignupGroupBy(blocked)).toBe("NONE");
    expect(() => writeSignupGroupBy(blocked, "ROLE")).not.toThrow();
    expect(readSignupGroupBy(null)).toBe("NONE");
  });
});

describe("Group by store (useSyncExternalStore)", () => {
  it("server render is always None; a choice applies on the page even without storage (here: no window)", () => {
    expect(getSignupGroupByServerSnapshot()).toBe("NONE");
    expect(getSignupGroupBySnapshot()).toBe("NONE");
    setSignupGroupBy("ROLE");
    expect(getSignupGroupBySnapshot()).toBe("ROLE");
    setSignupGroupBy("NONE");
    expect(getSignupGroupBySnapshot()).toBe("NONE");
  });
});
