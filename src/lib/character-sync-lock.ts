import { Client } from "pg";
import { pgConnectionConfig } from "@/lib/pg-pool";

/**
 * Per-Character sync lock: a non-blocking PostgreSQL session-level advisory
 * lock keyed (CHARACTER_SYNC_LOCK_NAMESPACE, hashtext(characterId)).
 *
 * Postgres is the authority, so the lock works across every execution
 * context (Next.js web process, the one-shot scheduled sync process).
 *
 * Why a dedicated session instead of a pooled connection: a session-level
 * lock must be acquired and released on the SAME backend, so the holder has
 * to keep that connection for the whole Blizzard round-trip. The app pool has
 * only 5 connections and the scheduler already holds one for its job lock —
 * holding one more per concurrent Character sync would starve the sync's own
 * queries. One long-lived lock session per process holds any number of
 * Character locks and never touches the pool.
 *
 * Session locks are re-entrant within their own session, so the in-process
 * `held` set only stops the SAME process from locking one Character twice; it
 * is never the cross-process authority.
 *
 * hashtext() is 32-bit; a collision between two Character ids can only make
 * one of them be skipped as "already syncing" for a moment — never a double
 * sync of the same Character and never a deadlock (acquisition never waits).
 * If the lock session dies, Postgres drops its locks with it; the next
 * acquisition reconnects.
 */
export const CHARACTER_SYNC_LOCK_NAMESPACE = 837463;

type LockSessionState = {
  client: Client | null;
  connecting: Promise<Client> | null;
  held: Set<string>;
};

const globalForLock = globalThis as unknown as { characterSyncLockSession?: LockSessionState };
const state: LockSessionState = globalForLock.characterSyncLockSession ?? {
  client: null,
  connecting: null,
  held: new Set<string>(),
};
globalForLock.characterSyncLockSession = state;

async function lockSession(): Promise<Client> {
  if (state.client) return state.client;
  if (!state.connecting) {
    state.connecting = (async () => {
      const client = new Client({ ...pgConnectionConfig, connectionTimeoutMillis: 8_000 });
      const forget = () => {
        if (state.client === client) state.client = null;
      };
      client.on("error", forget);
      client.on("end", forget);
      await client.connect();
      state.client = client;
      return client;
    })().finally(() => {
      state.connecting = null;
    });
  }
  return state.connecting;
}

export type CharacterSyncLock = { readonly characterId: string; readonly session: Client };

/** Non-blocking: returns null when this Character is already being synced anywhere. */
export async function tryAcquireCharacterSyncLock(characterId: string): Promise<CharacterSyncLock | null> {
  if (state.held.has(characterId)) return null;
  // Reserve before awaiting so two same-process callers cannot both pass.
  state.held.add(characterId);
  try {
    const session = await lockSession();
    const result = await session.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked",
      [CHARACTER_SYNC_LOCK_NAMESPACE, characterId],
    );
    if (result.rows[0]?.locked !== true) {
      state.held.delete(characterId);
      return null;
    }
    return { characterId, session };
  } catch (error) {
    state.held.delete(characterId);
    throw error;
  }
}

/** Always call exactly once per acquired lock (in a finally). Never throws. */
export async function releaseCharacterSyncLock(lock: CharacterSyncLock): Promise<void> {
  try {
    // A replaced/dead session already released everything it held.
    if (state.client === lock.session) {
      await lock.session.query("SELECT pg_advisory_unlock($1, hashtext($2))", [
        CHARACTER_SYNC_LOCK_NAMESPACE,
        lock.characterId,
      ]);
    }
  } catch {
    // Session gone → Postgres released the lock with it.
  } finally {
    state.held.delete(lock.characterId);
  }
}

/**
 * Runs `work` while holding the Character's sync lock. Returns
 * `{ acquired: false }` immediately (never waits) when it is already held.
 */
export async function withCharacterSyncLock<T>(
  characterId: string,
  work: () => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const lock = await tryAcquireCharacterSyncLock(characterId);
  if (!lock) return { acquired: false };
  try {
    return { acquired: true, value: await work() };
  } finally {
    await releaseCharacterSyncLock(lock);
  }
}

/** For one-shot processes (the scheduled sync script) so the process can exit. */
export async function closeCharacterSyncLockSession(): Promise<void> {
  const client = state.client;
  state.client = null;
  state.held.clear();
  if (client) {
    await client.end().catch(() => {});
  }
}
