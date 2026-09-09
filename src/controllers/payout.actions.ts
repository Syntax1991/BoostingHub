"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { payoutService } from "@/services/payout.service";
import {
  finalizeRunPayoutSchema,
  markRunPayoutPaidSchema,
  prepareRunPayoutSchema,
  updateRunPayoutShareSchema,
  updateRunPayoutTotalSchema,
} from "@/validators/payout";

function revalidatePayout(runId: string) {
  revalidatePath("/runs");
  revalidatePath("/my-runs");
  revalidatePath("/manage/runs");
  revalidatePath("/dashboard");
  revalidatePath(`/runs/${runId}`);
}

export async function prepareRunPayoutAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = prepareRunPayoutSchema.parse(input);
    const created = await payoutService.prepareSettlement(user, parsed.runId, parsed.totalGold);
    revalidatePayout(created.runId);
    return { ok: true, message: "Payout draft prepared.", runId: created.runId };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function updateRunPayoutTotalAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = updateRunPayoutTotalSchema.parse(input);
    const updated = await payoutService.updateDraftTotal(user, parsed.settlementId, parsed.totalGold);
    revalidatePayout(updated.runId);
    return { ok: true, message: "Payout total updated." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function updateRunPayoutShareAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = updateRunPayoutShareSchema.parse(input);
    const updated = await payoutService.updateShareUnits(user, parsed);
    revalidatePayout(updated.runId);
    return { ok: true, message: "Share units updated." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function finalizeRunPayoutAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = finalizeRunPayoutSchema.parse(input);
    const updated = await payoutService.finalizeSettlement(user, parsed.settlementId);
    revalidatePayout(updated.runId);
    return { ok: true, message: "Payout finalized. The split is now immutable." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function markRunPayoutPaidAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = markRunPayoutPaidSchema.parse(input);
    const updated = await payoutService.markPaid(user, parsed.settlementId);
    revalidatePayout(updated.runId);
    return { ok: true, message: "Settlement marked paid. No gold was transferred." };
  } catch (error) {
    return mapActionError(error);
  }
}
