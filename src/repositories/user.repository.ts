import { parseKilledBossIds } from "@/lib/lockout-bosses";
import { DomainError } from "@/lib/errors";
import { ROLE_LABELS } from "@/lib/labels";
import { db, orm } from "@/lib/prisma";
import { or } from "@prisma/orm-postgres/orm-client";
import type { AccountRole, AccountStatus, RaidDifficulty, RunStatus, WowRegion } from "@/models/enums";
import {
  hasAdminAccess,
  hasOwnerAccess,
  isEligibleRaidLead,
  type AuthenticatedUser,
} from "@/auth/authorization";
import {
  asBoolean,
  asNumber,
  mapAccountStatus,
  mapDifficulty,
  mapRegion,
  mapUserRole,
  asString,
  asStringOrNull,
} from "@/lib/persistence";

export type AdminUserListFilters = {
  query?: string;
  role?: AccountRole;
  hasApprovedAccess?: boolean;
  sort?: "name" | "joined_desc" | "joined_asc" | "role";
};

export type AdminUserListRow = {
  id: string;
  name: string;
  image: string | null;
  discordUserId: string | null;
  discordUsername: string | null;
  accountRole: AccountRole;
  accountStatus: AccountStatus;
  createdAt: string;
  characterCount: number;
  approvedAccessCount: number;
  pendingAccessCount: number;
  revokedAccessCount: number;
};

export type AdminUserCharacterLockout = {
  raidId: string;
  raid: { name: string };
  difficulty: RaidDifficulty;
  resetIdentifier: string;
  isComplete: boolean;
  bossesDefeated: number;
  /** Catalog boss ids killed this reset; null when unknown (older sync). */
  killedBossIds?: string[] | null;
};

export type AdminUserCharacterSummary = {
  id: string;
  name: string;
  realm: string;
  region: WowRegion;
  wowClass: string;
  specialization: string;
  primaryRole: string;
  /** Blizzard-authoritative; null when Blizzard has not supplied one. */
  itemLevel: number | null;
  isActive: boolean;
  blizzardLinked: boolean;
  /** All stored lockout rows; current-reset projection happens in the service. */
  lockouts: AdminUserCharacterLockout[];
};

export type AdminUserAccessSummary = {
  id: string;
  difficulty: string;
  status: string;
  notes: string | null;
  grantedAt: string | null;
};

export type AdminUserAuditEvent = {
  id: string;
  type: string;
  message: string;
  occurredAt: string;
  actorName: string | null;
};

const NON_TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  "DRAFT",
  "OPEN",
  "ROSTERING",
  "PUBLISHED",
  "IN_PROGRESS",
];

function mapAuthUser(user: Record<string, unknown>): AuthenticatedUser {
  return {
    id: asString(user.id),
    name: asString(user.name),
    email: asStringOrNull(user.email),
    image: asStringOrNull(user.image),
    discordUserId: asStringOrNull(user.discordUserId),
    discordUsername: asStringOrNull(user.discordUsername),
    accountRole: mapUserRole(user.accountRole),
    accountStatus: mapAccountStatus(user.accountStatus),
  };
}

function matchesQuery(
  user: {
    name: string;
    discordUsername: string | null;
    discordUserId: string | null;
  },
  query: string,
): boolean {
  const needle = query.trim().toLocaleLowerCase("en-US");
  if (!needle) return true;
  if (user.discordUserId && user.discordUserId === query.trim()) {
    return true;
  }
  const haystack = [user.name, user.discordUsername ?? ""]
    .join(" ")
    .toLocaleLowerCase("en-US");
  return haystack.includes(needle);
}

