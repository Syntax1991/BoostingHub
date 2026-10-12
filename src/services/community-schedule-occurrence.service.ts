import type { AuthenticatedUser } from "@/auth/authorization";
import { canMaterializeCommunityScheduleOccurrence } from "@/auth/authorization";
import {
  COMMUNITY_SCHEDULE_TIME_ZONE,
  isBeforeScheduleStart,
  resolveScheduleSlotOccurrence,
  scheduleOccurrenceInWindowOf,
  type RaidIdWindow,
  type ScheduleOccurrence,
} from "@/lib/community-schedule";
import { formatDate, formatDateTime, formatTime } from "@/lib/datetime";
import { DomainError } from "@/lib/errors";
import { DIFFICULTY_ABBREVIATIONS } from "@/lib/labels";
import { db, orm } from "@/lib/prisma";
import type { RunStatus } from "@/models/enums";
import {
  communityScheduleRunRepository,
  isUniqueViolation,
  type CommunityScheduleRunRecord,
} from "@/repositories/community-schedule-run.repository";
import {
  communityScheduleRepository,
  type CommunityScheduleSlotRecord,
} from "@/repositories/community-schedule.repository";
import { runRepository, type RunListRecord } from "@/repositories/run.repository";
import { runTemplateRepository, type RunTemplateRecord } from "@/repositories/run-template.repository";
import { classifyRunWeek } from "@/lib/wow-run-week";
import { runDomainEventService } from "@/services/run-domain-event.service";

type TxOrm = typeof orm;

/**
 * Runs that may satisfy a Schedule occurrence: still before Start and not
 * archived. CANCELLED / IN_PROGRESS / COMPLETED never qualify.
 */
export const ATTACHABLE_RUN_STATUSES: readonly RunStatus[] = ["DRAFT", "OPEN", "ROSTERING", "PUBLISHED"];

export type AttachWarning = { code: "TIME" | "DIFFICULTY" | "CONTENT" | "RAID_LEAD"; message: string };

export type AttachCandidate = {
  runId: string;
  title: string;
  scheduledStartAt: string;
  status: RunStatus;
  difficulty: RunListRecord["difficulty"];
  contentSummary: string;
  raidLeadName: string;
  /** Raid-ID window of the occurrence this Run would satisfy. */
  windowStartAt: string;
  occurrenceStartAt: string;
  /** Short human label, e.g. "Fri 16/10/2026 20:00 · HC · Venomous Abyss 7/9 · OPEN". */
  label: string;
  warnings: AttachWarning[];
};

function tx(txHandle: unknown): TxOrm {
  const handle = txHandle as { orm: { public?: TxOrm } };
  return (handle.orm.public ?? (handle.orm as unknown as TxOrm)) as TxOrm;
}

function runLabel(run: RunListRecord): string {
  const scope = run.contentDisplay.summary || run.contentDisplay.productLabel;
  return `${formatDateTime(run.scheduledStartAt)} · ${DIFFICULTY_ABBREVIATIONS[run.difficulty]} · ${scope} · ${run.status}`;
}

/** The occurrence of `slot` in the raid ID that contains the Run's start. */
function occurrenceForRun(slot: CommunityScheduleSlotRecord, run: Pick<RunListRecord, "scheduledStartAt">): ScheduleOccurrence {
  return scheduleOccurrenceInWindowOf({
    weekday: slot.weekday,
    localStartTime: slot.localStartTime,
    instant: new Date(run.scheduledStartAt),
    timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
  });
}

/**
 * Differences between the existing Run and the Schedule / Run Setup defaults.
 * Informational only: attaching never rewrites the Run, and future occurrences
 * keep materializing from the Run Setup.
 */
function attachWarnings(
  slot: CommunityScheduleSlotRecord,
  template: RunTemplateRecord | null,
  run: RunListRecord,
  occurrence: ScheduleOccurrence,
): AttachWarning[] {
  const warnings: AttachWarning[] = [];
  if (Date.parse(run.scheduledStartAt) !== Date.parse(occurrence.scheduledStartAt)) {
    warnings.push({
      code: "TIME",
      message: `Starts ${formatDateTime(run.scheduledStartAt)}, the schedule time is ${formatTime(
        occurrence.scheduledStartAt,
      )} — the Run keeps its own time.`,
    });
  }
  if (template && template.difficulty !== run.difficulty) {
    warnings.push({
      code: "DIFFICULTY",
      message: `Difficulty ${DIFFICULTY_ABBREVIATIONS[run.difficulty]} differs from the Run Setup (${
        DIFFICULTY_ABBREVIATIONS[template.difficulty]
      }) — the Run keeps its own.`,
    });
  }
  if (template) {
    const runScope = [...run.contents]
      .map((content) => `${content.raidId}:${content.plannedBossCount}`)
      .sort()
      .join(",");
    const setupScope = [...template.contents]
      .map((content) => `${content.raidId}:${content.plannedBossCount}`)
      .sort()
      .join(",");
    if (runScope !== setupScope) {
      warnings.push({
        code: "CONTENT",
        message: `Raid scope ${run.contentDisplay.summary || run.contentDisplay.productLabel} differs from the Run Setup — the Run keeps its own scope; later occurrences use the Run Setup.`,
      });
    }
  }
  if (run.raidLeadId !== slot.raidLeadId) {
    warnings.push({
      code: "RAID_LEAD",
      message: `Raid Lead ${run.raidLeadName} differs from the schedule's ${slot.raidLeadName}.`,
    });
  }
  return warnings;
}

