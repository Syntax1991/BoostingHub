import type { AuthenticatedUser } from "@/auth/authorization";
import { canManageRun, hasAdminAccess } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import type { AttendanceStatus } from "@/models/enums";
import { attendanceRepository, type AttendanceRecord } from "@/repositories/attendance.repository";
import { activityRepository } from "@/repositories/activity.repository";
import {
  payoutRepository,
  type PayoutEntryRecord,
  type PayoutEntryWrite,
  type SettlementRecord,
} from "@/repositories/payout.repository";
import { runRepository } from "@/repositories/run.repository";
import { allocateGold } from "@/services/payout-calculation";
import {
  PAYOUT_ADJUSTMENT_REASON_MAX,
  assertShareUnits,
  assertTotalGold,
  defaultShareUnits,
  noteAdjustmentReason,
} from "@/services/payout-state";

function loadSnapshot(row: AttendanceRecord): PayoutEntryWrite {
  return {
    attendanceId: row.id,
    rosterEntryId: row.rosterEntryId,
    signupId: row.signupId,
    userId: row.userId,
    characterId: row.characterId,
    userDisplayName: row.userName,
    characterName: row.characterName,
    characterRealm: row.characterRealm,
    characterRegion: row.characterRegion,
    participationType: row.participationType,
    attendanceStatus: row.status,
    role: row.role,
    isBackup: row.isBackup,
    shareUnits: defaultShareUnits(row.status),
    amountGold: 0,
    adjustmentReason: null,
  };
}

function applyAmounts(totalGold: number, entries: Array<{ attendanceId: string; shareUnits: number }>) {
  const allocated = allocateGold(totalGold, entries);
  const byAttendance = new Map(allocated.map((row) => [row.attendanceId, row.amountGold]));
  return byAttendance;
}

function summaryFrom(settlement: SettlementRecord) {
  const totalShareUnits = settlement.entries.reduce((sum, row) => sum + row.shareUnits, 0);
  const recipientsWithShare = settlement.entries.filter((row) => row.shareUnits > 0).length;
  const zeroShare = settlement.entries.filter((row) => row.shareUnits === 0).length;
  const distributedGold = settlement.entries.reduce((sum, row) => sum + row.amountGold, 0);
  return {
    totalGold: settlement.totalGold,
    totalShareUnits,
    recipientsWithShare,
    zeroShareParticipants: zeroShare,
    distributedGold,
    remainder: settlement.totalGold - distributedGold,
  };
}

function toManagerEntry(row: PayoutEntryRecord) {
  return {
    id: row.id,
    attendanceId: row.attendanceId,
    userId: row.userId,
    userDisplayName: row.userDisplayName,
    characterName: row.characterName,
    characterRealm: row.characterRealm,
    characterRegion: row.characterRegion,
    participationType: row.participationType,
    attendanceStatus: row.attendanceStatus,
    role: row.role,
    isBackup: row.isBackup,
    shareUnits: row.shareUnits,
    amountGold: row.amountGold,
    adjustmentReason: row.adjustmentReason,
  };
}

function toOwnEntry(row: PayoutEntryRecord, status: SettlementRecord["status"]) {
  return {
    characterName: row.characterName,
    characterRealm: row.characterRealm,
    participationType: row.participationType,
    attendanceStatus: row.attendanceStatus,
    role: row.role,
    isBackup: row.isBackup,
    shareUnits: row.shareUnits,
    amountGold: row.amountGold,
    settlementStatus: status,
  };
}

async function loadManagedCompletedRun(user: AuthenticatedUser, runId: string) {
  const run = await runRepository.findById(runId);
  if (!run) {
    throw new DomainError("NOT_FOUND", "Run was not found.", 404);
  }
  if (!canManageRun(user, run)) {
    throw new DomainError("PAYOUT_NOT_MANAGEABLE", "You cannot manage payouts for this run.", 403);
  }
  if (run.status !== "COMPLETED") {
    throw new DomainError("PAYOUT_RUN_NOT_COMPLETED", "Payouts can only be prepared for a completed run.");
  }
  return run;
}

async function loadManagedSettlement(user: AuthenticatedUser, settlementId: string) {
  const settlement = await payoutRepository.findById(settlementId);
  if (!settlement) {
    throw new DomainError("PAYOUT_NOT_FOUND", "Settlement was not found.", 404);
  }
  const run = await runRepository.findById(settlement.runId);
  if (!run) {
    throw new DomainError("NOT_FOUND", "Run was not found.", 404);
  }
  if (!canManageRun(user, run)) {
    throw new DomainError("PAYOUT_NOT_MANAGEABLE", "You cannot manage payouts for this run.", 403);
  }
  return { settlement, run };
}

function assertDraft(settlement: SettlementRecord) {
  if (settlement.status === "PAID") {
    throw new DomainError("PAYOUT_ALREADY_PAID", "A paid settlement cannot be changed.");
  }
  if (settlement.status !== "DRAFT") {
    throw new DomainError("PAYOUT_FINALIZED", "A finalized settlement cannot be changed.");
  }
}

