import type { RunDomainEventActorKind, RunDomainEventType } from "@/models/enums";

/**
 * Allowlisted RunDomainEvent.payload keys for optional before/after detail.
 * Nested objects/arrays are rejected. Never secrets or Discord message bodies.
 */
export const RUN_DOMAIN_EVENT_PAYLOAD_ALLOWLIST = [
  "fromStatus",
  "toStatus",
  "fromScheduledStartAt",
  "toScheduledStartAt",
  "fromRaidLeadId",
  "toRaidLeadId",
  "fromRaidLeadName",
  "toRaidLeadName",
  "signupsOpen",
  "selectedCount",
  "externalBoosterCount",
  "scheduleRevision",
  "cancelRevision",
  "contentSummary",
  "difficulty",
  "lootType",
  "reason",
] as const;

export type RunDomainEventPayloadKey = (typeof RUN_DOMAIN_EVENT_PAYLOAD_ALLOWLIST)[number];

const FORBIDDEN_KEY_PATTERN =
  /(token|secret|password|authorization|cookie|refresh|access[_-]?token|bot[_-]?token|client[_-]?secret|api[_-]?key|bearer)/i;

const ALLOWLIST_SET = new Set<string>(RUN_DOMAIN_EVENT_PAYLOAD_ALLOWLIST);

export type RunDomainEventWriteInput = {
  runId: string;
  actorKind: RunDomainEventActorKind;
  actorUserId?: string | null;
  type: RunDomainEventType | string;
  summary: string;
  payload?: Record<string, unknown> | null;
  occurredAt?: string;
};

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * Sanitize payload for durable Run audit storage.
 * - allowlisted keys only
 * - reject nested objects/arrays and Error instances
 * - drop forbidden credential-like key names
 */
export function sanitizeRunDomainEventPayload(
  payload: Record<string, unknown> | null | undefined,
): Record<string, string | number | boolean | null> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  if (payload instanceof Error) {
    return null;
  }

  const out: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, value] of Object.entries(payload)) {
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

export function serializeRunDomainEventPayload(
  payload: Record<string, unknown> | null | undefined,
): string | null {
  const sanitized = sanitizeRunDomainEventPayload(payload);
  return sanitized ? JSON.stringify(sanitized) : null;
}

/** USER actor requires actorUserId; SYSTEM must not invent one. */
export function normalizeRunDomainEventActor(input: {
  actorKind: RunDomainEventActorKind;
  actorUserId?: string | null;
}): { actorKind: RunDomainEventActorKind; actorUserId: string | null } {
  if (input.actorKind === "SYSTEM") {
    return { actorKind: "SYSTEM", actorUserId: null };
  }
  const actorUserId = input.actorUserId?.trim() || null;
  if (!actorUserId) {
    throw new Error("USER RunDomainEvent requires actorUserId.");
  }
  return { actorKind: "USER", actorUserId };
}
