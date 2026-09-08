import { orm } from "@/lib/prisma";
import type { AccountRole, AccountStatus } from "@/models/enums";
import type { AuthenticatedUser } from "@/auth/authorization";
import { mapAccountStatus, mapUserRole, asString, asStringOrNull } from "@/lib/persistence";

export const userRepository = {
  async findAuthenticatedById(id: string): Promise<AuthenticatedUser | null> {
    const user = await orm.User.where({ id }).first();
    if (!user) {
      return null;
    }

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
};