function assertAttendanceComplete(rows: AttendanceRecord[]) {
  if (rows.length === 0) {
    throw new DomainError("PAYOUT_ATTENDANCE_INVALID", "This run has no attendance records.");
  }
  if (rows.some((row) => row.status === "UNMARKED")) {
    throw new DomainError(
      "PAYOUT_ATTENDANCE_INVALID",
      "A completed run cannot have unmarked attendance.",
    );
  }
}

function assertEntriesMatchAttendance(settlement: SettlementRecord, attendance: AttendanceRecord[]) {
  const settlementIds = new Set(settlement.entries.map((row) => row.attendanceId));
  const attendanceIds = new Set(attendance.map((row) => row.id));
  if (settlementIds.size !== attendanceIds.size) {
    throw new DomainError(
      "PAYOUT_ATTENDANCE_INVALID",
      "Settlement entries no longer match completed attendance.",
    );
  }
  for (const id of attendanceIds) {
    if (!settlementIds.has(id)) {
      throw new DomainError(
        "PAYOUT_ATTENDANCE_INVALID",
        "Settlement entries no longer match completed attendance.",
      );
    }
  }
}

function emptyCapabilities() {
  return {
    canPrepare: false,
    canEditDraft: false,
    canFinalize: false,
    canMarkPaid: false,
  };
}

/**
 * Completed-run gold settlement. Run completion stays in RunService.
 */
