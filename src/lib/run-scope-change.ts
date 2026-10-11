/**
 * Material change of a Run's planned raid scope (RunRaidContent), before → after.
 * Matched by raidId, never by sortOrder: a pure reorder is not a scope change.
 * Pure and client-safe; the persisted snapshot is RunDiscordAnnouncement.scopeChanges.
 */

export type RunScopeContent = {
  raidId: string;
  raidName: string;
  sortOrder: number;
  plannedBossCount: number;
  totalBossCount: number;
};

export type RunScopeChangeKind = "CHANGED" | "ADDED" | "REMOVED";

export type RunScopeChange = {
  raidId: string;
  /** Snapshot for rendering — the raid catalog may be renamed later. */
  raidName: string;
  totalBossCount: number;
  kind: RunScopeChangeKind;
  /** null when ADDED. */
  beforePlannedBossCount: number | null;
  /** null when REMOVED. */
  afterPlannedBossCount: number | null;
};

/**
 * Only the contents that changed: planned boss count changed, content added,
 * content removed (a replaced raid is one REMOVED + one ADDED). Empty when the
 * scope is materially identical (e.g. 7/9 → 7/9, or a reorder).
 * Order: after-scope order for CHANGED/ADDED, then REMOVED in before-scope order.
 */
export function diffRunScope(
  before: readonly RunScopeContent[],
  after: readonly RunScopeContent[],
): RunScopeChange[] {
  const beforeById = new Map(before.map((content) => [content.raidId, content]));
  const afterById = new Map(after.map((content) => [content.raidId, content]));
  const changes: RunScopeChange[] = [];

  for (const next of [...after].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const previous = beforeById.get(next.raidId);
    if (!previous) {
      changes.push({
        raidId: next.raidId,
        raidName: next.raidName,
        totalBossCount: next.totalBossCount,
        kind: "ADDED",
        beforePlannedBossCount: null,
        afterPlannedBossCount: next.plannedBossCount,
      });
    } else if (previous.plannedBossCount !== next.plannedBossCount) {
      changes.push({
        raidId: next.raidId,
        raidName: next.raidName,
        totalBossCount: next.totalBossCount,
        kind: "CHANGED",
        beforePlannedBossCount: previous.plannedBossCount,
        afterPlannedBossCount: next.plannedBossCount,
      });
    }
  }
  for (const previous of [...before].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (afterById.has(previous.raidId)) continue;
    changes.push({
      raidId: previous.raidId,
      raidName: previous.raidName,
      totalBossCount: previous.totalBossCount,
      kind: "REMOVED",
      beforePlannedBossCount: previous.plannedBossCount,
      afterPlannedBossCount: null,
    });
  }
  return changes;
}

function coverage(planned: number, total: number): string {
  return `${planned}/${total}`;
}

/** "9/9 → 7/9 bosses", "added · 7/9 bosses", "1/1 → removed". */
export function formatRunScopeChangeDetail(change: RunScopeChange): string {
  if (change.kind === "ADDED") {
    return `added · ${coverage(change.afterPlannedBossCount ?? 0, change.totalBossCount)} bosses`;
  }
  if (change.kind === "REMOVED") {
    return `${coverage(change.beforePlannedBossCount ?? 0, change.totalBossCount)} → removed`;
  }
  return `${coverage(change.beforePlannedBossCount ?? 0, change.totalBossCount)} → ${coverage(
    change.afterPlannedBossCount ?? 0,
    change.totalBossCount,
  )} bosses`;
}

/** One line per change: "The Venomous Abyss: 9/9 → 7/9 bosses". */
export function formatRunScopeChangeLines(changes: readonly RunScopeChange[]): string[] {
  return changes.map((change) => `${change.raidName}: ${formatRunScopeChangeDetail(change)}`);
}

export function serializeRunScopeChanges(changes: readonly RunScopeChange[]): string {
  return JSON.stringify(changes);
}

const KINDS: readonly RunScopeChangeKind[] = ["CHANGED", "ADDED", "REMOVED"];

function countOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Tolerant parse of the persisted snapshot; malformed entries are dropped, never thrown. */
export function parseRunScopeChanges(raw: string | null | undefined): RunScopeChange[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const changes: RunScopeChange[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const kind = row.kind;
    const totalBossCount = countOrNull(row.totalBossCount);
    if (
      typeof row.raidId !== "string" ||
      typeof row.raidName !== "string" ||
      typeof kind !== "string" ||
      !(KINDS as readonly string[]).includes(kind) ||
      totalBossCount == null
    ) {
      continue;
    }
    changes.push({
      raidId: row.raidId,
      raidName: row.raidName,
      totalBossCount,
      kind: kind as RunScopeChangeKind,
      beforePlannedBossCount: countOrNull(row.beforePlannedBossCount),
      afterPlannedBossCount: countOrNull(row.afterPlannedBossCount),
    });
  }
  return changes;
}
