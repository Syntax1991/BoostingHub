import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { pgConnectionConfig } from "@/lib/pg-pool";
import { orm } from "@/lib/prisma";
import { isTestRuntime, resolveTestDatabaseUrl } from "@/lib/test-database-guard";
import type { AccountRole, AccountStatus, CharacterRole, WowClass } from "@/models/enums";

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

/** A random 18-digit Discord snowflake that no real account or channel uses in the test DB. */
export function syntheticDiscordId(): string {
  return `9${String(Math.floor(Math.random() * 1e17)).padStart(17, "0")}`;
}

export async function createTestUser(options: {
  name: string;
  accountRole?: AccountRole;
  accountStatus?: AccountStatus;
  discordUserId?: string | null;
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
    region: "EU",
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
