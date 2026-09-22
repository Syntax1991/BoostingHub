/**
 * Prefer the User's default Character in eligible signup lists without
 * auto-submitting and without inventing eligibility errors.
 */
export function preferDefaultCharacterId<T extends { characterId: string }>(
  eligible: T[],
  defaultCharacterId: string | null | undefined,
): { ordered: T[]; preferredCharacterId: string | null } {
  if (!defaultCharacterId) {
    return { ordered: eligible, preferredCharacterId: null };
  }
  const index = eligible.findIndex((item) => item.characterId === defaultCharacterId);
  if (index < 0) {
    return { ordered: eligible, preferredCharacterId: null };
  }
  if (index === 0) {
    return { ordered: eligible, preferredCharacterId: defaultCharacterId };
  }
  const preferred = eligible[index]!;
  const ordered = [preferred, ...eligible.filter((item) => item.characterId !== defaultCharacterId)];
  return { ordered, preferredCharacterId: defaultCharacterId };
}
