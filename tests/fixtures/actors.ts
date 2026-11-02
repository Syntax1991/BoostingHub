import type { AuthenticatedUser } from "@/auth/authorization";
import type { AccountRole } from "@/models/enums";

/**
 * The signed-in caller a service, action or route sees. Active, no Discord link
 * unless the test says otherwise; the row it names may or may not exist.
 */
export function testActor(
  id: string,
  accountRole: AccountRole = "USER",
  overrides: Partial<Omit<AuthenticatedUser, "id" | "accountRole">> = {},
): AuthenticatedUser {
  return {
    id,
    name: `Test ${accountRole}`,
    email: `${id}@test.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
    ...overrides,
  };
}
