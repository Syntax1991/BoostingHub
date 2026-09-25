import type { RunStatus } from "@/models/enums";

/**
 * Which roster actions the Roster tab offers. Pure so the matrix is testable.
 *
 * - Never published: Save Roster while there are local edits, then Publish
 *   Roster (the first authoritative publication + first Discord post).
 * - Published with local edits, saved draft changes or changed Run settings:
 *   Update Roster — ONE action that accepts the current selection and edits
 *   the current Discord roster message. No Save step, no Publish.
 * - Published and clean: Publish Roster as a deliberate repost (a NEW Discord
 *   message). Save / Update are not needed.
 */
export type RosterActions = {
  save: boolean;
  update: boolean;
  /** First publication of a never-published roster. */
  publish: boolean;
  /** Explicit repost of a clean published roster. */
  repost: boolean;
  discard: boolean;
  /** Legacy published roster whose draft was never seeded (checkbox editing needs a seed). */
  seed: boolean;
};

export function resolveRosterActions(input: {
  canEdit: boolean;
  runStatus: RunStatus;
  isPublished: boolean;
  /** Unsaved checkbox/role edits in this browser. */
  hasLocalEdits: boolean;
  /** Server-side: saved draft or Run settings differ from the accepted roster. */
  hasUnpublishedChanges: boolean;
  needsPublishSeed: boolean;
}): RosterActions {
  const none: RosterActions = { save: false, update: false, publish: false, repost: false, discard: false, seed: false };
  if (!input.canEdit) return none;
  if (input.needsPublishSeed) {
    // Nothing staged locally is possible yet; a clean legacy roster may still be reposted.
    return { ...none, seed: true, repost: input.runStatus === "PUBLISHED" && !input.hasUnpublishedChanges };
  }
  if (!input.isPublished) {
    return {
      ...none,
      save: input.hasLocalEdits,
      discard: input.hasLocalEdits,
      publish: !input.hasLocalEdits,
    };
  }
  const needsUpdate = input.hasLocalEdits || input.hasUnpublishedChanges;
  return {
    ...none,
    update: needsUpdate,
    discard: input.hasLocalEdits,
    repost: !needsUpdate && input.runStatus === "PUBLISHED",
  };
}