/** Hard eligibility (shared by listing, attach and create-with-existing-Run). */
function assertRunAttachable(run: RunListRecord | null, now: Date): asserts run is RunListRecord {
  if (!run) {
    throw new DomainError("NOT_FOUND", "Run was not found.", 404);
  }
  if (run.archivedAt) {
    throw new DomainError("COMMUNITY_SCHEDULE_RUN_NOT_ATTACHABLE", "An archived Run cannot be used for a schedule.", 409);
  }
  if (!ATTACHABLE_RUN_STATUSES.includes(run.status)) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_RUN_NOT_ATTACHABLE",
      `A ${run.status} Run cannot be used for a schedule occurrence.`,
      409,
    );
  }
  const currentWindowStart = classifyRunWeek({
    scheduledStartAt: now.toISOString(),
    now,
    timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
  }).currentStart;
  if (Date.parse(run.scheduledStartAt) < Date.parse(currentWindowStart)) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_RUN_NOT_ATTACHABLE",
      "This Run belongs to a past raid ID.",
      409,
    );
  }
}

function mapAttachUniqueViolation(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_OCCURRENCE_FULFILLED",
      "This occurrence already has a Run, or the Run already belongs to a schedule occurrence.",
      409,
    );
  }
  throw error;
}

/**
 * The one attach write: links an existing Run as the occurrence of `slot` in
 * the Run's raid ID (origin ATTACHED). Runs on the caller's transaction so a
 * Schedule create can attach before any auto-create. Never touches the Run.
 * UNIQUE(scheduleSlotId, windowStartAt) and UNIQUE(runId) make a concurrent
 * materialization or second attach lose (exactly one fulfillment).
 */
export async function attachExistingRunInTx(
  txOrm: TxOrm,
  input: { slot: CommunityScheduleSlotRecord; runId: string; actor: AuthenticatedUser; now: Date },
): Promise<CommunityScheduleRunRecord> {
  const run = await runRepository.findById(input.runId);
  assertRunAttachable(run, input.now);
  const occurrence = occurrenceForRun(input.slot, run);

  const runLink = await txOrm.CommunityScheduleRun.where({ runId: run.id }).first();
  if (runLink) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_RUN_ALREADY_ATTACHED",
      "This Run already belongs to a schedule occurrence.",
      409,
    );
  }
  const occurrenceLink = await txOrm.CommunityScheduleRun.where({
    scheduleSlotId: input.slot.id,
    windowStartAt: occurrence.windowStartAt,
  }).first();
  if (occurrenceLink) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_OCCURRENCE_FULFILLED",
      "This schedule occurrence already has a Run.",
      409,
    );
  }

  return communityScheduleRunRepository.create(
    {
      scheduleSlotId: input.slot.id,
      windowStartAt: occurrence.windowStartAt,
      occurrenceStartAt: run.scheduledStartAt,
      runId: run.id,
      createdById: input.actor.id,
      createdByKind: "USER",
      origin: "ATTACHED",
    },
    txOrm,
  );
}

/** Audit after commit — same RunDomainEvent history as other Run lifecycle facts. */
export async function recordRunScheduleAttached(input: {
  actor: AuthenticatedUser;
  slot: CommunityScheduleSlotRecord;
  link: CommunityScheduleRunRecord;
}): Promise<void> {
  await runDomainEventService.record({
    runId: input.link.runId,
    actorUser: input.actor,
    type: "RUN_SCHEDULE_ATTACHED",
    summary: `Used as the ${formatDate(input.link.occurrenceStartAt)} occurrence of schedule "${input.slot.label}".`,
    payload: {
      scheduleSlotId: input.slot.id,
      windowStartAt: input.link.windowStartAt,
    },
  });
}

