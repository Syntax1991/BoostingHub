import type { AuditFightFact, AuditPlayerFact } from "@/services/consumable-audit-policy";

/**
 * Collapse of the BOOSTING TEAM at the end of a wipe ("wipe cascade"). Pure.
 *
 * Warcraft Logs cannot tell when a wipe was called (its `wipeCalledTime` is
 * only set via the Companion app and is empty in real logs), and its numeric
 * `wipeCutoff` counts every raid member — buyers may die on purpose while the
 * boosters keep fighting. So the collapse is judged from the audited boosters
 * alone: matched, attended BOOSTER participants who took part in the pull
 * (never buyers, lootbuddies, unmatched actors or external boosters without a
 * Warcraft Logs identity — in neither numerator nor denominator).
 *
 * For a WIPE with at least `minPopulation` such boosters, the onset T0 is the
 * EARLIEST booster death with
 *   1. at least `clusterPlayers` different boosters dying in [T0, T0 + clusterWindowMs], and
 *   2. at least `collapseShare` of the pull's boosters dying in [T0, T0 + collapseWindowMs].
 * Every booster death at or after T0 is part of the raid wipe (also a
 * trailing survivor dying much later); every death before T0 stays an
 * active-pull death. Players are counted once (a battle-ressed booster dying
 * again does not count twice). Kills never have a collapse; too few boosters
 * or no qualifying cluster → none (deaths are judged normally).
 *
 * Production (report WV3BMCHnLvZfb9Yd, 14 boosters): Lost Explorers collapses
 * at +11.9 s (13 boosters dead within 16 s); Sszorak at +112.5 s (7 boosters
 * in 2.7 s) while the lone booster death at +26.6 s stays an active-pull death.
 */
export const WIPE_COLLAPSE_POLICY = {
  minPopulation: 5,
  clusterPlayers: 3,
  clusterWindowMs: 10_000,
  collapseShare: 0.5,
  collapseWindowMs: 20_000,
} as const;

export type DeathContext = "ACTIVE_PULL" | "WIPE_CASCADE";

/** Onset (fight-relative facts' atMs) of the boosting team's collapse in one pull, or null. */
export function wipeCollapseOnset(
  input: {
    kill: boolean;
    /** Ids of the boosters in the collapse population (took part in the pull). */
    population: ReadonlySet<string>;
    /** Deaths of population members (a battle-ressed booster may appear twice). */
    deaths: ReadonlyArray<{ atMs: number; playerId: string }>;
  },
  policy: typeof WIPE_COLLAPSE_POLICY = WIPE_COLLAPSE_POLICY,
): number | null {
  if (input.kill || input.population.size < policy.minPopulation) return null;
  const deaths = input.deaths.filter((death) => input.population.has(death.playerId)).sort((a, b) => a.atMs - b.atMs);
  const needed = Math.ceil(policy.collapseShare * input.population.size);
  const uniqueIn = (from: number, windowMs: number) =>
    new Set(deaths.filter((death) => death.atMs >= from && death.atMs <= from + windowMs).map((death) => death.playerId)).size;
  for (const death of deaths) {
    if (uniqueIn(death.atMs, policy.clusterWindowMs) < policy.clusterPlayers) continue;
    if (uniqueIn(death.atMs, policy.collapseWindowMs) < needed) continue;
    return death.atMs;
  }
  return null;
}

/**
 * Collapse onset per wipe of a snapshot, from its stored facts: the population
 * is every MATCHED audited booster (attendance, not external) with a
 * COMBATANT / PARTICIPANT fact in that pull; the deaths are their DEATH facts.
 * One snapshot holds one copy per real pull (#141), so one timeline per pull.
 */
export function wipeCollapseOnsets(
  players: readonly AuditPlayerFact[],
  fights: readonly AuditFightFact[],
): Map<string, number> {
  const onsets = new Map<string, number>();
  const boosters = players.filter((player) => player.matchStatus === "MATCHED" && !player.isExternal);
  for (const fight of fights) {
    if (fight.kill) continue;
    const population = new Set(
      boosters
        .filter((player) =>
          player.observations.some(
            (row) => row.fightId === fight.id && (row.kind === "COMBATANT" || row.kind === "PARTICIPANT"),
          ),
        )
        .map((player) => player.id),
    );
    const deaths = boosters.flatMap((player) =>
      player.observations
        .filter((row) => row.fightId === fight.id && row.kind === "DEATH")
        .map((row) => ({ atMs: row.atMs, playerId: player.id })),
    );
    const onset = wipeCollapseOnset({ kill: fight.kill, population, deaths });
    if (onset != null) onsets.set(fight.id, onset);
  }
  return onsets;
}

export function deathContextOf(onsetMs: number | undefined, atMs: number): DeathContext {
  return onsetMs != null && atMs >= onsetMs ? "WIPE_CASCADE" : "ACTIVE_PULL";
}
