"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/auth/session";
import { mapActionError } from "@/lib/action-result";
import { characterOperationsService } from "@/services/character-operations.service";
import { runConsumableAutoAuditService } from "@/services/run-consumable-auto-audit.service";
import { integrationEventService } from "@/services/integration-event.service";

function revalidateSystem() {
  revalidatePath("/manage/system");
  revalidatePath("/manage/characters");
}

async function recordAdminAction(input: {
  operation: string;
  status: "SUCCESS" | "WARNING" | "ERROR";
  errorCode?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  try {
    await integrationEventService.record({
      provider: "SYSTEM",
      operation: input.operation,
      status: input.status,
      errorCode: input.errorCode ?? null,
      metadata: input.metadata ?? null,
    });
  } catch {
    // Telemetry must not fail the admin action.
  }
}

/**
 * ADMIN / OWNER: Force refresh every eligible Character.
 * Uses existing characterOperationsService.forceRefreshAll cooldowns/locks.
 */
export async function adminSystemForceRefreshAllAction(): Promise<
  | { ok: true; message: string }
  | { ok: false; code: string; message: string }
> {
  try {
    const admin = await requireAdmin();
    const result = await characterOperationsService.forceRefreshAll(admin);
    await recordAdminAction({
      operation: "ADMIN_FORCE_REFRESH_ALL",
      status: result.failed > 0 ? "WARNING" : "SUCCESS",
      metadata: {
        processed: result.eligible,
        succeeded: result.succeeded,
        failed: result.failed,
        skipped: result.skipped,
      },
    });
    revalidateSystem();
    return {
      ok: true,
      message: `Force refresh all: ${result.succeeded} succeeded, ${result.failed} failed, ${result.skipped} skipped (${result.eligible} eligible).`,
    };
  } catch (error) {
    await recordAdminAction({
      operation: "ADMIN_FORCE_REFRESH_ALL",
      status: "ERROR",
      errorCode: error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "ADMIN_ACTION_FAILED",
    });
    return mapActionError(error);
  }
}

/**
 * ADMIN / OWNER: Run one consumable auto-audit due pass (existing domain job).
 */
export async function adminSystemWclAutoAuditPassAction(): Promise<
  | { ok: true; message: string }
  | { ok: false; code: string; message: string }
> {
  try {
    await requireAdmin();
    const result = await runConsumableAutoAuditService.runDuePass();
    if (result.status === "SKIPPED_ALREADY_RUNNING") {
      await recordAdminAction({
        operation: "ADMIN_WCL_AUTO_AUDIT_PASS",
        status: "WARNING",
        errorCode: "ALREADY_RUNNING",
        metadata: { reason: "ALREADY_RUNNING" },
      });
      revalidateSystem();
      return { ok: true, message: "WCL auto-audit pass skipped: another pass is already running." };
    }
    const succeeded = result.runs.filter((row) => row.status === "ANALYZED").length;
    const failed = result.runs.length - succeeded;
    await recordAdminAction({
      operation: "ADMIN_WCL_AUTO_AUDIT_PASS",
      status: failed > 0 ? "WARNING" : "SUCCESS",
      metadata: {
        processed: result.runs.length,
        succeeded,
        failed,
        totalCandidates: result.due,
      },
    });
    revalidateSystem();
    return {
      ok: true,
      message: `WCL auto-audit: ${result.runs.length} run(s) processed (${succeeded} analyzed, ${failed} not), ${result.due} due.`,
    };
  } catch (error) {
    await recordAdminAction({
      operation: "ADMIN_WCL_AUTO_AUDIT_PASS",
      status: "ERROR",
      errorCode: error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "ADMIN_ACTION_FAILED",
    });
    return mapActionError(error);
  }
}
