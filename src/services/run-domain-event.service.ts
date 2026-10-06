import {
  normalizeRunDomainEventActor,
  type RunDomainEventWriteInput,
} from "@/lib/run-domain-event";
import { runDomainEventRepository, type RunDomainEventRecord } from "@/repositories/run-domain-event.repository";
import { userRepository } from "@/repositories/user.repository";
import type { AuthenticatedUser } from "@/auth/authorization";
import type { RunDomainEventType } from "@/models/enums";

export type RecordRunDomainEventInput = {
  runId: string;
  type: RunDomainEventType;
  summary: string;
  payload?: Record<string, unknown> | null;
  /** When omitted with a user actor, actorKind defaults to USER. */
  actorUser?: AuthenticatedUser | { id: string } | null;
  actorKind?: "USER" | "SYSTEM";
};

export type RunDomainEventView = RunDomainEventRecord & {
  actorName: string | null;
  /** Safe parsed payload for optional detail expansion. */
  payload: Record<string, string | number | boolean | null> | null;
};

function parsePayload(payloadJson: string | null): RunDomainEventView["payload"] {
  if (!payloadJson) return null;
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, string | number | boolean | null>;
  } catch {
    return null;
  }
}

/**
 * Run-scoped business audit trail writer.
 * Call sites should pass meaningful lifecycle events only.
 */
export const runDomainEventService = {
  async record(input: RecordRunDomainEventInput): Promise<RunDomainEventRecord> {
    const actorKind = input.actorKind ?? (input.actorUser ? "USER" : "SYSTEM");
    const write: RunDomainEventWriteInput = {
      runId: input.runId,
      type: input.type,
      summary: input.summary,
      payload: input.payload,
      ...normalizeRunDomainEventActor({
        actorKind,
        actorUserId: actorKind === "USER" ? (input.actorUser?.id ?? null) : null,
      }),
    };
    return runDomainEventRepository.create(write);
  },

  async listForRun(runId: string, limit = 50, offset = 0): Promise<RunDomainEventView[]> {
    const rows = await runDomainEventRepository.listForRun(runId, limit, offset);
    const actorIds = [...new Set(rows.map((row) => row.actorUserId).filter((id): id is string => Boolean(id)))];
    const nameById = new Map<string, string>();
    await Promise.all(
      actorIds.map(async (id) => {
        const user = await userRepository.findById(id);
        if (user) nameById.set(id, user.name);
      }),
    );
    return rows.map((row) => ({
      ...row,
      actorName: row.actorKind === "SYSTEM" ? "System" : (row.actorUserId ? nameById.get(row.actorUserId) ?? "Unknown user" : null),
      payload: parsePayload(row.payloadJson),
    }));
  },
};
