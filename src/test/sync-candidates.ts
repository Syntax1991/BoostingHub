import { orm } from "@/lib/prisma";
import { assertIsolatedTestDatabase } from "@/test/db-fixtures";

/**
 * A scheduler pass reads every stale active Character in the database. A suite
 * that asserts on a pass's totals runs it here: every other active Character
 * is marked freshly synced for the duration of `body`, then gets its exact
 * lastSyncedAt back, even when `body` throws.
 */
export async function withOnlySyncCandidates<T>(keepCharacterIds: Iterable<string>, body: () => Promise<T>): Promise<T> {
  assertIsolatedTestDatabase();
  const keep = new Set(keepCharacterIds);
  const others = ((await orm.Character.where({ isActive: true }).select("id", "lastSyncedAt").all()) as Array<{
    id: string;
    lastSyncedAt: string | null;
  }>).filter((character) => !keep.has(character.id));
  const freshAt = new Date().toISOString();
  for (const character of others) await orm.Character.where({ id: character.id }).update({ lastSyncedAt: freshAt });
  try {
    return await body();
  } finally {
    for (const character of others) {
      await orm.Character.where({ id: character.id }).update({ lastSyncedAt: character.lastSyncedAt });
    }
  }
}
