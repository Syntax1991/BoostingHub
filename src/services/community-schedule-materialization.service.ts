import type { AuthenticatedUser } from "@/auth/authorization";
import {
  canMaterializeCommunityScheduleOccurrence,
  hasAdminAccess,
  isEligibleRaidLead,
} from "@/auth/authorization";
import {
  COMMUNITY_SCHEDULE_TIME_ZONE,
  isBeforeScheduleStart,
  resolveScheduleSlotOccurrence,
  scheduleDraftRelease,
  type RaidIdWindow,
} from "@/lib/community-schedule";
import { classifyRunWeek } from "@/lib/wow-run-week";
import { formatDate } from "@/lib/datetime";
import { DomainError, isDomainError } from "@/lib/errors";
import { communityScheduleRunRepository } from "@/repositories/community-schedule-run.repository";
import {
  communityScheduleRepository,
  type CommunityScheduleSlotRecord,
} from "@/repositories/community-schedule.repository";
import { runTemplateRepository, type RunTemplateRecord } from "@/repositories/run-template.repository";
import { scheduledJobLockRepository } from "@/repositories/scheduled-job-lock.repository";
import { computeUsability } from "@/services/run-template.service";
import { productPlanningService } from "@/services/product-planning.service";
import { integrationEventService } from "@/services/integration-event.service";
import { runService } from "@/services/run.service";

export const COMMUNITY_SCHEDULE_MATERIALIZE_LOCK_KEY = { classId: 837462, objectId: 4 } as const;

export type MaterializePassResult =
  | { status: "SKIPPED_ALREADY_RUNNING"; durationMs: number }
  | {
      status: "COMPLETED";
      slots: number;
      occurrencesConsidered: number;
      created: number;
      alreadyCreated: number;
      skippedPast: number;
      skippedInactive: number;
      skippedNoTemplate: number;
      skippedTemplateUnusable: number;
      /** Occurrences before the slot's activation boundary (firstWindowStartAt). */
      skippedBeforeStart: number;
      failed: number;
      durationMs: number;
    };

export type MaterializeSlotWindowsResult = {
  slots: number;
  occurrencesConsidered: number;
  created: number;
  alreadyCreated: number;
  skippedPast: number;
  skippedInactive: number;
  skippedNoTemplate: number;
  skippedTemplateUnusable: number;
  skippedBeforeStart: number;
  failed: number;
};


/**
 * Weekly Draft release: automatic materialization only ever targets the raid
 * ID released by the latest Monday 12:00 Europe/Berlin (the one starting the
 * following Wednesday 06:00). Before that Monday's release it is still last
 * week's target (already materialized → idempotent); a late / catch-up pass
 * targets the same released raid ID — never the one after it.
 */
export function releasedWindow(now: Date): RaidIdWindow {
  const { targetWindowStartAt } = scheduleDraftRelease(now, COMMUNITY_SCHEDULE_TIME_ZONE);
  const { currentStart } = classifyRunWeek({
    scheduledStartAt: now.toISOString(),
    now,
    timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
  });
  return Date.parse(targetWindowStartAt) <= Date.parse(currentStart) ? "CURRENT" : "NEXT";
}

async function loadTemplateForSlot(
  slot: CommunityScheduleSlotRecord,
  user: AuthenticatedUser | null,
): Promise<RunTemplateRecord> {
  if (!slot.runTemplateId) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_TEMPLATE_REQUIRED",
      "Choose a run template before creating a run.",
      400,
    );
  }
  const template = await runTemplateRepository.findById(slot.runTemplateId);
  if (!template) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_TEMPLATE_INVALID",
      "The linked run template could not be found.",
      400,
    );
  }
  if (user && !hasAdminAccess(user.accountRole) && !isEligibleRaidLead(user)) {
    throw new DomainError("NOT_AUTHORIZED", "You cannot use this template.", 403);
  }
  const usability = computeUsability(template, await productPlanningService.listActive());
  if (!usability.usable) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_TEMPLATE_INVALID",
      usability.unusableReason ?? "This template is no longer usable.",
      400,
    );
  }
  return template;
}

function assertSlotActive(slot: CommunityScheduleSlotRecord): void {
  if (!slot.isActive) {
    throw new DomainError("COMMUNITY_SCHEDULE_SLOT_INACTIVE", "This schedule slot is inactive.", 409);
  }
}

