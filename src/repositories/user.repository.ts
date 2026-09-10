import { orm } from "@/lib/prisma";
import type { AccountRole, AccountStatus, RunStatus } from "@/models/enums";
import type { AuthenticatedUser } from "@/auth/authorization";
import { mapAccountStatus, mapUserRole, asString, asStringOrNull } from "@/lib/persistence";

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

export type AdminUserCharacterSummary = {
  id: string;
  name: string;
  realm: string;
  wowClass: string;
  specialization: string;
  primaryRole: string;
  itemLevel: number;
  isActive: boolean;
  blizzardLinked: boolean;
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

  async findById(id: string) {
    return this.findAuthenticatedById(id);
  },

  /**
   * RAID_LEAD and ADMIN accounts that may be assigned as a Run's raid lead.
   * Ordinary USER accounts are never eligible.
   */
  async listEligibleRaidLeads() {
    const users = await orm.User.orderBy((user) => user.name.asc()).all();
    return users
      .map((user) => mapAuthUser(user as Record<string, unknown>))
      .filter(
        (user) =>
          user.accountStatus === "ACTIVE" &&
          (user.accountRole === "RAID_LEAD" || user.accountRole === "ADMIN"),
      )
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
    };
    for (const row of users) {
      const role = mapUserRole((row as Record<string, unknown>).accountRole);
      counts[role] += 1;
    }
    return counts;
  },

  async countAdmins(): Promise<number> {
    const rows = await orm.User.where({ accountRole: "ADMIN" }).select("id").all();
    return rows.length;
  },

  async updateAccountRole(userId: string, accountRole: AccountRole): Promise<void> {
    await orm.User.where({ id: userId }).update({
      accountRole,
      updatedAt: new Date().toISOString(),
    });
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

    const characters = await orm.Character.where({ userId }).orderBy((row) => row.name.asc()).all();
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
      return {
        id: asString(character.id),
        name: asString(character.name),
        realm: asString(character.realm),
        wowClass: asString(character.wowClass),
        specialization: asStringOrNull(character.specialization) ?? "—",
        primaryRole: asString(character.primaryRole),
        itemLevel: typeof character.itemLevel === "number" ? character.itemLevel : 0,
        isActive: Boolean(character.isActive),
        blizzardLinked: Boolean(asStringOrNull(character.blizzardCharacterId)),
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
