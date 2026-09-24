import { findRaidCatalogById } from "@/lib/wow-raid-catalog";

/** One raid boss and whether this Character killed it in the lockout's reset. */
export type LockoutBossState = {
  name: string;
  killed: boolean;
};

/**
 * `CharacterRaidLockout.killedBossIds` is a JSON array of catalog boss ids.
 * Null (older rows, or unreadable data) means "which bosses" is unknown —
 * never guessed from the count.
 */
export function parseKilledBossIds(value: unknown): string[] | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string") ? parsed : null;
  } catch {
    return null;
  }
}

export function serializeKilledBossIds(ids: readonly string[]): string {
  return JSON.stringify([...ids]);
}

/** Catalog boss order with a killed flag; null when the raid or the killed list is unknown. */
export function lockoutBossBreakdown(raidId: string, killedBossIds: readonly string[] | null | undefined): LockoutBossState[] | null {
  if (!killedBossIds) return null;
  const raid = findRaidCatalogById(raidId);
  if (!raid || raid.bosses.length === 0) return null;
  const killed = new Set(killedBossIds);
  return [...raid.bosses]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((boss) => ({ name: boss.name, killed: killed.has(boss.id) }));
}
