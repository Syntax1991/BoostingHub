import type { CharacterRole, ParticipationType, RaidDifficulty, SignupStatus, WowClass } from "@/models/enums";
import type { UserRunSelectionState } from "@/services/user-run-participation";

/**
 * My Runs groups the signed-in User's participations by Run inside each
 * top-level status section (Selected / Pending / Not Selected / Withdrawn).
 * A Pending Run block may also carry the User's selected participation(s) on
 * that same Run as read-only context, so the pending offers read as
 * "alternatives" to an existing pick instead of unrelated rows.
 */
export type MyRunsOffer = {
  id: string;
  runId: string;
  runTitle: string;
  /** Compact raid title from the shared helper (`contentShortTitle`), e.g. "Venom & Tide & Kithix". */
  contentTitle: string;
  difficulty: RaidDifficulty;
  scheduledStartAt: string;
  status: SignupStatus;
  selectionState: UserRunSelectionState;
  displayRole: CharacterRole | null;
  offeredRoles: CharacterRole[];
  participationType: ParticipationType;
  characterName: string | null;
  characterRealm: string | null;
  lootbuddyClass: WowClass | null;
};

export type MyRunsRunGroup<T extends MyRunsOffer> = {
  runId: string;
  runTitle: string;
  contentTitle: string;
  difficulty: RaidDifficulty;
  scheduledStartAt: string;
  offers: T[];
  /** The User's selected (draft or published) participations on this Run; empty when none. */
  selectedContext: T[];
};

/** Draft or published pick — the same authority as the Selected section. */
export function isSelectedParticipation(offer: Pick<MyRunsOffer, "selectionState">): boolean {
  return offer.selectionState === "DRAFT" || offer.selectionState === "PUBLISHED";
}

/** Status line of a participation, e.g. `Selected · Draft`. */
export function myRunsSelectionPhrase(offer: Pick<MyRunsOffer, "selectionState">, statusLabel: string): string {
  if (offer.selectionState === "PUBLISHED") return "Selected · Confirmed";
  if (offer.selectionState === "DRAFT") return "Selected · Draft";
  return statusLabel;
}

/**
 * Groups `items` by Run in first-seen order. `selected` (the Selected
 * section's rows) supplies per-Run context; a row already listed in `items`
 * is never repeated as context, and context never crosses Runs.
 */
export function groupMyRunsByRun<T extends MyRunsOffer>(
  items: readonly T[],
  selected: readonly T[] = [],
): MyRunsRunGroup<T>[] {
  const listedIds = new Set(items.map((item) => item.id));
  const groups = new Map<string, MyRunsRunGroup<T>>();
  for (const item of items) {
    let group = groups.get(item.runId);
    if (!group) {
      group = {
        runId: item.runId,
        runTitle: item.runTitle,
        contentTitle: item.contentTitle,
        difficulty: item.difficulty,
        scheduledStartAt: item.scheduledStartAt,
        offers: [],
        selectedContext: [],
      };
      groups.set(item.runId, group);
    }
    group.offers.push(item);
  }
  for (const pick of selected) {
    const group = groups.get(pick.runId);
    if (!group || listedIds.has(pick.id) || !isSelectedParticipation(pick)) continue;
    group.selectedContext.push(pick);
  }
  return [...groups.values()];
}
