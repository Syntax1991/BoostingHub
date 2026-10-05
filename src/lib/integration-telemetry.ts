import type { IntegrationProvider, IntegrationEventStatus, WowRegion } from "@/models/enums";

/**
 * Allowlisted IntegrationEvent.metadata keys.
 * Anything else is dropped. Nested objects/arrays are rejected (flattened scalars only).
 */
export const INTEGRATION_METADATA_ALLOWLIST = [
  "processed",
  "succeeded",
  "failed",
  "skipped",
  "backoffSkipped",
  "rateLimited",
  "authOrConfig",
  "profileUnavailable",
  "totalCandidates",
  "httpStatus",
  "discordCode",
  "channelKind",
  "messageKind",
  "parseFailure",
  "reason",
  "attempt",
  "retentionDays",
  "purged",
  "backupAgeHours",
  "backupSizeBytes",
  "configured",
] as const;

export type IntegrationMetadataKey = (typeof INTEGRATION_METADATA_ALLOWLIST)[number];

const FORBIDDEN_KEY_PATTERN =
  /(token|secret|password|authorization|cookie|refresh|access[_-]?token|bot[_-]?token|client[_-]?secret|api[_-]?key|bearer)/i;

const ALLOWLIST_SET = new Set<string>(INTEGRATION_METADATA_ALLOWLIST);

export type IntegrationEventWriteInput = {
  provider: IntegrationProvider;
  operation: string;
  status: IntegrationEventStatus;
  durationMs?: number | null;
  httpStatus?: number | null;
  errorCode?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  region?: WowRegion | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
};

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * Sanitize metadata for durable telemetry storage.
 * - keep allowlisted keys only
 * - reject nested objects/arrays
 * - drop forbidden key names even if somehow allowlisted later
 * - never serialize Error / Response / Request objects
 */
export function sanitizeIntegrationMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, string | number | boolean | null> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  if (metadata instanceof Error) {
    return null;
  }

  const out: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, value] of Object.entries(metadata)) {
    const key = rawKey.trim();
    if (!ALLOWLIST_SET.has(key)) continue;
    if (FORBIDDEN_KEY_PATTERN.test(key)) continue;
    if (!isScalar(value)) continue;
    if (typeof value === "string" && value.length > 500) {
      out[key] = `${value.slice(0, 500)}…`;
      continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function serializeIntegrationMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const sanitized = sanitizeIntegrationMetadata(metadata);
  return sanitized ? JSON.stringify(sanitized) : null;
}

/** Never persist stack traces or arbitrary Error serialization. */
export function safeIntegrationErrorCode(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") {
    const trimmed = error.trim();
    return trimmed ? trimmed.slice(0, 120) : null;
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) return code.trim().slice(0, 120);
  }
  if (error instanceof Error && error.name) {
    return error.name.slice(0, 120);
  }
  return "UNKNOWN";
}

export const INTEGRATION_EVENT_RETENTION_DAYS = 30;
