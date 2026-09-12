import type { PoolClient } from "pg";
import { pgPool } from "@/lib/pg-pool";

/**
 * PostgreSQL session-level advisory locks, used to keep two overlapping
 * invocations of the same scheduled job from doing real work at once (e.g. a
 * slow run still executing when the next ~15-minute tick fires).
 *
 * Session-level locks (pg_try_advisory_lock / pg_advisory_unlock) are bound
 * to the *physical* backend connection that acquired them, not to any query.
 * node-postgres pools reuse backend connections across unrelated callers, so
 * a lock must be acquired and released on the SAME held PoolClient — never
 * through the pool's implicit one-query-per-call `pool.query(...)`, which
 * could acquire on one backend and appear to release on another, or return a
 * connection to the pool while it still silently holds the lock. Callers
 * must hold the returned client for the job's full duration and always
 * release it via releaseLock (never client.release() directly), or the lock
 * leaks onto a pooled connection that later work reuses.
 */
export type AdvisoryLockHandle = {
  readonly client: PoolClient;
  readonly key1: number;
  readonly key2: number;
};

export const scheduledJobLockRepository = {
  /**
   * Attempts to acquire the named advisory lock without blocking. Returns
   * null (never throws) when another session already holds it.
   */
  async tryAcquireLock(key1: number, key2: number): Promise<AdvisoryLockHandle | null> {
    const client = await pgPool.connect();
    try {
      const result = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock($1, $2) AS locked",
        [key1, key2],
      );
      const acquired = result.rows[0]?.locked === true;
      if (!acquired) {
        client.release();
        return null;
      }
      return { client, key1, key2 };
    } catch (error) {
      client.release();
      throw error;
    }
  },

  /**
   * Releases the advisory lock on its held client, then returns that client
   * to the pool. Always call this exactly once per handle from tryAcquireLock
   * — including in a `finally`, so a thrown error during the job still frees
   * the lock for the next scheduled run.
   */
  async releaseLock(handle: AdvisoryLockHandle): Promise<void> {
    try {
      await handle.client.query("SELECT pg_advisory_unlock($1, $2)", [handle.key1, handle.key2]);
    } finally {
      handle.client.release();
    }
  },
};
