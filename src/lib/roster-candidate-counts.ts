/**
 * Unique signup counting for roster candidates.
 * Role projections may repeat a signup id; global Booster totals must not.
 */

export function uniqueSignupCount(signups: Iterable<{ id: string }>): number {
  const seen = new Set<string>();
  for (const signup of signups) seen.add(signup.id);
  return seen.size;
}

export function projectedBoosterCardCount(groups: {
  tanks: readonly unknown[];
  healers: readonly unknown[];
  dps: readonly unknown[];
}): number {
  return groups.tanks.length + groups.healers.length + groups.dps.length;
}