export const userRepository = {
  async findAuthenticatedById(id: string): Promise<AuthenticatedUser | null> {
    const user = await orm.User.where({ id }).first();
    if (!user) {
      return null;
    }

    return mapAuthUser(user as Record<string, unknown>);
  },

  /**
   * Local identity picker only. Discord-only users have no credential password,
   * so listing every User row would show accounts that cannot email-sign-in.
   */
  async listDevIdentities() {
    const accounts = await orm.Account
      .where({ providerId: "credential" })
      .include("user")
      .all();

    const uniqueUsers = new Map<string, NonNullable<(typeof accounts)[number]["user"]>>();
    for (const account of accounts) {
      const user = account.user;
      if (!user) {
        continue;
      }
      if (mapAccountStatus(user.accountStatus) !== "ACTIVE") {
        continue;
      }
      uniqueUsers.set(asString(user.id), user);
    }

    const users = [...uniqueUsers.values()].sort((left, right) =>
      asString(left.name).localeCompare(asString(right.name)),
    );

    return users.map((user) => ({
      id: asString(user.id),
      name: asString(user.name),
      email: asStringOrNull(user.email),
      accountRole: mapUserRole(user.accountRole) as AccountRole,
      image: asStringOrNull(user.image),
      accountStatus: "ACTIVE" as AccountStatus,
    }));
  },

  /**
   * Raid Lead player picker: ACTIVE accounts whose name or Discord username
   * contains `query` (case-insensitive), bounded by `limit`. Never loads the
   * full user table into the page.
   */
  async searchActivePlayers(query: string, limit = 10): Promise<Array<{ id: string; name: string; discordUsername: string | null }>> {
    const needle = query.trim();
    if (needle.length === 0) return [];
    // Escape LIKE wildcards so a literal "%" or "_" in a name matches itself.
    const pattern = `%${needle.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const rows = await orm.User.where({ accountStatus: "ACTIVE" })
      .where((user) => or(user.name.ilike(pattern), user.discordUsername.ilike(pattern)))
      .select("id", "name", "discordUsername")
      .orderBy((user) => user.name.asc())
      .limit(limit)
      .all();
    return rows.map((row) => {
      const record = row as Record<string, unknown>;
      return { id: asString(record.id), name: asString(record.name), discordUsername: asStringOrNull(record.discordUsername) };
    });
  },

  async findById(id: string) {
    return this.findAuthenticatedById(id);
  },

  /** Discord bot identity resolution: the immutable Discord snowflake, never username. */
  async findByDiscordUserId(discordUserId: string): Promise<AuthenticatedUser | null> {
    const user = await orm.User.where({ discordUserId }).first();
    if (!user) {
      return null;
    }
    return mapAuthUser(user as Record<string, unknown>);
  },

  /**
   * RAID_LEAD, ADMIN and OWNER accounts that may be assigned as a Run's raid
   * lead. Ordinary USER accounts are never eligible.
   */
  async listEligibleRaidLeads() {
    const users = await orm.User.orderBy((user) => user.name.asc()).all();
    return users
      .map((user) => mapAuthUser(user as Record<string, unknown>))
      .filter((user) => isEligibleRaidLead(user))
      .map((user) => ({
        id: user.id,
        name: user.name,
        accountRole: user.accountRole,
      }));
  },

  async countByRole(): Promise<Record<AccountRole, number>> {
    const users = await orm.User.select("accountRole").all();
    const counts: Record<AccountRole, number> = {
      USER: 0,
      RAID_LEAD: 0,
      ADMIN: 0,
      OWNER: 0,
    };
    for (const row of users) {
      const role = mapUserRole((row as Record<string, unknown>).accountRole);
      counts[role] += 1;
    }
    return counts;
  },

  /**
   * Generic account-role change, validated and written in ONE transaction.
   *
   * - OWNER is protected: a target that is (now) OWNER is refused, whoever
   *   asks, and OWNER is never a valid nextRole here.
   * - Last admin-level account: when the change removes Admin-level authority
   *   (ADMIN → RAID_LEAD / USER), every admin-level row (ADMIN or OWNER) plus
   *   the target is row-locked first (the same bump-updatedAt lock as
   *   lockRosterInTx), then the remaining ACTIVE admin-level accounts are
   *   counted. Two concurrent demotions serialize on those locks, so they can
   *   never both pass and leave the platform without an Admin-level account.
   *   An OWNER counts as Admin-level authority.
   */
  async changeAccountRoleAtomic(input: {
    targetUserId: string;
    nextRole: AccountRole;
  }): Promise<{ name: string; previousRole: AccountRole; accountStatus: AccountStatus }> {
    if (hasOwnerAccess(input.nextRole)) {
      throw new DomainError(
        "OWNER_ASSIGNMENT_REQUIRES_BOOTSTRAP",
        "Platform ownership cannot be assigned through role management.",
      );
    }
    let result: { name: string; previousRole: AccountRole; accountStatus: AccountStatus } | null = null;
    await db.transaction(async (tx) => {
      const txOrm = ((tx.orm as { public?: typeof orm }).public ?? (tx.orm as unknown as typeof orm)) as typeof orm;
      const now = new Date().toISOString();

      const before = (await txOrm.User.where({ id: input.targetUserId }).first()) as Record<string, unknown> | null;
      if (!before) {
        throw new DomainError("USER_NOT_FOUND", "User was not found.", 404);
      }
      const mayRemoveAdminAccess =
        hasAdminAccess(mapUserRole(before.accountRole)) && !hasAdminAccess(input.nextRole);
      if (mayRemoveAdminAccess) {
        await txOrm.User.where((user) =>
          or(user.accountRole.in(["ADMIN", "OWNER"]), user.id.eq(input.targetUserId)),
        ).update({ updatedAt: now });
      } else {
        await txOrm.User.where({ id: input.targetUserId }).update({ updatedAt: now });
      }

      // Fresh read after the lock — decide on this, never on the pre-lock row.
      const target = (await txOrm.User.where({ id: input.targetUserId }).first()) as Record<string, unknown> | null;
      if (!target) {
        throw new DomainError("USER_NOT_FOUND", "User was not found.", 404);
      }
      const name = asString(target.name);
      const previousRole = mapUserRole(target.accountRole);
      if (hasOwnerAccess(previousRole)) {
        throw new DomainError(
          "OWNER_ROLE_PROTECTED",
          `${name} is the Platform Owner. Ownership cannot be changed through role management.`,
          403,
        );
      }
      if (previousRole === input.nextRole) {
        throw new DomainError(
          "ROLE_ALREADY_ASSIGNED",
          `${name} already has the ${ROLE_LABELS[input.nextRole]} role.`,
        );
      }
      if (hasAdminAccess(previousRole) && !hasAdminAccess(input.nextRole)) {
        if (!mayRemoveAdminAccess) {
          // The target gained Admin-level authority after the first read, so
          // the admin-level rows were not locked — refuse instead of guessing.
          throw new DomainError("ROLE_ALREADY_ASSIGNED", `${name}'s role changed meanwhile. Reload and try again.`);
        }
        const adminLevel = (await txOrm.User.where((user) => user.accountRole.in(["ADMIN", "OWNER"]))
          .select("id", "accountStatus")
          .all()) as Array<Record<string, unknown>>;
        const remaining = adminLevel.filter(
          (row) => asString(row.id) !== input.targetUserId && mapAccountStatus(row.accountStatus) === "ACTIVE",
        ).length;
        if (remaining < 1) {
          throw new DomainError(
            "LAST_ADMIN_REQUIRED",
            "The platform must keep at least one active Admin-level account (Admin or Platform Owner).",
          );
        }
      }

      await txOrm.User.where({ id: input.targetUserId }).update({ accountRole: input.nextRole, updatedAt: now });
      result = { name, previousRole, accountStatus: mapAccountStatus(target.accountStatus) };
    });
    if (!result) throw new DomainError("USER_NOT_FOUND", "User was not found.", 404);
    return result;
  },

  /**
   * One-time platform owner bootstrap (CLI only, never exposed in the web UI).
   * In one transaction: the target must exist, be ACTIVE and be ADMIN; no
   * OWNER may exist yet; then the target becomes OWNER and an audit
   * ActivityEvent (PLATFORM_OWNER_BOOTSTRAPPED) is written.
   *
   * Singleton guarantee: the partial unique index `user_single_owner`
   * (accountRole = 'OWNER') makes a second OWNER impossible at the database
   * level. Two concurrent bootstraps may both pass the "no owner yet" read,
   * but the second UPDATE waits on the first's uncommitted index entry and
   * then fails with a unique violation — reported as OWNER_ALREADY_EXISTS.
   */
  async bootstrapOwnerAtomic(targetUserId: string): Promise<{ name: string; previousRole: AccountRole }> {
    let result: { name: string; previousRole: AccountRole } | null = null;
    try {
      await db.transaction(async (tx) => {
        const txOrm = ((tx.orm as { public?: typeof orm }).public ?? (tx.orm as unknown as typeof orm)) as typeof orm;
        const now = new Date().toISOString();
        await txOrm.User.where({ id: targetUserId }).update({ updatedAt: now });
        const target = (await txOrm.User.where({ id: targetUserId }).first()) as Record<string, unknown> | null;
        if (!target) {
          throw new DomainError("USER_NOT_FOUND", "User was not found.", 404);
        }
        const name = asString(target.name);
        const previousRole = mapUserRole(target.accountRole);

        const existingOwner = (await txOrm.User.where({ accountRole: "OWNER" }).select("id").first()) as Record<
          string,
          unknown
        > | null;
        if (existingOwner) {
          throw new DomainError(
            "OWNER_ALREADY_EXISTS",
            asString(existingOwner.id) === targetUserId
              ? `${name} is already the Platform Owner.`
              : "A Platform Owner already exists. Ownership transfer is not supported.",
          );
        }
        if (mapAccountStatus(target.accountStatus) !== "ACTIVE") {
          throw new DomainError("OWNER_BOOTSTRAP_TARGET_INVALID", `${name} is not an active account.`);
        }
        if (previousRole !== "ADMIN") {
          throw new DomainError(
            "OWNER_BOOTSTRAP_TARGET_INVALID",
            `${name} must already be an Admin to become Platform Owner (current role: ${ROLE_LABELS[previousRole]}).`,
          );
        }

        await txOrm.User.where({ id: targetUserId }).update({ accountRole: "OWNER", updatedAt: now });
        await txOrm.ActivityEvent.create({
          id: crypto.randomUUID(),
          userId: targetUserId,
          type: "PLATFORM_OWNER_BOOTSTRAPPED",
          message: `Platform owner bootstrapped: ${name} (${ROLE_LABELS[previousRole]} → ${ROLE_LABELS.OWNER}). targetUserId=${targetUserId} previousRole=${previousRole} newRole=OWNER`,
          occurredAt: now,
        });
        result = { name, previousRole };
      });
    } catch (error) {
      if (!(error instanceof DomainError) && isSingleOwnerViolation(error)) {
        throw new DomainError(
          "OWNER_ALREADY_EXISTS",
          "A Platform Owner already exists. Ownership transfer is not supported.",
        );
      }
      throw error;
    }
    if (!result) throw new DomainError("USER_NOT_FOUND", "User was not found.", 404);
    return result;
  },

  async listNonTerminalRunsForRaidLead(raidLeadId: string): Promise<
    Array<{ id: string; title: string; status: RunStatus }>
  > {
    const rows = await orm.Run.where({ raidLeadId }).select("id", "title", "status").all();
    return rows
      .map((row) => {
        const record = row as Record<string, unknown>;
        return {
          id: asString(record.id),
          title: asString(record.title),
          status: asString(record.status) as RunStatus,
        };
      })
      .filter((run) => NON_TERMINAL_RUN_STATUSES.includes(run.status));
  },

  async listAdminUsers(filters: AdminUserListFilters = {}): Promise<AdminUserListRow[]> {
    const users = await orm.User.orderBy((user) => user.name.asc()).all();
    const characters = await orm.Character.select("id", "userId").all();
    const accessRows = await orm.BoosterAccess.select("userId", "status").all();
    const qualificationRows = await orm.BoosterQualification.select("userId", "status").all();

    const characterCountByUser = new Map<string, number>();
    for (const row of characters) {
      const userId = asString((row as Record<string, unknown>).userId);
      characterCountByUser.set(userId, (characterCountByUser.get(userId) ?? 0) + 1);
    }

    const accessByUser = new Map<
      string,
      { approved: number; pending: number; revoked: number }
    >();
    for (const row of qualificationRows) {
      const record = row as Record<string, unknown>;
      const userId = asString(record.userId);
      const status = asString(record.status);
      const current = accessByUser.get(userId) ?? { approved: 0, pending: 0, revoked: 0 };
      if (status === "APPROVED") current.approved += 1;
      if (status === "REVOKED") current.revoked += 1;
      accessByUser.set(userId, current);
    }
    for (const row of accessRows) {
      const record = row as Record<string, unknown>;
      const userId = asString(record.userId);
      const status = asString(record.status);
      const current = accessByUser.get(userId) ?? { approved: 0, pending: 0, revoked: 0 };
      if (status === "PENDING") current.pending += 1;
      accessByUser.set(userId, current);
    }

    let rows: AdminUserListRow[] = users.map((user) => {
      const record = user as Record<string, unknown>;
      const id = asString(record.id);
      const access = accessByUser.get(id) ?? { approved: 0, pending: 0, revoked: 0 };
      return {
        id,
        name: asString(record.name),
        image: asStringOrNull(record.image),
        discordUserId: asStringOrNull(record.discordUserId),
        discordUsername: asStringOrNull(record.discordUsername),
        accountRole: mapUserRole(record.accountRole),
        accountStatus: mapAccountStatus(record.accountStatus),
        createdAt: asString(record.createdAt),
        characterCount: characterCountByUser.get(id) ?? 0,
        approvedAccessCount: access.approved,
        pendingAccessCount: access.pending,
        revokedAccessCount: access.revoked,
      };
    });

    if (filters.role) {
      rows = rows.filter((row) => row.accountRole === filters.role);
    }
    if (filters.query?.trim()) {
      rows = rows.filter((row) => matchesQuery(row, filters.query!));
    }
    if (filters.hasApprovedAccess === true) {
      rows = rows.filter((row) => row.approvedAccessCount > 0);
    }
    if (filters.hasApprovedAccess === false) {
      rows = rows.filter((row) => row.approvedAccessCount === 0);
    }

    const sort = filters.sort ?? "name";
    rows.sort((left, right) => {
      if (sort === "joined_desc") {
        return right.createdAt.localeCompare(left.createdAt);
      }
      if (sort === "joined_asc") {
        return left.createdAt.localeCompare(right.createdAt);
      }
      if (sort === "role") {
        const roleCmp = left.accountRole.localeCompare(right.accountRole);
        if (roleCmp !== 0) return roleCmp;
      }
      return left.name.localeCompare(right.name, "en-US", { sensitivity: "base" });
    });

    return rows;
  },

  async findAdminUserDetail(userId: string): Promise<{
    user: AuthenticatedUser & { createdAt: string; updatedAt: string };
    characters: AdminUserCharacterSummary[];
    access: AdminUserAccessSummary[];
    audit: AdminUserAuditEvent[];
  } | null> {
    const user = await orm.User.where({ id: userId }).first();
    if (!user) {
      return null;
    }
    const record = user as Record<string, unknown>;
    const auth = mapAuthUser(record);

    const characters = await orm.Character
      .where({ userId })
      .include("lockouts", (lockout) => lockout.include("raid"))
      .orderBy((row) => row.name.asc())
      .all();
    const access = await orm.BoosterQualification.where({ userId }).orderBy((row) => row.updatedAt.desc()).all();
    const audit = await orm.ActivityEvent
      .where({ userId })
      .include("user")
      .orderBy((event) => event.occurredAt.desc())
      .limit(40)
      .all();

    // Role-change audits are written under the actor userId; also pull events that mention this user.
    const roleChangeEvents = await orm.ActivityEvent
      .where({ type: "ACCOUNT_ROLE_CHANGED" })
      .include("user")
      .orderBy((event) => event.occurredAt.desc())
      .limit(100)
      .all();

    const characterSummaries: AdminUserCharacterSummary[] = characters.map((row) => {
      const character = row as Record<string, unknown>;
      const lockouts = Array.isArray(character.lockouts) ? character.lockouts : [];
      return {
        id: asString(character.id),
        name: asString(character.name),
        realm: asString(character.realm),
        region: mapRegion(character.region),
        wowClass: asString(character.wowClass),
        specialization: asStringOrNull(character.specialization) ?? "—",
        primaryRole: asString(character.primaryRole),
        itemLevel: typeof character.itemLevel === "number" ? character.itemLevel : null,
        isActive: Boolean(character.isActive),
        blizzardLinked: Boolean(asStringOrNull(character.blizzardCharacterId)),
        lockouts: lockouts.map((lockoutRow) => {
          const lockout = lockoutRow as Record<string, unknown>;
          const raid = (lockout.raid ?? {}) as Record<string, unknown>;
          return {
            raidId: asString(lockout.raidId),
            raid: { name: asString(raid.name, "Unknown raid") },
            difficulty: mapDifficulty(lockout.difficulty),
            resetIdentifier: asString(lockout.resetIdentifier),
            isComplete: asBoolean(lockout.isComplete),
            bossesDefeated: asNumber(lockout.bossesDefeated),
            killedBossIds: parseKilledBossIds(lockout.killedBossIds),
          };
        }),
      };
    });

    const accessSummaries: AdminUserAccessSummary[] = access.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        id: asString(item.id),
        difficulty: asString(item.difficulty),
        status: asString(item.status),
        notes: asStringOrNull(item.notes),
        grantedAt: asStringOrNull(item.grantedAt),
      };
    });

    const targetMarker = `targetUserId=${userId}`;
    const auditMap = new Map<string, AdminUserAuditEvent>();
    for (const row of [...audit, ...roleChangeEvents]) {
      const event = row as Record<string, unknown>;
      const message = asString(event.message);
      const type = asString(event.type);
      if (type === "ACCOUNT_ROLE_CHANGED" && !message.includes(targetMarker)) {
        continue;
      }
      const actor = event.user ? (event.user as Record<string, unknown>) : null;
      auditMap.set(asString(event.id), {
        id: asString(event.id),
        type,
        message,
        occurredAt: asString(event.occurredAt),
        actorName: actor ? asString(actor.name) : null,
      });
    }

    const auditEvents = [...auditMap.values()].sort((left, right) =>
      right.occurredAt.localeCompare(left.occurredAt),
    );

    return {
      user: {
        ...auth,
        createdAt: asString(record.createdAt),
        updatedAt: asString(record.updatedAt),
      },
      characters: characterSummaries,
      access: accessSummaries,
      audit: auditEvents.slice(0, 40),
    };
  },
};

/** Postgres unique violation (23505) on the single-owner partial index. */
function isSingleOwnerViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const record = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (record.code === "23505") return true;
    if (typeof record.message === "string" && record.message.includes("user_single_owner")) return true;
    current = record.cause;
  }
  return false;
}
