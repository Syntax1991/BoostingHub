import type { AuthenticatedUser } from "@/auth/authorization";
import { canManageRun } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { activityRepository } from "@/repositories/activity.repository";
import { payoutRepository, type SettlementRecord } from "@/repositories/payout.repository";
import { runRepository } from "@/repositories/run.repository";
import { strikeRepository } from "@/repositories/strike.repository";
import { deductRepository, type DeductRecord } from "@/repositories/deduct.repository";
import {
  DEDUCT_NOTES_MAX,
  DEDUCT_REASON_MAX,
  DEDUCT_REVOKE_REASON_MAX,
  assertDeductAmount,
} from "@/services/deduct-state";

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function assertReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new DomainError("VALIDATION_FAILED", "A deduct reason is required.");
  }
  if (trimmed.length > DEDUCT_REASON_MAX) {
    throw new DomainError("VALIDATION_FAILED", `Deduct reasons must be ${DEDUCT_REASON_MAX} characters or fewer.`);
  }
  return trimmed;
}

function assertNotes(notes: string | null | undefined): string | null {
  const value = trimmedOrNull(notes);
  if (value && value.length > DEDUCT_NOTES_MAX) {
    throw new DomainError("VALIDATION_FAILED", `Deduct notes must be ${DEDUCT_NOTES_MAX} characters or fewer.`);
  }
  return value;
}

function assertRevokedReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new DomainError("VALIDATION_FAILED", "A reason is required to revoke a deduct.");
  }
  if (trimmed.length > DEDUCT_REVOKE_REASON_MAX) {
    throw new DomainError(
      "VALIDATION_FAILED",
      `Revoke reasons must be ${DEDUCT_REVOKE_REASON_MAX} characters or fewer.`,
    );
  }
  return trimmed;
}

async function loadManageableEntryContext(actor: AuthenticatedUser, payoutEntryId: string) {
  const entry = await payoutRepository.findEntryById(payoutEntryId);
  if (!entry) {
    throw new DomainError("PAYOUT_NOT_FOUND", "Payout entry was not found.", 404);
  }
  const settlement = await payoutRepository.findById(entry.settlementId);
  if (!settlement) {
    throw new DomainError("PAYOUT_NOT_FOUND", "Settlement was not found.", 404);
  }
  const run = await runRepository.findById(settlement.runId);
  if (!run) {
    throw new DomainError("NOT_FOUND", "Run was not found.", 404);
  }
  if (!canManageRun(actor, run)) {
    throw new DomainError("DEDUCT_NOT_MANAGEABLE", "You cannot manage deducts for this run.", 403);
  }
  return { entry, settlement, run };
}

function assertSettlementDraft(settlement: SettlementRecord) {
  if (settlement.status !== "DRAFT") {
    throw new DomainError(
      "DEDUCT_SETTLEMENT_LOCKED",
      "Deducts can only be changed while the settlement is a draft.",
    );
  }
}

/**
 * Financial reduction against one RunPayoutEntry's gross amountGold.
 * Independent of Strike — never bloats payout.service.ts, which stays
 * authoritative for settlement lifecycle and the gross allocation itself.
 */
export const payoutDeductService = {
  async create(
    actor: AuthenticatedUser,
    input: {
      payoutEntryId: string;
      amountGold: number;
      reason: string;
      notes?: string | null;
      strikeId?: string | null;
    },
  ): Promise<DeductRecord> {
    const amountGold = assertDeductAmount(input.amountGold);
    const { entry, settlement } = await loadManageableEntryContext(actor, input.payoutEntryId);
    assertSettlementDraft(settlement);

    const existing = await deductRepository.listByPayoutEntryIds([entry.id]);
    const activeTotal = existing
      .filter((row) => row.status === "ACTIVE")
      .reduce((sum, row) => sum + row.amountGold, 0);
    if (activeTotal + amountGold > entry.amountGold) {
      throw new DomainError(
        "DEDUCT_EXCEEDS_GROSS",
        `This would deduct more than the ${entry.amountGold.toLocaleString("en-US")}g gross payout for this entry.`,
      );
    }

    let strikeId: string | null = null;
    if (input.strikeId) {
      const strike = await strikeRepository.findById(input.strikeId);
      if (!strike) {
        throw new DomainError("DEDUCT_INVALID_STRIKE_LINK", "Linked strike was not found.", 404);
      }
      if (strike.userId !== entry.userId) {
        throw new DomainError("DEDUCT_INVALID_STRIKE_LINK", "That strike belongs to a different user.");
      }
      if (strike.runId && strike.runId !== settlement.runId) {
        throw new DomainError("DEDUCT_INVALID_STRIKE_LINK", "That strike is linked to a different run.");
      }
      strikeId = strike.id;
    }

    const reason = assertReason(input.reason);
    const notes = assertNotes(input.notes);

    const created = await deductRepository.create({
      id: crypto.randomUUID(),
      payoutEntryId: entry.id,
      amountGold,
      reason,
      notes,
      strikeId,
      createdById: actor.id,
    });

    await activityRepository.create({
      userId: actor.id,
      type: "DEDUCT_ADDED",
      message: `Added a ${amountGold.toLocaleString("en-US")}g deduct to ${entry.userDisplayName} for ${settlement.runTitle}. targetUserId=${entry.userId} deductId=${created.id}`,
    });

    return created;
  },

  /** Revoke is only permitted while the owning settlement is still DRAFT — mirrors Deduct mutability generally. */
  async revoke(actor: AuthenticatedUser, deductId: string, revokedReason: string): Promise<DeductRecord> {
    const deduct = await deductRepository.findById(deductId);
    if (!deduct) {
      throw new DomainError("DEDUCT_NOT_FOUND", "Deduct was not found.", 404);
    }
    const { entry, settlement } = await loadManageableEntryContext(actor, deduct.payoutEntryId);
    assertSettlementDraft(settlement);
    if (deduct.status === "REVOKED") {
      throw new DomainError("DEDUCT_ALREADY_REVOKED", "This deduct is already revoked.");
    }
    const reason = assertRevokedReason(revokedReason);
    await deductRepository.revoke(deduct.id, {
      revokedAt: new Date().toISOString(),
      revokedById: actor.id,
      revokedReason: reason,
    });
    const updated = await deductRepository.findById(deductId);
    if (!updated) {
      throw new DomainError("DEDUCT_NOT_FOUND", "Deduct was not found.", 404);
    }
    await activityRepository.create({
      userId: actor.id,
      type: "DEDUCT_REVOKED",
      message: `Revoked a deduct for ${entry.userDisplayName} on ${settlement.runTitle}. targetUserId=${entry.userId} deductId=${deduct.id}`,
    });
    return updated;
  },

  /** Manager view: every deduct (active and revoked) across a settlement's payout entries, batched. */
  async listBySettlement(actor: AuthenticatedUser, settlementId: string) {
    const settlement = await payoutRepository.findById(settlementId);
    if (!settlement) {
      throw new DomainError("PAYOUT_NOT_FOUND", "Settlement was not found.", 404);
    }
    const run = await runRepository.findById(settlement.runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }
    if (!canManageRun(actor, run)) {
      throw new DomainError("DEDUCT_NOT_MANAGEABLE", "You cannot view deducts for this run.", 403);
    }
    const entryIds = settlement.entries.map((entry) => entry.id);
    return deductRepository.listByPayoutEntryIds(entryIds);
  },
};
