import { orm } from "@/lib/prisma";
import { asString, asStringOrNull, asNumber, mapDeductStatus } from "@/lib/persistence";
import type { DeductStatus } from "@/models/enums";

export type DeductRecord = {
  id: string;
  payoutEntryId: string;
  amountGold: number;
  reason: string;
  notes: string | null;
  strikeId: string | null;
  status: DeductStatus;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  revokedById: string | null;
  revokedByName: string | null;
  revokedReason: string | null;
};

export type DeductCreateInput = {
  id: string;
  payoutEntryId: string;
  amountGold: number;
  reason: string;
  notes: string | null;
  strikeId: string | null;
  createdById: string;
};

function mapDeduct(row: Record<string, unknown>): DeductRecord {
  const createdBy = (row.createdBy ?? {}) as Record<string, unknown>;
  const revokedBy = row.revokedBy ? (row.revokedBy as Record<string, unknown>) : null;
  return {
    id: asString(row.id),
    payoutEntryId: asString(row.payoutEntryId),
    amountGold: asNumber(row.amountGold),
    reason: asString(row.reason),
    notes: asStringOrNull(row.notes),
    strikeId: asStringOrNull(row.strikeId),
    status: mapDeductStatus(row.status),
    createdById: asString(row.createdById),
    createdByName: asString(createdBy.name, "Unknown"),
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt),
    revokedAt: asStringOrNull(row.revokedAt),
    revokedById: asStringOrNull(row.revokedById),
    revokedByName: revokedBy ? asString(revokedBy.name) : null,
    revokedReason: asStringOrNull(row.revokedReason),
  };
}

function deductQuery() {
  return orm.Deduct.include("createdBy").include("revokedBy");
}

export const deductRepository = {
  async findById(id: string): Promise<DeductRecord | null> {
    const row = await deductQuery().where({ id }).first();
    return row ? mapDeduct(row as Record<string, unknown>) : null;
  },

  /** One query for every deduct across a whole settlement's payout entries — never one call per entry. */
  async listByPayoutEntryIds(payoutEntryIds: string[]): Promise<DeductRecord[]> {
    const unique = [...new Set(payoutEntryIds)];
    if (unique.length === 0) return [];
    const rows = await deductQuery()
      .where((deduct) => deduct.payoutEntryId.in(unique))
      .orderBy((deduct) => deduct.createdAt.desc())
      .all();
    return rows.map((row) => mapDeduct(row as Record<string, unknown>));
  },

  async create(input: DeductCreateInput): Promise<DeductRecord> {
    const now = new Date().toISOString();
    await orm.Deduct.create({
      id: input.id,
      payoutEntryId: input.payoutEntryId,
      amountGold: input.amountGold,
      reason: input.reason,
      notes: input.notes,
      strikeId: input.strikeId,
      status: "ACTIVE",
      createdById: input.createdById,
      createdAt: now,
      updatedAt: now,
    });
    const created = await this.findById(input.id);
    if (!created) {
      throw new Error("Deduct create did not persist.");
    }
    return created;
  },

  async revoke(
    id: string,
    fields: { revokedAt: string; revokedById: string; revokedReason: string },
  ): Promise<void> {
    await orm.Deduct.where({ id }).update({
      status: "REVOKED",
      revokedAt: fields.revokedAt,
      revokedById: fields.revokedById,
      revokedReason: fields.revokedReason,
      updatedAt: new Date().toISOString(),
    });
  },
};
