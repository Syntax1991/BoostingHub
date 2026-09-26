import { isDomainError, type DomainErrorCode } from "@/lib/errors";
import type { CharacterSyncErrorCode, WowRegion } from "@/models/enums";

/**
 * The ONE mapping from a failed Blizzard character sync to the safe category
 * persisted in Character.lastSyncErrorCode. Only fixed codes are ever stored —
 * never messages, URLs, payloads or tokens.
 *
 * refreshLinkedCharacterProfile folds some failures into the owner-facing
 * BLIZZARD_SYNC_FAILED; it keeps the original error as `cause`, so the
 * classification walks the cause chain and uses the most specific code.
 */
const CATEGORY_BY_DOMAIN_CODE: Partial<Record<DomainErrorCode, CharacterSyncErrorCode>> = {
  // Blizzard status/profile 404 or is_valid=false: identity cannot be verified right now.
  BLIZZARD_PROFILE_UNAVAILABLE: "PROFILE_UNAVAILABLE",
  BLIZZARD_CHARACTER_NOT_FOUND: "PROFILE_UNAVAILABLE",
  // Class / Blizzard id / realm (transfer) no longer match the linked identity.
  BLIZZARD_IDENTITY_CONFLICT: "IDENTITY_CONFLICT",
  // Rename collides with another Character, or Blizzard returned an unstorable name.
  CHARACTER_ALREADY_EXISTS: "NAME_CONFLICT",
  INVALID_CHARACTER_NAME: "NAME_CONFLICT",
  BATTLENET_RATE_LIMITED: "RATE_LIMITED",
  // 5xx, network error, timeout, invalid JSON — the client maps all of these here.
  BATTLENET_API_UNAVAILABLE: "UPSTREAM_UNAVAILABLE",
  // App client-credentials rejected, or Battle.net not configured.
  BATTLENET_AUTH_FAILED: "AUTH_OR_CONFIG",
  BATTLENET_NOT_CONFIGURED: "AUTH_OR_CONFIG",
};

export function classifySyncError(error: unknown): CharacterSyncErrorCode {
  let fallback: CharacterSyncErrorCode | null = null;
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (isDomainError(current)) {
      const category = CATEGORY_BY_DOMAIN_CODE[current.code];
      // The innermost specific code wins; a generic wrapper only sets the fallback.
      if (category) fallback = category;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return fallback ?? "INTERNAL";
}

/** Worth retrying later without any human action (scheduler / next manual refresh). */
export function isRetryableSyncError(category: CharacterSyncErrorCode): boolean {
  return category === "RATE_LIMITED" || category === "UPSTREAM_UNAVAILABLE" || category === "PROFILE_UNAVAILABLE";
}

/** Where a real sync attempt came from. PR 2 adds the admin triggers. */
export type CharacterSyncTrigger = "SCHEDULED" | "OWNER_MANUAL" | "OWNER_REGION_BULK";

/**
 * Safe structured failure log. Deliberately carries NO character/owner
 * identity (no ids, names, Discord names, emails), no message and no upstream
 * data — per-Character diagnosis comes from the persisted telemetry.
 */
export function logCharacterSyncFailure(input: {
  category: CharacterSyncErrorCode;
  trigger: CharacterSyncTrigger;
  region: WowRegion;
}): void {
  const rateLimited = input.category === "RATE_LIMITED";
  console.warn(
    JSON.stringify({
      event: rateLimited ? "character_sync_rate_limited" : "character_sync_failed",
      errorCategory: input.category,
      trigger: input.trigger,
      region: input.region,
      rateLimited,
      retryable: isRetryableSyncError(input.category),
    }),
  );
}
