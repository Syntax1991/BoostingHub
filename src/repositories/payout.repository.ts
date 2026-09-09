import { db, orm } from "@/lib/prisma";
import { DomainError } from "@/lib/errors";
import {
  asBoolean,
  asNumber,
  asString,
  asStringOrNull,
  mapAttendanceStatus,
  mapCharacterRole,
  mapDifficulty,
  mapParticipation,
  mapRegion,
  mapSettlementStatus,
} from "@/lib/persistence";
import type {
  AttendanceStatus,
  CharacterRole,
  ParticipationType,
  RaidDifficulty,
  SettlementStatus,
  WowRegion,
} from "@/models/enums";

export type PayoutEntryRecord = {
  id: string;
  settlementId: string;
  attendanceId: string;
  rosterEntryId: string;
  signupId: string;
  userId: string;
  characterId: string | null;
  userDisplayName: string;
  characterName: string;
  characterRealm: string;
  characterRegion: WowRegion | null;
  participationType: ParticipationType;
  attendanceStatus: AttendanceStatus;
  role: CharacterRole | null;
  isBackup: boolean;
  shareUnits: number;
  amountGold: number;
  adjustmentReason: string | null;
};

export type SettlementRecord = {
  id: string;
  runId: string;
  totalGold: number;
  status: SettlementStatus;
  preparedById: string;
  finalizedAt: string | null;
  finalizedById: string | null;
  paidAt: string | null;
  paidById: string | null;
  runTitle: string;
  raidName: string;
  difficulty: RaidDifficulty;
  raidLeadName: string;
  createdAt: string;
  updatedAt: string;
  entries: PayoutEntryRecord[];
};

export type PayoutEntryWrite = Omit<PayoutEntryRecord, "id" | "settlementId">;

type TxOrm = typeof orm;

function mapEntry(row: Record<string, unknown>): PayoutEntryRecord {
  return {
    id: asString(row.id),
    settlementId: asString(row.settlementId),
    attendanceId: asString(row.attendanceId),
    rosterEntryId: asString(row.rosterEntryId),
    signupId: asString(row.signupId),
    userId: asString(row.userId),
    characterId: asStringOrNull(row.characterId),
    userDisplayName: asString(row.userDisplayName),
    characterName: asString(row.characterName),
    characterRealm: asString(row.characterRealm),
    characterRegion: row.characterRegion == null ? null : mapRegion(row.characterRegion),
    participationType: mapParticipation(row.participationType),
    attendanceStatus: mapAttendanceStatus(row.attendanceStatus),
    role: row.role == null ? null : mapCharacterRole(row.role),
    isBackup: asBoolean(row.isBackup),
    shareUnits: asNumber(row.shareUnits),
    amountGold: asNumber(row.amountGold),
    adjustmentReason: asStringOrNull(row.adjustmentReason),
  };
}

function mapSettlement(row: Record<string, unknown>): SettlementRecord {
  const entries = Array.isArray(row.entries) ? row.entries : [];
  return {
    id: asString(row.id),
    runId: asString(row.runId),
    totalGold: asNumber(row.totalGold),
    status: mapSettlementStatus(row.status),
    preparedById: asString(row.preparedById),
    finalizedAt: asStringOrNull(row.finalizedAt),
    finalizedById: asStringOrNull(row.finalizedById),
    paidAt: asStringOrNull(row.paidAt),
    paidById: asStringOrNull(row.paidById),
    runTitle: asString(row.runTitle),
    raidName: asString(row.raidName),
    difficulty: mapDifficulty(row.difficulty),
    raidLeadName: asString(row.raidLeadName),
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt),
    entries: entries.map((entry) => mapEntry(entry as Record<string, unknown>)),
  };
}

function settlementQuery() {
  return orm.RunSettlement.include("entries");
}

