import type { CharacterRole, ParticipationType, SignupStatus } from "@/models/enums";

export type PublishStateSignup = {
  id: string;
  status: SignupStatus;
  participationType: ParticipationType;
  publishedRole: CharacterRole | null;
};

export type PublishStateDraftSelection = {
  signupId: string;
  selectedRole: CharacterRole | null;
};

/**
 * True when the saved roster draft (RunRosterEntry + selectedRole) no longer
 * matches the live published roster (SELECTED signups + publishedRole). This
 * is what "Unpublished changes" means in the roster UI and what blocks Start
 * Run: Start snapshots the published roster, so a saved replacement that was
 * never re-published would silently be left out.
 *
 * - Nothing published yet → false (there is no published roster to differ from).
 * - Version 1 with an empty draft while a published selection exists → false:
 *   the draft was simply never seeded (see needsPublishSeed), not changed.
 * - Draft rows of WITHDRAWN signups are ignored, exactly as Publish ignores them.
 * - LOOTBUDDY slots carry no role on either side.
 * - A published BOOSTER slot without publishedRole (predates assigned roles)
 *   matches any draft role for that signup — there is nothing to compare.
 */
export function hasUnpublishedRosterChanges(input: {
  publishedAt: string | null;
  version: number;
  draft: readonly PublishStateDraftSelection[];
  signups: readonly PublishStateSignup[];
}): boolean {
  if (!input.publishedAt) return false;

  const signupsById = new Map(input.signups.map((signup) => [signup.id, signup]));
  const draft = new Map<string, CharacterRole | null>();
  for (const selection of input.draft) {
    const signup = signupsById.get(selection.signupId);
    if (!signup || signup.status === "WITHDRAWN") continue;
    draft.set(signup.id, signup.participationType === "BOOSTER" ? selection.selectedRole : null);
  }
  const published = new Map<string, CharacterRole | null>();
  for (const signup of input.signups) {
    if (signup.status !== "SELECTED") continue;
    published.set(signup.id, signup.participationType === "BOOSTER" ? signup.publishedRole : null);
  }

  if (draft.size === 0 && published.size > 0 && input.version === 1) return false;
  if (draft.size !== published.size) return true;
  for (const [signupId, publishedRole] of published) {
    if (!draft.has(signupId)) return true;
    const signup = signupsById.get(signupId);
    if (signup?.participationType === "BOOSTER" && publishedRole !== null && draft.get(signupId) !== publishedRole) {
      return true;
    }
  }
  return false;
}