async function recordMaterializePass(result: MaterializePassResult): Promise<void> {
  if (result.status === "SKIPPED_ALREADY_RUNNING") {
    try {
      await integrationEventService.record({
        provider: "SYSTEM",
        operation: "COMMUNITY_SCHEDULE_MATERIALIZE_PASS",
        status: "WARNING",
        durationMs: result.durationMs,
        metadata: { processed: 0, succeeded: 0, failed: 0, skipped: 1, reason: "SKIPPED_ALREADY_RUNNING" },
      });
    } catch {
      // Telemetry must not break the job.
    }
    return;
  }

  const skipped =
    result.alreadyCreated +
    result.skippedPast +
    result.skippedInactive +
    result.skippedNoTemplate +
    result.skippedTemplateUnusable +
    result.skippedBeforeStart;

  try {
    await integrationEventService.record({
      provider: "SYSTEM",
      operation: "COMMUNITY_SCHEDULE_MATERIALIZE_PASS",
      status: result.failed > 0 ? "WARNING" : "SUCCESS",
      durationMs: result.durationMs,
      metadata: {
        processed: result.occurrencesConsidered,
        succeeded: result.created,
        failed: result.failed,
        skipped,
      },
    });
  } catch {
    // Telemetry must not break the job.
  }
}

function emptySlotWindowCounters(): MaterializeSlotWindowsResult {
  return {
    slots: 0,
    occurrencesConsidered: 0,
    created: 0,
    alreadyCreated: 0,
    skippedPast: 0,
    skippedInactive: 0,
    skippedNoTemplate: 0,
    skippedTemplateUnusable: 0,
    skippedBeforeStart: 0,
    failed: 0,
  };
}

/**
 * Materializes the given slots' occurrences in `windows` (SYSTEM actor) — the
 * body of the weekly release pass. Races resolve via the slot lock re-check
 * and UNIQUE(scheduleSlotId, windowStartAt).
 */
async function materializeSlotWindowsInternal(input: {
  slots: ReadonlyArray<CommunityScheduleSlotRecord>;
  windows: ReadonlyArray<RaidIdWindow>;
  now: Date;
}): Promise<MaterializeSlotWindowsResult> {
  const windows = input.windows;
  const counters = emptySlotWindowCounters();
  counters.slots = input.slots.length;

  for (const slot of input.slots) {
    if (!slot.isActive) {
      counters.skippedInactive += windows.length;
      continue;
    }
    if (!slot.autoCreateRun) {
      continue;
    }
    if (!slot.runTemplateId) {
      counters.skippedNoTemplate += windows.length;
      continue;
    }

    let template: RunTemplateRecord | null = null;
    try {
      template = await loadTemplateForSlot(slot, null);
    } catch (error) {
      if (
        isDomainError(error) &&
        (error.code === "COMMUNITY_SCHEDULE_TEMPLATE_INVALID" ||
          error.code === "COMMUNITY_SCHEDULE_TEMPLATE_LEAD_MISMATCH" ||
          error.code === "COMMUNITY_SCHEDULE_TEMPLATE_REQUIRED")
      ) {
        if (error.code === "COMMUNITY_SCHEDULE_TEMPLATE_REQUIRED") {
          counters.skippedNoTemplate += windows.length;
        } else {
          counters.skippedTemplateUnusable += windows.length;
        }
        continue;
      }
      counters.failed += windows.length;
      continue;
    }

    if (!slot.raidLeadEligible) {
      counters.skippedTemplateUnusable += windows.length;
      continue;
    }

    for (const window of windows) {
      counters.occurrencesConsidered += 1;
      try {
        const occurrence = resolveScheduleSlotOccurrence({
          weekday: slot.weekday,
          localStartTime: slot.localStartTime,
          window,
          now: input.now,
          timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
        });

        if (window === "CURRENT" && Date.parse(occurrence.scheduledStartAt) < input.now.getTime()) {
          counters.skippedPast += 1;
          continue;
        }
        // Activation boundary: earlier raid IDs are intentionally never auto-created.
        if (isBeforeScheduleStart(slot.firstWindowStartAt, occurrence.windowStartAt)) {
          counters.skippedBeforeStart += 1;
          continue;
        }

        const existing = await communityScheduleRunRepository.findBySlotAndWindow(
          slot.id,
          occurrence.windowStartAt,
        );
        if (existing) {
          counters.alreadyCreated += 1;
          continue;
        }

        const result = await runService.createScheduleMaterializedRun({
          template: template!,
          scheduledStartAt: occurrence.scheduledStartAt,
          scheduleSlotId: slot.id,
          windowStartAt: occurrence.windowStartAt,
          raidLeadId: slot.raidLeadId,
          slotGuard: { weekday: slot.weekday, localStartTime: slot.localStartTime },
          scheduleSlot: {
            compositionOverrideEnabled: slot.compositionOverrideEnabled,
            desiredTankCountOverride: slot.desiredTankCountOverride,
            desiredHealerCountOverride: slot.desiredHealerCountOverride,
            desiredDpsCountOverride: slot.desiredDpsCountOverride,
            desiredLootbuddyCountOverride: slot.desiredLootbuddyCountOverride,
            discordRolePing: slot.discordRolePing,
          },
          actor: { kind: "SYSTEM" },
        });
        if (result.alreadyExisted) {
          counters.alreadyCreated += 1;
        } else {
          counters.created += 1;
        }
      } catch (error) {
        // Slot edited / deactivated / deleted between listing and the locked insert.
        if (isDomainError(error) && error.code === "COMMUNITY_SCHEDULE_SLOT_CHANGED") {
          counters.skippedInactive += 1;
          continue;
        }
        // Per-window failure: count and continue so NEXT still evaluates after CURRENT.
        counters.failed += 1;
      }
    }
  }

  return counters;
}