export const communityScheduleOccurrenceService = {
  /**
   * Eligible existing Runs for the slot's CURRENT / NEXT occurrences that are
   * not fulfilled yet (attach candidates), with non-blocking warnings.
   * `slot` may be a draft (create dialog) — then only weekday / time / lead /
   * template are used.
   */
  async listAttachCandidates(
    user: AuthenticatedUser,
    input: {
      slot: Pick<CommunityScheduleSlotRecord, "weekday" | "localStartTime" | "raidLeadId" | "runTemplateId"> &
        Partial<Pick<CommunityScheduleSlotRecord, "id" | "raidLeadName">>;
      windows?: readonly RaidIdWindow[];
      now?: Date;
    },
  ): Promise<AttachCandidate[]> {
    if (!canMaterializeCommunityScheduleOccurrence(user, input.slot)) {
      throw new DomainError("NOT_AUTHORIZED", "You cannot manage this schedule.", 403);
    }
    const now = input.now ?? new Date();
    const slot = {
      id: "",
      raidLeadName: "",
      ...input.slot,
    } as CommunityScheduleSlotRecord;
    const template = slot.runTemplateId ? await runTemplateRepository.findById(slot.runTemplateId) : null;

    const occurrences = (input.windows ?? (["CURRENT", "NEXT"] as const))
      .map((window) =>
        resolveScheduleSlotOccurrence({
          weekday: slot.weekday,
          localStartTime: slot.localStartTime,
          window,
          now,
          timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
        }),
      )
      .filter((occurrence) => Date.parse(occurrence.windowEndAt) > now.getTime());

    const fulfilled = new Set(
      slot.id
        ? (await communityScheduleRunRepository.listBySlotIds([slot.id])).map((link) => link.windowStartAt)
        : [],
    );

    const candidates: AttachCandidate[] = [];
    for (const occurrence of occurrences) {
      if (fulfilled.has(occurrence.windowStartAt)) continue;
      const ids = await runRepository.listIdsStartingBetween(
        occurrence.windowStartAt,
        occurrence.windowEndAt,
        ATTACHABLE_RUN_STATUSES,
      );
      const runs = await runRepository.listManagedByIds(ids);
      for (const run of runs) {
        if (await communityScheduleRunRepository.findByRunId(run.id)) continue;
        candidates.push({
          runId: run.id,
          title: run.title,
          scheduledStartAt: run.scheduledStartAt,
          status: run.status,
          difficulty: run.difficulty,
          contentSummary: run.contentDisplay.summary || run.contentDisplay.productLabel,
          raidLeadName: run.raidLeadName,
          windowStartAt: occurrence.windowStartAt,
          occurrenceStartAt: occurrence.scheduledStartAt,
          label: runLabel(run),
          warnings: attachWarnings(slot, template, run, occurrence),
        });
      }
    }
    // Closest to the schedule time first.
    candidates.sort(
      (a, b) =>
        Math.abs(Date.parse(a.scheduledStartAt) - Date.parse(a.occurrenceStartAt)) -
          Math.abs(Date.parse(b.scheduledStartAt) - Date.parse(b.occurrenceStartAt)) ||
        a.scheduledStartAt.localeCompare(b.scheduledStartAt),
    );
    return candidates;
  },

  /** Schedule-side "Use existing Run" for an existing slot. */
  async attachExistingRun(
    user: AuthenticatedUser,
    input: { scheduleSlotId: string; runId: string; now?: Date },
  ): Promise<CommunityScheduleRunRecord> {
    const slot = await communityScheduleRepository.findById(input.scheduleSlotId);
    if (!slot) {
      throw new DomainError("COMMUNITY_SCHEDULE_NOT_FOUND", "Schedule slot was not found.", 404);
    }
    if (!canMaterializeCommunityScheduleOccurrence(user, slot)) {
      throw new DomainError("NOT_AUTHORIZED", "You cannot manage this schedule.", 403);
    }
    if (!slot.isActive) {
      throw new DomainError("COMMUNITY_SCHEDULE_SLOT_INACTIVE", "This schedule slot is inactive.", 409);
    }
    const now = input.now ?? new Date();
    let link: CommunityScheduleRunRecord;
    try {
      link = await db.transaction(async (handle) =>
        attachExistingRunInTx(tx(handle), { slot, runId: input.runId, actor: user, now }),
      );
    } catch (error) {
      mapAttachUniqueViolation(error);
    }
    await recordRunScheduleAttached({ actor: user, slot, link });
    return link;
  },
};

export { isBeforeScheduleStart, mapAttachUniqueViolation };