export const payoutService = {
  async getPayoutView(user: AuthenticatedUser, runId: string) {
    const run = await runRepository.findById(runId);
    if (!run) {
      throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    }
    const manage = canManageRun(user, run);
    const settlement = await payoutRepository.findByRunId(runId);
    const published = settlement && (settlement.status === "FINALIZED" || settlement.status === "PAID");
    const own =
      published && !manage
        ? settlement.entries.filter((row) => row.userId === user.id).map((row) => toOwnEntry(row, settlement.status))
        : [];

    if (!manage) {
      return {
        runStatus: run.status,
        available: Boolean(published),
        own,
        manager: null,
        capabilities: emptyCapabilities(),
      };
    }

    return {
      runStatus: run.status,
      available: Boolean(settlement),
      own: [],
      manager: settlement
        ? {
            id: settlement.id,
            status: settlement.status,
            totalGold: settlement.totalGold,
            runTitle: settlement.runTitle,
            raidName: settlement.raidName,
            difficulty: settlement.difficulty,
            raidLeadName: settlement.raidLeadName,
            finalizedAt: settlement.finalizedAt,
            paidAt: settlement.paidAt,
            summary: summaryFrom(settlement),
            entries: settlement.entries
              .slice()
              .sort((a, b) => (a.attendanceId < b.attendanceId ? -1 : 1))
              .map(toManagerEntry),
          }
        : null,
      capabilities: {
        canPrepare: run.status === "COMPLETED" && !settlement,
        canEditDraft: Boolean(settlement && settlement.status === "DRAFT"),
        canFinalize: Boolean(settlement && settlement.status === "DRAFT"),
        canMarkPaid: Boolean(settlement && settlement.status === "FINALIZED" && hasAdminAccess(user.accountRole)),
      },
    };
  },

  async prepareSettlement(user: AuthenticatedUser, runId: string, totalGold: number) {
    const gold = assertTotalGold(totalGold);
    const run = await loadManagedCompletedRun(user, runId);
    const existing = await payoutRepository.findByRunId(run.id);
    if (existing) {
      throw new DomainError("PAYOUT_ALREADY_EXISTS", "This run already has a settlement.");
    }
    const attendance = await attendanceRepository.listByRunId(run.id);
    assertAttendanceComplete(attendance);

    const drafts = attendance
      .slice()
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map(loadSnapshot);
    const amounts = applyAmounts(
      gold,
      drafts.map((row) => ({ attendanceId: row.attendanceId, shareUnits: row.shareUnits })),
    );
    const entries = drafts.map((row) => ({
      ...row,
      amountGold: amounts.get(row.attendanceId) ?? 0,
    }));

    const created = await payoutRepository.createDraft({
      runId: run.id,
      totalGold: gold,
      preparedById: user.id,
      runTitle: run.title,
      raidName: run.raidName,
      difficulty: run.difficulty,
      raidLeadName: run.raidLeadName,
      entries,
    });
    await activityRepository.create({
      userId: user.id,
      type: "PAYOUT_PREPARED",
      message: "Prepared a run payout.",
    });
    return { id: created.id, runId: run.id };
  },

  async updateDraftTotal(user: AuthenticatedUser, settlementId: string, totalGold: number) {
    const gold = assertTotalGold(totalGold);
    const { settlement } = await loadManagedSettlement(user, settlementId);
    assertDraft(settlement);
    await persistRecalculation(settlement, gold, settlement.entries);
    return { runId: settlement.runId };
  },

  async updateShareUnits(
    user: AuthenticatedUser,
    input: { payoutEntryId: string; shareUnits: number; adjustmentReason?: string | null },
  ) {
    const shareUnits = assertShareUnits(input.shareUnits);
    const entry = await payoutRepository.findEntryById(input.payoutEntryId);
    if (!entry) {
      throw new DomainError("PAYOUT_NOT_FOUND", "Payout entry was not found.", 404);
    }
    const { settlement } = await loadManagedSettlement(user, entry.settlementId);
    assertDraft(settlement);
    if (input.adjustmentReason !== undefined && (input.adjustmentReason?.trim().length ?? 0) > PAYOUT_ADJUSTMENT_REASON_MAX) {
      throw new DomainError(
        "VALIDATION_FAILED",
        `Adjustment reasons must be ${PAYOUT_ADJUSTMENT_REASON_MAX} characters or fewer.`,
      );
    }
    const reason =
      input.adjustmentReason === undefined
        ? entry.adjustmentReason
        : noteAdjustmentReason(input.adjustmentReason);
    const nextEntries = settlement.entries.map((row) =>
      row.id === entry.id ? { ...row, shareUnits, adjustmentReason: reason } : row,
    );
    await persistRecalculation(settlement, settlement.totalGold, nextEntries);
    return { runId: settlement.runId };
  },

  async finalizeSettlement(user: AuthenticatedUser, settlementId: string) {
    const { settlement, run } = await loadManagedSettlement(user, settlementId);
    assertDraft(settlement);
    if (run.status !== "COMPLETED") {
      throw new DomainError("PAYOUT_RUN_NOT_COMPLETED", "Payouts can only be finalized for a completed run.");
    }
    const attendance = await attendanceRepository.listByRunId(run.id);
    assertAttendanceComplete(attendance);
    assertEntriesMatchAttendance(settlement, attendance);
    const gold = assertTotalGold(settlement.totalGold);
    const amounts = applyAmounts(
      gold,
      settlement.entries.map((row) => ({ attendanceId: row.attendanceId, shareUnits: row.shareUnits })),
    );
    const liveByAttendance = new Map(attendance.map((row) => [row.id, row]));
    const entries = settlement.entries.map((row) => {
      const live = liveByAttendance.get(row.attendanceId);
      if (!live) {
        throw new DomainError(
          "PAYOUT_ATTENDANCE_INVALID",
          "Settlement entries no longer match completed attendance.",
        );
      }
      return {
        id: row.id,
        shareUnits: row.shareUnits,
        amountGold: amounts.get(row.attendanceId) ?? 0,
        userDisplayName: live.userName,
        characterName: live.characterName,
        characterRealm: live.characterRealm,
        characterRegion: live.characterRegion,
        participationType: live.participationType,
        attendanceStatus: live.status as AttendanceStatus,
        role: live.role,
        isBackup: live.isBackup,
      };
    });
    const distributed = entries.reduce((sum, row) => sum + row.amountGold, 0);
    if (distributed !== gold) {
      throw new DomainError("PAYOUT_INVALID_TOTAL", "Calculated gold does not equal the settlement total.");
    }
    await payoutRepository.finalize({
      settlementId: settlement.id,
      finalizedById: user.id,
      totalGold: gold,
      runTitle: run.title,
      raidName: run.raidName,
      difficulty: run.difficulty,
      raidLeadName: run.raidLeadName,
      entries,
    });
    await activityRepository.create({
      userId: user.id,
      type: "PAYOUT_FINALIZED",
      message: "Finalized a run payout.",
    });
    return { runId: settlement.runId };
  },

  async markPaid(user: AuthenticatedUser, settlementId: string) {
    if (!hasAdminAccess(user.accountRole)) {
      throw new DomainError("PAYOUT_ADMIN_REQUIRED", "Only an admin can mark a settlement paid.", 403);
    }
    const { settlement, run } = await loadManagedSettlement(user, settlementId);
    if (settlement.status === "PAID") {
      throw new DomainError("PAYOUT_ALREADY_PAID", "This settlement is already marked paid.");
    }
    if (settlement.status !== "FINALIZED") {
      throw new DomainError("PAYOUT_NOT_DRAFT", "Finalize the settlement before marking it paid.");
    }
    if (run.status !== "COMPLETED") {
      throw new DomainError("PAYOUT_RUN_NOT_COMPLETED", "Payouts can only be marked paid for a completed run.");
    }
    await payoutRepository.markPaid(settlement.id, user.id);
    await activityRepository.create({
      userId: user.id,
      type: "PAYOUT_PAID",
      message: "Marked a run payout as paid.",
    });
    return { runId: settlement.runId };
  },
};

async function persistRecalculation(
  settlement: SettlementRecord,
  totalGold: number,
  entries: PayoutEntryRecord[],
) {
  const amounts = applyAmounts(
    totalGold,
    entries.map((row) => ({ attendanceId: row.attendanceId, shareUnits: row.shareUnits })),
  );
  await payoutRepository.replaceDraftAmounts({
    settlementId: settlement.id,
    totalGold,
    entries: entries.map((row) => ({
      id: row.id,
      shareUnits: row.shareUnits,
      amountGold: amounts.get(row.attendanceId) ?? 0,
      adjustmentReason: row.adjustmentReason,
    })),
  });
}

export type PayoutView = Awaited<ReturnType<typeof payoutService.getPayoutView>>;
