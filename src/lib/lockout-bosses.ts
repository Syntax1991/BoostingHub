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

/** A content raid's RaidBoss row (DB catalog) — the identity behind `killedBossIds`. */
export type RaidBossRef = {
  id: string;
  name: string;
  sortOrder: number;
};

/** Map included `raid.bosses` rows (already loaded with the content) to boss refs. */
export function mapRaidBossRefs(value: unknown): RaidBossRef[] {
  if (!Array.isArray(value)) return [];
  return (value as Array<Record<string, unknown>>)
    .map((row) => ({
      id: String(row.id ?? ""),
      name: String(row.name ?? ""),
      sortOrder: Number(row.sortOrder ?? 0),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * The content raid's bosses (DB RaidBoss rows) in order with a killed flag;
 * null when the bosses or the killed list are unknown.
 */
export function lockoutBossBreakdown(
  bosses: readonly RaidBossRef[] | null | undefined,
  killedBossIds: readonly string[] | null | undefined,
): LockoutBossState[] | null {
  if (!killedBossIds) return null;
  if (!bosses || bosses.length === 0) return null;
  const killed = new Set(killedBossIds);
  return [...bosses]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((boss) => ({ name: boss.name, killed: killed.has(boss.id) }));
}
