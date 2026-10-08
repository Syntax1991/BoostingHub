import { isDomainError, RosterWarningConfirmationRequiredError } from "@/lib/errors";
import type { PendingRosterSelectionWarning } from "@/services/roster-selection-risk";
import { ZodError } from "zod";

export type ActionResult =
  | { ok: true; message: string; runId?: string }
  | ActionFailure;

export type ActionFailure = {
  ok: false;
  code: string;
  message: string;
  /**
   * Present only with code ROSTER_WARNING_CONFIRMATION_REQUIRED: the current
   * warnings the Raid Lead must confirm before the same request can succeed.
   */
  pendingWarnings?: PendingRosterSelectionWarning[];
};

export function mapActionError(error: unknown): ActionFailure {
  if (error instanceof ZodError) {
    return { ok: false, code: "VALIDATION_FAILED", message: error.issues[0]?.message ?? "Check the form and try again." };
  }
  if (error instanceof RosterWarningConfirmationRequiredError) {
    return { ok: false, code: error.code, message: error.message, pendingWarnings: error.pendingWarnings };
  }
  if (isDomainError(error)) {
    return { ok: false, code: error.code, message: error.message };
  }
  return { ok: false, code: "UNEXPECTED", message: "Something went wrong. Try again." };
}
