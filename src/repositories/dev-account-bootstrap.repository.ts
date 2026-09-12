import { db, orm } from "@/lib/prisma";
import { RAID_DIFFICULTIES } from "@/models/enums";

type TxOrm = typeof orm;

const BOOTSTRAP_NOTE = "Development account bootstrap";

export const devAccountBootstrapRepository = {
  /**
   * Restores ADMIN + ACTIVE on the given User and ensures an APPROVED
   * BoosterQualification row for NORMAL, HEROIC, and MYTHIC independently, in
   * one transaction. Already-correct fields are left untouched — no
   * `updatedAt`/`grantedAt`/`notes` churn when nothing needs to change.
   *
   * The caller (dev-account-bootstrap.service.ts) is responsible for the
   * dev-only gate and the exact-Discord-ID match; this only ever runs against
   * an already-confirmed target `userId`.
   *
   * Two concurrent calls for the same never-qualified target can both read
   * "missing" for a difficulty before either commits its INSERT — the loser
   * hits the `(userId, difficulty)` unique constraint and this transaction
   * rolls back. The caller retries once, which resolves against the winner's
   * now-committed row as a plain idempotent update-or-noop.
   */
  async restoreDevAdminAccount(userId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;

      const user = await txOrm.User.where({ id: userId }).first();
      if (!user) return;
      const userRecord = user as Record<string, unknown>;
      if (userRecord.accountRole !== "ADMIN" || userRecord.accountStatus !== "ACTIVE") {
        await txOrm.User.where({ id: userId }).update({
          accountRole: "ADMIN",
          accountStatus: "ACTIVE",
          updatedAt: new Date().toISOString(),
        });
      }

      for (const difficulty of RAID_DIFFICULTIES) {
        const existing = await txOrm.BoosterQualification.where({ userId, difficulty }).first();
        const now = new Date().toISOString();

        if (!existing) {
          await txOrm.BoosterQualification.create({
            id: crypto.randomUUID(),
            userId,
            difficulty,
            status: "APPROVED",
            notes: BOOTSTRAP_NOTE,
            grantedAt: now,
            grantedById: null,
            revokedAt: null,
            revokedById: null,
            createdAt: now,
            updatedAt: now,
          });
          continue;
        }

        const existingRecord = existing as Record<string, unknown>;
        if (existingRecord.status !== "APPROVED") {
          await txOrm.BoosterQualification.where({ id: existingRecord.id as string }).update({
            status: "APPROVED",
            notes: BOOTSTRAP_NOTE,
            grantedAt: now,
            grantedById: null,
            revokedAt: null,
            revokedById: null,
            updatedAt: now,
          });
        }
        // Already APPROVED — left untouched, including grantedAt/notes/updatedAt.
      }
    });
  },
};
