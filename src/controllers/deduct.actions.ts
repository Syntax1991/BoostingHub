"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { payoutRepository } from "@/repositories/payout.repository";
import { payoutDeductService } from "@/services/payout-deduct.service";
import { addDeductSchema, revokeDeductSchema } from "@/validators/deduct";

async function revalidateForPayoutEntry(payoutEntryId: string) {
  const entry = await payoutRepository.findEntryById(payoutEntryId);
  revalidatePath("/runs");
  if (entry) {
    const settlement = await payoutRepository.findById(entry.settlementId);
    if (settlement) {
      revalidatePath(`/runs/${settlement.runId}`);
    }
  }
}

export async function addDeductAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = addDeductSchema.parse(input);
    const created = await payoutDeductService.create(user, parsed);
    await revalidateForPayoutEntry(created.payoutEntryId);
    return { ok: true, message: "Deduct added." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function revokeDeductAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = revokeDeductSchema.parse(input);
    const updated = await payoutDeductService.revoke(user, parsed.deductId, parsed.revokedReason);
    await revalidateForPayoutEntry(updated.payoutEntryId);
    return { ok: true, message: "Deduct revoked." };
  } catch (error) {
    return mapActionError(error);
  }
}
