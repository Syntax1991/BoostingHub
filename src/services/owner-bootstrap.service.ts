import { DomainError } from "@/lib/errors";
import { userRepository } from "@/repositories/user.repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One-time Platform Owner bootstrap. Operator-only: reachable from the
 * `npm run owner:bootstrap -- --user-id <uuid>` CLI, never from the web UI or
 * the generic role management flow. The target is named by its exact User
 * UUID — never guessed (first user, first admin, …).
 *
 * Requirements (checked transactionally in bootstrapOwnerAtomic): the User
 * exists, is ACTIVE and is ADMIN, and no OWNER exists yet. A second bootstrap
 * fails safely with OWNER_ALREADY_EXISTS; the database's single-owner partial
 * unique index backs this against concurrent runs.
 */
export const ownerBootstrapService = {
  async bootstrap(input: { userId: string }) {
    const userId = input.userId.trim();
    if (!UUID_PATTERN.test(userId)) {
      throw new DomainError("OWNER_BOOTSTRAP_TARGET_INVALID", "Pass the exact BoostingHub User id (a UUID).");
    }
    const { name, previousRole } = await userRepository.bootstrapOwnerAtomic(userId);
    return { userId, name, previousRole, nextRole: "OWNER" as const };
  },
};
