import {
  normalizeRunDomainEventActor,
  type RunDomainEventWriteInput,
} from "@/lib/run-domain-event";
import { runDomainEventRepository, type RunDomainEventRecord } from "@/repositories/run-domain-event.repository";
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

  async listForRun(runId: string, limit = 50, offset = 0): Promise<RunDomainEventRecord[]> {
    return runDomainEventRepository.listForRun(runId, limit, offset);
  },
};
