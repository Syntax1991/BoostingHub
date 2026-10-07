import { db } from "@/lib/prisma";

/**
 * Per-Character reservation lock namespace for `pg_advisory_xact_lock`.
 * Distinct from {@link CHARACTER_SYNC_LOCK_NAMESPACE} (837463) so Blizzard
 * sync never blocks (or is blocked by) roster reservation writes.
 */
export const CHARACTER_RESERVATION_LOCK_NAMESPACE = 837464;

/** Minimal transaction surface needed to take xact advisory locks. */
export type ReservationLockTx = {
  // Prisma's tx.execute is invariant in plan type; keep this boundary generic.
  execute: (plan: never) => Promise<unknown>;
};

/**
 * Acquire transaction-scoped advisory locks for the given Characters, in
 * deterministic sorted order, before re-reading reservation state and writing
 * draft/publish selection. Prevents TOCTOU double-booking across overlapping
 * Runs. Empty / duplicate ids are ignored. Locks release automatically on
 * commit or rollback.
 */
export async function lockCharactersForReservationInTx(
  tx: ReservationLockTx,
  characterIds: readonly string[],
): Promise<void> {
  const ordered = [...new Set(characterIds.filter((id) => id.length > 0))].sort((a, b) =>
    a.localeCompare(b),
  );
  const namespace = CHARACTER_RESERVATION_LOCK_NAMESPACE;
  for (const characterId of ordered) {
    const plan = db.raw
      .sql`WITH _lock AS (SELECT pg_advisory_xact_lock(${namespace}::int4, hashtext(${characterId}))) SELECT 1::int4 AS n FROM _lock`
      .returnsRow({ n: "pg/int4@1" })
      .build();
    await tx.execute(plan as never);
  }
}
