import type { CharacterRole, ParticipationType } from "@/models/enums";

/**
 * Roster Builder Signups: "Group by" presentation (None / Player / Role).
 * Pure — every mode shows the same, already filtered tiles with the same
 * actions; grouping only changes the layout. Never creates or duplicates
 * signups or roster entries: a multi-role Character simply appears under each
 * role it offers, as the very same tile.
 */

export const SIGNUP_GROUP_BY_MODES = ["NONE", "PLAYER", "ROLE"] as const;
export type SignupGroupBy = (typeof SIGNUP_GROUP_BY_MODES)[number];

export const SIGNUP_GROUP_BY_LABELS: Record<SignupGroupBy, string> = {
  NONE: "None",
  PLAYER: "Player",
  ROLE: "Role",
};

export type GroupableSignupTile = {
  id: string;
  userId: string;
  userName: string;
  participationType: ParticipationType;
  /** Concrete roles this signup can be assigned (Roster view booster cards). */
  assignableRoles: readonly CharacterRole[];
};

export type SignupTileGroup<T> = {
  key: string;
  label: string;
  tiles: T[];
};

/**
 * Tiles per player, players alphabetically (case- and accent-insensitive;
 * same names by id, so the order is stable). Tiles keep their order inside a
 * group. Only players with a tile appear — filters never leave empty groups.
 */
export function groupSignupTilesByPlayer<T extends GroupableSignupTile>(tiles: readonly T[]): SignupTileGroup<T>[] {
  const groups = new Map<string, SignupTileGroup<T> & { userId: string }>();
  for (const tile of tiles) {
    const group = groups.get(tile.userId) ?? { key: `player:${tile.userId}`, label: tile.userName, userId: tile.userId, tiles: [] };
    group.tiles.push(tile);
    groups.set(tile.userId, group);
  }
  return [...groups.values()]
    .sort((left, right) => left.label.localeCompare(right.label, "en", { sensitivity: "base" }) || left.userId.localeCompare(right.userId))
    .map(({ key, label, tiles: groupTiles }) => ({ key, label, tiles: groupTiles }));
}

export type SignupRoleBucket = "TANK" | "HEALER" | "DPS" | "LOOTBUDDY";

const ROLE_BUCKETS: ReadonlyArray<{ bucket: SignupRoleBucket; label: string }> = [
  { bucket: "TANK", label: "Tank" },
  { bucket: "HEALER", label: "Healer" },
  { bucket: "DPS", label: "DPS" },
  { bucket: "LOOTBUDDY", label: "Lootbuddies" },
];

/** The role groups a tile belongs to: every role it actually offers (Melee / Ranged both count as DPS once). */
export function signupRoleBuckets(tile: Pick<GroupableSignupTile, "participationType" | "assignableRoles">): SignupRoleBucket[] {
  if (tile.participationType === "LOOTBUDDY") return ["LOOTBUDDY"];
  const buckets: SignupRoleBucket[] = [];
  if (tile.assignableRoles.includes("TANK")) buckets.push("TANK");
  if (tile.assignableRoles.includes("HEALER")) buckets.push("HEALER");
  if (tile.assignableRoles.some((role) => role === "MELEE_DPS" || role === "RANGED_DPS" || role === "DPS")) buckets.push("DPS");
  return buckets;
}

function bucketOfRoleFilter(roleFilter: string): SignupRoleBucket | null {
  if (roleFilter === "TANK") return "TANK";
  if (roleFilter === "HEALER") return "HEALER";
  if (roleFilter === "MELEE_DPS" || roleFilter === "RANGED_DPS" || roleFilter === "DPS") return "DPS";
  return null;
}

/** "1 Character" / "3 Characters" — the count shown next to each group heading. */
export function signupGroupCountLabel(count: number): string {
  return `${count} ${count === 1 ? "Character" : "Characters"}`;
}

/** Browser-local preference key: the Signups grouping the Raid Lead last chose. */
export const SIGNUP_GROUP_BY_STORAGE_KEY = "boostinghub.roster.signups.groupBy";

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

