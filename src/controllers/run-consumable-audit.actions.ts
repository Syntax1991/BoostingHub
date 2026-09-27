"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth/session";
import type { AuthenticatedUser } from "@/auth/authorization";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { runDetailPath } from "@/lib/run-routes";
import type { ConsumableAuditFailureCode } from "@/repositories/run-consumable-audit.repository";
import { runConsumableAuditService } from "@/services/run-consumable-audit.service";
import { runWarcraftLogsService, type ScanSummary } from "@/services/run-warcraft-logs.service";
import {
  attachRunWarcraftLogsReportSchema,
  decideRunWarcraftLogsFightSchema,
  detachRunWarcraftLogsReportSchema,
  runIdInputSchema,
} from "@/validators/run-consumable-audit";

/*
 * Warcraft Logs linking + Consumables Audit actions. Every action resolves the
 * session user and delegates to services that enforce ADMIN / the Run's
 * RAID_LEAD (canManageRun semantics) before any database read or WCL request.
 */

const FAILURE_MESSAGES: Record<ConsumableAuditFailureCode, string> = {
  NOT_CONFIGURED: "Warcraft Logs API is not configured on this server.",
  REPORT_NOT_FOUND: "That Warcraft Logs report was not found or is private.",
  NO_RELEVANT_FIGHTS: "No fights are assigned to this run yet — review the fight list.",
  WCL_UNAVAILABLE: "Warcraft Logs is temporarily unavailable. Try again later.",
};

function failure(code: ConsumableAuditFailureCode): ActionResult {
  return { ok: false, code: `CONSUMABLE_AUDIT_${code}`, message: FAILURE_MESSAGES[code] };
}

function describeScan(summary: ScanSummary): string {
  const parts = [`${summary.assigned} ${summary.assigned === 1 ? "fight" : "fights"} assigned`];
  if (summary.needsReview > 0) parts.push(`${summary.needsReview} need review`);
  return parts.join(", ");
}

/** After a scan, refresh the audit from the ASSIGNED fights (same action, no second cooldown). */
async function analyzeAfterScan(user: AuthenticatedUser, runId: string, summary: ScanSummary): Promise<ActionResult> {
  if (summary.assigned === 0) {
    return { ok: true, message: `${describeScan(summary)}. Nothing to analyze yet.` };
  }
  const result = await runConsumableAuditService.analyze(user, { runId }, undefined, { skipCooldown: true });
  if (result.status === "FAILED") return failure(result.failure);
  return { ok: true, message: `${describeScan(summary)}. Consumables analyzed.` };
}

export async function attachRunWarcraftLogsReportAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = attachRunWarcraftLogsReportSchema.parse(input);
    const result = await runWarcraftLogsService.attachReport(user, {
      runId: parsed.runId,
      reportCode: parsed.report,
    });
    revalidatePath(runDetailPath(parsed.runId));
    if (result.status === "FAILED") return failure(result.failure);
    return await analyzeAfterScan(user, parsed.runId, result.summary);
  } catch (error) {
    return mapActionError(error);
  }
}

export async function rescanRunWarcraftLogsAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = runIdInputSchema.parse(input);
    const result = await runWarcraftLogsService.rescan(user, { runId: parsed.runId });
    revalidatePath(runDetailPath(parsed.runId));
    if (result.status === "FAILED") return failure(result.failure);
    return await analyzeAfterScan(user, parsed.runId, result.summary);
  } catch (error) {
    return mapActionError(error);
  }
}

export async function detachRunWarcraftLogsReportAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = detachRunWarcraftLogsReportSchema.parse(input);
    await runWarcraftLogsService.detachReport(user, parsed);
    revalidatePath(runDetailPath(parsed.runId));
    return { ok: true, message: "Report detached from this run." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function decideRunWarcraftLogsFightAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = decideRunWarcraftLogsFightSchema.parse(input);
    await runWarcraftLogsService.decideFight(user, parsed);
    revalidatePath(runDetailPath(parsed.runId));
    return {
      ok: true,
      message: parsed.assign
        ? "Fight assigned to this run. Re-analyze to update the audit."
        : "Fight removed from this run. Re-analyze to update the audit.",
    };
  } catch (error) {
    return mapActionError(error);
  }
}

/** Re-analyze the Run's ASSIGNED fights (one WCL events request per linked report). */
export async function analyzeRunConsumablesAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = runIdInputSchema.parse(input);
    const result = await runConsumableAuditService.analyze(user, { runId: parsed.runId });
    revalidatePath(runDetailPath(parsed.runId));
    if (result.status === "FAILED") return failure(result.failure);
    return {
      ok: true,
      message: `Analyzed ${result.fights} ${result.fights === 1 ? "fight" : "fights"} for ${result.players} ${
        result.players === 1 ? "booster" : "boosters"
      }.`,
    };
  } catch (error) {
    return mapActionError(error);
  }
}
