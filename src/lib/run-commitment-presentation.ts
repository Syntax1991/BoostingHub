/**
 * Presentation-only mapping for CharacterRunCommitment.state.
 * Domain values RESERVED / COMMITTED stay unchanged; this never gates selection.
 */
export type RunCommitmentTone = "danger" | "warning";

export type RunCommitmentPresentation = {
  /** Compact state chip label shown to Raid Leads. */
  label: "Draft roster" | "Published roster";
  tone: RunCommitmentTone;
  /** Optional hover explanation — never required to understand the UI. */
  tooltip: string;
  /** Chip classes using theme semantic tokens (no hardcoded hex). */
  chipClassName: string;
};

const PRESENTATION: Record<"RESERVED" | "COMMITTED", RunCommitmentPresentation> = {
  RESERVED: {
    label: "Draft roster",
    tone: "danger",
    tooltip: "Selected in the draft roster of another Run.",
    chipClassName: "rounded-md border border-danger/40 bg-danger/10 px-1.5 py-0.5 font-medium text-danger",
  },
  COMMITTED: {
    label: "Published roster",
    tone: "warning",
    tooltip: "Selected in the published roster of another Run.",
    chipClassName: "rounded-md border border-warning/40 bg-warning/10 px-1.5 py-0.5 font-medium text-warning",
  },
};

export function getRunCommitmentPresentation(
  state: "RESERVED" | "COMMITTED",
): RunCommitmentPresentation {
  return PRESENTATION[state];
}

/** Strong blocking alert chrome for real schedule conflicts (stronger than Draft roster chips). */
export const SCHEDULE_CONFLICT_ALERT_CLASSNAME =
  "rounded-md border border-danger/50 bg-danger/15 px-2 py-1.5 text-danger";
