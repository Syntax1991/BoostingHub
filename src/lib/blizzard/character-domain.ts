import type { AuthenticatedUser } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";

/**
 * Shared invariants between the Blizzard import/lookup and sync services:
 * ownership enforcement, Blizzard's realm-slug convention, and unique-key
 * conflict detection. Kept here (not per-service) so both flows enforce the
 * same rules — duplicating any of these would let one flow drift out of
 * sync with the other's identity/ownership guarantees.
 */
export function assertCharacterOwned(user: AuthenticatedUser, character: { userId: string }) {
  if (character.userId !== user.id) {
    throw new DomainError("CHARACTER_NOT_OWNED", "You can only manage your own characters.", 403);
  }
}

export function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Error && /unique|duplicate|constraint/i.test(error.message);
}

export function realmSlugFromDisplayName(realm: string): string {
  return realm.toLocaleLowerCase("en-US").trim().replace(/\s+/g, "-");
}
