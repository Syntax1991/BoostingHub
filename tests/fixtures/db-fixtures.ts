import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { pgConnectionConfig, pgPool } from "@/lib/pg-pool";
import { orm } from "@/lib/prisma";
import { isTestRuntime, resolveTestDatabaseUrl } from "@/lib/test-database-guard";
import type { AccountRole, AccountStatus, CharacterRole, WowClass, WowRegion } from "@/models/enums";

/**
 * Row fixtures for DB suites. Every id is fresh per call, so a suite never
 * meets, and never deletes, a row it did not create.
 */

/**
 * Throws unless this process is a test run connected to the isolated test
 * database. Call it before any destructive setup or cleanup.
 */
export function assertIsolatedTestDatabase(): void {
  if (!isTestRuntime()) throw new Error("Refusing destructive test setup outside a test run.");
  if (pgConnectionConfig.connectionString !== resolveTestDatabaseUrl()) {
    throw new Error("Refusing destructive test setup: the pool is not connected to TEST_DATABASE_URL.");
  }
}

const LOCK_WAIT_POLL_MS = 10;
/** Below Vitest's 5 s default test timeout, so a missing waiter fails with this helper's message. */
const LOCK_WAIT_TIMEOUT_MS = 3_000;

/**
 * Resolves once another session on the test database is blocked on a row or
 * transaction lock. A concurrency test awaits it between starting its second
 * writer and releasing the first, so the second writer provably queued behind
 * the lock instead of running before or after it. Times out (and fails) when
 * nothing ever waits, which is what a dropped lock looks like.
 *
 * Measures with `performance.now()`, because suites may freeze `Date`.
 */
export async function waitForLockWaiter(): Promise<void> {
  const deadline = performance.now() + LOCK_WAIT_TIMEOUT_MS;
  for (;;) {
    const { rows } = await pgPool.query<{ waiting: number }>(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
    );
    if (rows[0]!.waiting > 0) return;
    if (performance.now() > deadline) {
      throw new Error(`No session waited on a lock within ${LOCK_WAIT_TIMEOUT_MS} ms.`);
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_POLL_MS));
  }
}

/** A random 18-digit Discord snowflake that no real account or channel uses in the test DB. */
export function syntheticDiscordId(): string {
  return `9${String(Math.floor(Math.random() * 1e17)).padStart(17, "0")}`;
}

export async function createTestUser(options: {
  name: string;
  accountRole?: AccountRole;
  accountStatus?: AccountStatus;
  discordUserId?: string | null;
  discordUsername?: string | null;
  isBooster?: boolean;
}): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name: options.name,
    email: `${id}@test.boostting.local`,
    emailVerified: true,
    discordUserId: options.discordUserId ?? null,
    discordUsername: options.discordUsername ?? null,
    accountRole: options.accountRole ?? "USER",
    accountStatus: options.accountStatus ?? "ACTIVE",
    isBooster: options.isBooster ?? false,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function createTestCharacter(options: {
  userId: string;
  name: string;
  realm: string;
  wowClass: WowClass;
  specialization: string | null;
  primaryRole: CharacterRole;
  itemLevel?: number;
  isActive?: boolean;
  lastSyncedAt?: string | null;
  region?: WowRegion;
}): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.Character.create({
    id,
    userId: options.userId,
    name: options.name,
    realm: options.realm,
    normalizedName: normalizeCharacterIdentity(options.name),
    normalizedRealm: normalizeCharacterIdentity(options.realm),
    region: options.region ?? "EU",
    wowClass: options.wowClass,
    specialization: options.specialization,
    primaryRole: options.primaryRole,
    itemLevel: options.itemLevel ?? 700,
    isActive: options.isActive ?? true,
    lastSyncedAt: options.lastSyncedAt ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/**
 * Deletes exactly the rows a suite created, Runs first (their signups, roster,
 * domain events and Discord posts cascade), then Characters, then the Users
 * with their activity feed rows (which would otherwise outlive them with a
 * null user), and fails if any row survives. Database errors propagate.
 */
export async function deleteCreatedRows(created: { runIds?: string[]; characterIds?: string[]; userIds?: string[] }) {
  assertIsolatedTestDatabase();
  for (const id of created.runIds ?? []) await orm.Run.where({ id }).deleteAndCount();
  for (const id of created.characterIds ?? []) await orm.Character.where({ id }).deleteAndCount();
  for (const id of created.userIds ?? []) {
    await orm.ActivityEvent.where({ userId: id }).deleteAndCount();
    await orm.User.where({ id }).deleteAndCount();
  }

  const survivors: string[] = [];
  for (const id of created.runIds ?? []) if (await orm.Run.where({ id }).first()) survivors.push(`Run ${id}`);
  for (const id of created.characterIds ?? []) if (await orm.Character.where({ id }).first()) survivors.push(`Character ${id}`);
  for (const id of created.userIds ?? []) if (await orm.User.where({ id }).first()) survivors.push(`User ${id}`);
  if (survivors.length > 0) throw new Error(`Test cleanup left rows behind: ${survivors.join(", ")}`);
}
