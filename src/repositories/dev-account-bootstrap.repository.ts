import { hasAdminAccess } from "@/auth/authorization";
import { mapUserRole } from "@/lib/persistence";
import { db, orm } from "@/lib/prisma";

type TxOrm = typeof orm;

export const devAccountBootstrapRepository = {
  /**
   * Restores ADMIN + ACTIVE on the given User and ensures they hold the Booster
   * role (User.isBooster), in one transaction. Already-correct fields are left
   * untouched — no `updatedAt` churn when nothing needs to change.
   *
   * The caller (dev-account-bootstrap.service.ts) is responsible for the
   * dev-only gate and the exact-Discord-ID match; this only ever runs against
   * an already-confirmed target `userId`.
   */
  async restoreDevAdminAccount(userId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: TxOrm }).public ?? (tx.orm as unknown as TxOrm)) as TxOrm;

      const user = await txOrm.User.where({ id: userId }).first();
      if (!user) return;
      const userRecord = user as Record<string, unknown>;
      // Restore Admin authority — an OWNER already has it and must never be
      // demoted to ADMIN by this dev-only helper.
      const role = mapUserRole(userRecord.accountRole);
      const needsAuthority = !hasAdminAccess(role) || userRecord.accountStatus !== "ACTIVE";
      const needsBooster = userRecord.isBooster !== true;
      if (!needsAuthority && !needsBooster) return;

      await txOrm.User.where({ id: userId }).update({
        accountRole: hasAdminAccess(role) ? role : "ADMIN",
        accountStatus: "ACTIVE",
        isBooster: true,
        updatedAt: new Date().toISOString(),
      });
    });
  },
};