/** The stored mode; anything else, or storage unavailable (private mode, blocked), → NONE (the compact tiles). */
export function readSignupGroupBy(storage: PreferenceStorage | null | undefined): SignupGroupBy {
  try {
    const value = storage?.getItem(SIGNUP_GROUP_BY_STORAGE_KEY);
    return SIGNUP_GROUP_BY_MODES.find((mode) => mode === value) ?? "NONE";
  } catch {
    return "NONE";
  }
}

export function writeSignupGroupBy(storage: PreferenceStorage | null | undefined, mode: SignupGroupBy): void {
  try {
    storage?.setItem(SIGNUP_GROUP_BY_STORAGE_KEY, mode);
  } catch {
    // Not persisted (storage blocked) — the selection still applies on this page.
  }
}

/** A hand-added External Booster tile: no player account, grouped by its own role. */
export type GroupableExternalTile = { participationType: ParticipationType; role: CharacterRole | null };

export type SignupRenderGroup<T, E> = {
  key: string;
  /** null = no heading (the plain tile grid of "None"). */
  label: string | null;
  tiles: T[];
  externals: E[];
};

function externalRoleBucket(external: GroupableExternalTile): SignupRoleBucket {
  if (external.participationType === "LOOTBUDDY") return "LOOTBUDDY";
  if (external.role === "TANK") return "TANK";
  if (external.role === "HEALER") return "HEALER";
  return "DPS";
}

/**
 * What the Signups section renders for a mode: NONE = one grid exactly as
 * before (externals first); PLAYER = one group per player, externals in a
 * trailing "External" group; ROLE = Tank / Healer / DPS / Lootbuddies with
 * externals under their own role. A multi-role Character appears under each
 * role it offers — the same tile, so selecting it anywhere selects that one
 * signup. With a role filter active only that role's group shows. Empty
 * groups never appear.
 */
export function buildSignupGroups<T extends GroupableSignupTile, E extends GroupableExternalTile>(input: {
  mode: SignupGroupBy;
  tiles: readonly T[];
  externals: readonly E[];
  roleFilter?: string;
}): SignupRenderGroup<T, E>[] {
  if (input.mode === "PLAYER") {
    return [
      ...groupSignupTilesByPlayer(input.tiles).map((group) => ({ ...group, externals: [] as E[] })),
      ...(input.externals.length > 0
        ? [{ key: "external", label: "External", tiles: [] as T[], externals: [...input.externals] }]
        : []),
    ];
  }
  if (input.mode === "ROLE") {
    const only = input.roleFilter ? bucketOfRoleFilter(input.roleFilter) : null;
    return ROLE_BUCKETS.filter(({ bucket }) => !only || bucket === only)
      .map(({ bucket, label }) => ({
        key: `role:${bucket}`,
        label,
        tiles: input.tiles.filter((tile) => signupRoleBuckets(tile).includes(bucket)),
        externals: input.externals.filter((external) => externalRoleBucket(external) === bucket),
      }))
      .filter((group) => group.tiles.length + group.externals.length > 0);
  }
  return input.tiles.length + input.externals.length > 0
    ? [{ key: "all", label: null, tiles: [...input.tiles], externals: [...input.externals] }]
    : [];
}

/** window.localStorage when reachable; null on the server or when the browser blocks it (access itself can throw). */
export function browserLocalStorage(): PreferenceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/*
 * Client store for useSyncExternalStore: the stored mode, or the one chosen
 * on this page when storage is blocked. The server snapshot is NONE, so the
 * first render always matches; other tabs follow via the storage event.
 */
let chosenThisPage: SignupGroupBy | null = null;
const groupByListeners = new Set<() => void>();

export function subscribeSignupGroupBy(listener: () => void): () => void {
  groupByListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== SIGNUP_GROUP_BY_STORAGE_KEY) return;
    chosenThisPage = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    groupByListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getSignupGroupBySnapshot(): SignupGroupBy {
  return chosenThisPage ?? readSignupGroupBy(browserLocalStorage());
}

export function getSignupGroupByServerSnapshot(): SignupGroupBy {
  return "NONE";
}

export function setSignupGroupBy(mode: SignupGroupBy): void {
  chosenThisPage = mode;
  writeSignupGroupBy(browserLocalStorage(), mode);
  for (const listener of groupByListeners) listener();
}
