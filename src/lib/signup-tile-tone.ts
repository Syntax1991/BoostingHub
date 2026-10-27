/**
 * Background / border tone of a Signup tile in the Roster Builder.
 *
 * - drafted → success (the pick wins over every hint)
 * - schedule conflict or planned on another Run → warning
 * - saved (any verified boss kill on this Run's content) → the same warning
 *   tint, so a saved Character is visible at a glance without reading HC X/10
 */
export type SignupTileTone = "selected" | "warning" | "saved" | "default";

export function signupTileTone(input: { selected: boolean; warning: boolean; saved: boolean }): SignupTileTone {
  if (input.selected) return "selected";
  if (input.warning) return "warning";
  if (input.saved) return "saved";
  return "default";
}

export const SIGNUP_TILE_TONE_CLASSES: Record<SignupTileTone, string> = {
  selected: "border-success/70 bg-success/15 ring-1 ring-success/30",
  warning: "border-warning/45 bg-warning/5 hover:border-warning/65",
  saved: "border-warning/45 bg-warning/5 hover:border-warning/65",
  default: "border-border bg-surface hover:bg-surface-raised/50",
};