export const payoutRepository = {
  async findByRunId(runId: string): Promise<SettlementRecord | null> {
    const row = await settlementQuery().where({ runId }).first();
    return row ? mapSettlement(row as Record<string, unknown>) : null;
  },

  async findById(id: string): Promise<SettlementRecord | null> {
    const row = await settlementQuery().where({ id }).first();
    return row ? mapSettlement(row as Record<string, unknown>) : null;
  },

  async findEntryById(id: string): Promise<PayoutEntryRecord | null> {
    const row = await orm.RunPayoutEntry.where({ id }).first();
    return row ? mapEntry(row as Record<string, unknown>) : null;
  },

  async createDraft(input: {
    runId: string;
    totalGold: number;
    preparedById: string;
    runTitle: string;
    raidName: string;
    difficulty: RaidDifficulty;
    raidLeadName: string;
    entries: PayoutEntryWrite[];
  }): Promise<SettlementRecord> {
    const settlementId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      const existing = await txOrm.RunSettlement.where({ runId: input.runId }).select("id").first();
      if (existing) {
        throw new DomainError("PAYOUT_ALREADY_EXISTS", "This run already has a settlement.");
      }
      await txOrm.RunSettlement.create({
        id: settlementId,
        runId: input.runId,
        totalGold: input.totalGold,
        status: "DRAFT",
        preparedById: input.preparedById,
        runTitle: input.runTitle,
        raidName: input.raidName,
        difficulty: input.difficulty,
        raidLeadName: input.raidLeadName,
        createdAt: now,
        updatedAt: now,
      });
      for (const entry of input.entries) {
        await txOrm.RunPayoutEntry.create({
          id: crypto.randomUUID(),
          settlementId,
          attendanceId: entry.attendanceId,
          rosterEntryId: entry.rosterEntryId,
          signupId: entry.signupId,
          userId: entry.userId,
          characterId: entry.characterId,
          userDisplayName: entry.userDisplayName,
          characterName: entry.characterName,
          characterRealm: entry.characterRealm,
          characterRegion: entry.characterRegion,
          participationType: entry.participationType,
          attendanceStatus: entry.attendanceStatus,
          role: entry.role,
          isBackup: entry.isBackup,
          shareUnits: entry.shareUnits,
          amountGold: entry.amountGold,
          adjustmentReason: entry.adjustmentReason,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    const created = await this.findById(settlementId);
    if (!created) {
      throw new DomainError("PAYOUT_NOT_FOUND", "Settlement was not found after create.");
    }
    return created;
  },

  async replaceDraftAmounts(input: {
    settlementId: string;
    totalGold: number;
    entries: Array<{ id: string; shareUnits: number; amountGold: number; adjustmentReason?: string | null }>;
  }) {
    const now = new Date().toISOString();
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      const settlement = await txOrm.RunSettlement.where({ id: input.settlementId }).first();
      if (!settlement || asString((settlement as Record<string, unknown>).status) !== "DRAFT") {
        throw new DomainError("PAYOUT_NOT_DRAFT", "Only a draft settlement can be updated.");
      }
      await txOrm.RunSettlement.where({ id: input.settlementId }).update({
        totalGold: input.totalGold,
        updatedAt: now,
      });
      for (const entry of input.entries) {
        await txOrm.RunPayoutEntry.where({ id: entry.id }).update({
          shareUnits: entry.shareUnits,
          amountGold: entry.amountGold,
          ...(entry.adjustmentReason !== undefined ? { adjustmentReason: entry.adjustmentReason } : {}),
          updatedAt: now,
        });
      }
    });
  },

  async finalize(input: {
    settlementId: string;
    finalizedById: string;
    totalGold: number;
    runTitle: string;
    raidName: string;
    difficulty: RaidDifficulty;
    raidLeadName: string;
    entries: Array<{
      id: string;
      shareUnits: number;
      amountGold: number;
      userDisplayName: string;
      characterName: string;
      characterRealm: string;
      characterRegion: WowRegion | null;
      participationType: ParticipationType;
      attendanceStatus: AttendanceStatus;
      role: CharacterRole | null;
      isBackup: boolean;
    }>;
  }) {
    const now = new Date().toISOString();
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      const settlement = await txOrm.RunSettlement.where({ id: input.settlementId }).first();
      const status = settlement ? asString((settlement as Record<string, unknown>).status) : "";
      if (!settlement || status !== "DRAFT") {
        throw new DomainError("PAYOUT_NOT_DRAFT", "Only a draft settlement can be finalized.");
      }
      await txOrm.RunSettlement.where({ id: input.settlementId }).update({
        status: "FINALIZED",
        totalGold: input.totalGold,
        runTitle: input.runTitle,
        raidName: input.raidName,
        difficulty: input.difficulty,
        raidLeadName: input.raidLeadName,
        finalizedAt: now,
        finalizedById: input.finalizedById,
        updatedAt: now,
      });
      for (const entry of input.entries) {
        await txOrm.RunPayoutEntry.where({ id: entry.id }).update({
          shareUnits: entry.shareUnits,
          amountGold: entry.amountGold,
          userDisplayName: entry.userDisplayName,
          characterName: entry.characterName,
          characterRealm: entry.characterRealm,
          characterRegion: entry.characterRegion,
          participationType: entry.participationType,
          attendanceStatus: entry.attendanceStatus,
          role: entry.role,
          isBackup: entry.isBackup,
          updatedAt: now,
        });
      }
    });
  },

  async markPaid(settlementId: string, paidById: string) {
    const now = new Date().toISOString();
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;
      const settlement = await txOrm.RunSettlement.where({ id: settlementId }).first();
      const status = settlement ? asString((settlement as Record<string, unknown>).status) : "";
      if (!settlement) {
        throw new DomainError("PAYOUT_NOT_FOUND", "Settlement was not found.");
      }
      if (status === "PAID") {
        throw new DomainError("PAYOUT_ALREADY_PAID", "This settlement is already marked paid.");
      }
      if (status !== "FINALIZED") {
        throw new DomainError("PAYOUT_NOT_DRAFT", "Only a finalized settlement can be marked paid.");
      }
      await txOrm.RunSettlement.where({ id: settlementId }).update({
        status: "PAID",
        paidAt: now,
        paidById,
        updatedAt: now,
      });
    });
  },
};
