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

  async listDevIdentities() {
    const users = await orm.User
      .select("id", "name", "email", "accountRole", "image")
      .orderBy((user) => user.name.asc())
      .all();

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