export const communityScheduleMaterializationService = {
  async materializeOccurrence(
    actor: { kind: "USER"; user: AuthenticatedUser } | { kind: "SYSTEM" },
    input: { scheduleSlotId: string; window: RaidIdWindow; now?: Date },
  ): Promise<{ runId: string; alreadyExisted: boolean }> {
    const slot = await communityScheduleRepository.findById(input.scheduleSlotId);
    if (!slot) {
      throw new DomainError("COMMUNITY_SCHEDULE_NOT_FOUND", "Schedule slot was not found.", 404);
    }

    if (actor.kind === "USER") {
      if (!canMaterializeCommunityScheduleOccurrence(actor.user, slot)) {
        throw new DomainError("NOT_AUTHORIZED", "You cannot create a run for this schedule slot.", 403);
      }
    }

    assertSlotActive(slot);
    const template = await loadTemplateForSlot(slot, actor.kind === "USER" ? actor.user : null);

    const now = input.now ?? new Date();
    const occurrence = resolveScheduleSlotOccurrence({
      weekday: slot.weekday,
      localStartTime: slot.localStartTime,
      window: input.window,
      now,
      timeZone: COMMUNITY_SCHEDULE_TIME_ZONE,
    });

    if (input.window === "CURRENT" && Date.parse(occurrence.scheduledStartAt) < now.getTime()) {
      throw new DomainError(
        "COMMUNITY_SCHEDULE_OCCURRENCE_PAST",
        "This occurrence has already passed — choose Next Raid ID instead.",
        400,
      );
    }
    if (isBeforeScheduleStart(slot.firstWindowStartAt, occurrence.windowStartAt)) {
      throw new DomainError(
        "COMMUNITY_SCHEDULE_NOT_STARTED",
        `This schedule starts with the raid ID of ${formatDate(slot.firstWindowStartAt!)} — use an existing Run for this occurrence or change the start.`,
        409,
      );
    }

    return runService.createScheduleMaterializedRun({
      template,
      scheduledStartAt: occurrence.scheduledStartAt,
      scheduleSlotId: slot.id,
      windowStartAt: occurrence.windowStartAt,
      raidLeadId: slot.raidLeadId,
      slotGuard: { weekday: slot.weekday, localStartTime: slot.localStartTime },
      scheduleSlot: {
        compositionOverrideEnabled: slot.compositionOverrideEnabled,
        desiredTankCountOverride: slot.desiredTankCountOverride,
        desiredHealerCountOverride: slot.desiredHealerCountOverride,
        desiredDpsCountOverride: slot.desiredDpsCountOverride,
        desiredLootbuddyCountOverride: slot.desiredLootbuddyCountOverride,
        discordRolePing: slot.discordRolePing,
      },
      actor,
    });
  },

  /**
   * The weekly Draft release (timer: Monday 12:00 Europe/Berlin, Persistent).
   * Only ever targets the released raid ID — a late / catch-up / manual pass
   * is idempotent and never materializes the raid ID after it.
   */
  async runPass(now: Date = new Date()): Promise<MaterializePassResult> {
    const started = Date.now();
    const handle = await scheduledJobLockRepository.tryAcquireLock(
      COMMUNITY_SCHEDULE_MATERIALIZE_LOCK_KEY.classId,
      COMMUNITY_SCHEDULE_MATERIALIZE_LOCK_KEY.objectId,
    );
    if (!handle) {
      const skipped: MaterializePassResult = { status: "SKIPPED_ALREADY_RUNNING", durationMs: Date.now() - started };
      await recordMaterializePass(skipped);
      return skipped;
    }

    try {
      const slots = await communityScheduleRepository.listActiveAutoCreateSlots();
      const counters = await materializeSlotWindowsInternal({
        slots,
        now,
        windows: [releasedWindow(now)],
      });
      const completed: MaterializePassResult = {
        status: "COMPLETED",
        ...counters,
        durationMs: Date.now() - started,
      };
      await recordMaterializePass(completed);
      return completed;
    } finally {
      await scheduledJobLockRepository.releaseLock(handle);
    }
  },
};
