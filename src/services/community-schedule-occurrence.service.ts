import type { AuthenticatedUser } from "@/auth/authorization";
import {
  canManageCommunitySchedule,
  canMaterializeCommunityScheduleOccurrence,
} from "@/auth/authorization";
import {
  COMMUNITY_SCHEDULE_TIME_ZONE,
  isBeforeScheduleStart,
  resolveScheduleSlotOccurrence,
  resolveScheduleStartBoundary,
  scheduleOccurrenceInWindowOf,
  scheduleTimeOfInstant,
  type RaidIdWindow,
  type ScheduleOccurrence,
  type ScheduleStart,
} from "@/lib/community-schedule";
import { formatDate, formatDateTime, formatTime } from "@/lib/datetime";
import { DomainError } from "@/lib/errors";
import { DIFFICULTY_ABBREVIATIONS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
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
import type { CommunityWeekday } from "@/models/enums";
import { userRepository } from "@/repositories/user.repository";
import { productPlanningService } from "@/services/product-planning.service";
import { runDomainEventService } from "@/services/run-domain-event.service";
import { computeUsability } from "@/services/run-template.service";

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
  if (isBeforeScheduleStart(input.slot.firstWindowStartAt, occurrence.windowStartAt)) {
    throw new DomainError(
      "COMMUNITY_SCHEDULE_NOT_STARTED",
      "This Run falls before the schedule's start — it cannot be used as an occurrence.",
      409,
    );
  }

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

// ---------------------------------------------------------------------------
// Adopting an existing Run as the source of a Schedule's configuration.
//
// A Run carries no Run Setup reference (no RunTemplate FK; Schedule-created
// Runs are linked via CommunityScheduleRun and therefore never attachable
// again). So the Run Setup is resolved from the Run's own planning snapshot:
// an active, usable Run Setup with exactly the same planning fields
// (difficulty, loot, ordered RunRaidContent incl. boss counts, composition) is
// reused; otherwise one new Run Setup is snapshotted from the Run. One-time
// copy — no live coupling in either direction. Never Product-key matching,
// never derived from roster / signups.
// ---------------------------------------------------------------------------

export type RunSetupAdoption =
  | { mode: "existing"; templateId: string; templateName: string }
  | { mode: "fromRun"; templateName: string };

export type AdoptionCandidate = {
  runId: string;
  label: string;
  scheduledStartAt: string;
  /** Raid-ID window the Run fulfils (its first Schedule occurrence). */
  windowStartAt: string;
  weekday: CommunityWeekday;
  localStartTime: string;
  /** The Run's Raid Lead when still eligible; null → the user must choose one. */
  raidLeadId: string | null;
  raidLeadName: string;
  runSetup: RunSetupAdoption;
  /** The Run's "Ping roles" — taken over by a Schedule based on this Run. */
  discordRolePing: boolean;
};

type RunPlanningSnapshot = {
  difficulty: RunListRecord["difficulty"];
  lootType: RunListRecord["lootType"];
  contents: Array<{ raidId: string; sortOrder: number; plannedBossCount: number }>;
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  desiredLootbuddyCount: number;
};

/** Reusable planning fields of a concrete Run — RunRaidContent + planned composition only. */
function runPlanningSnapshot(run: RunListRecord): RunPlanningSnapshot {
  return {
    difficulty: run.difficulty,
    lootType: run.lootType,
    contents: [...run.contents]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((content, index) => ({
        raidId: content.raidId,
        sortOrder: index + 1,
        plannedBossCount: content.plannedBossCount,
      })),
    desiredTankCount: run.desiredTankCount,
    desiredHealerCount: run.desiredHealerCount,
    desiredDpsCount: run.desiredDpsCount,
    desiredLootbuddyCount: run.desiredLootbuddyCount,
  };
}

function setupEquals(template: RunTemplateRecord, snapshot: RunPlanningSnapshot): boolean {
  const contents = [...template.contents].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    template.difficulty === snapshot.difficulty &&
    template.lootType === snapshot.lootType &&
    template.desiredTankCount === snapshot.desiredTankCount &&
    template.desiredHealerCount === snapshot.desiredHealerCount &&
    template.desiredDpsCount === snapshot.desiredDpsCount &&
    template.desiredLootbuddyCount === snapshot.desiredLootbuddyCount &&
    contents.length === snapshot.contents.length &&
    contents.every(
      (content, index) =>
        content.raidId === snapshot.contents[index]!.raidId &&
        content.plannedBossCount === snapshot.contents[index]!.plannedBossCount,
    )
  );
}

function adoptedSetupName(run: RunListRecord): string {
  const scope = run.contentDisplay.summary || run.contentDisplay.productLabel;
  return `${DIFFICULTY_ABBREVIATIONS[run.difficulty]} ${RUN_LOOT_TYPE_LABELS[run.lootType]} · ${scope}`.slice(0, 80);
}

/** Active, usable Run Setup with the same planning fields (most recently updated first), or null. */
async function findEquivalentSetup(run: RunListRecord): Promise<RunTemplateRecord | null> {
  const snapshot = runPlanningSnapshot(run);
  const activeProducts = await productPlanningService.listActive();
  const matches = (await runTemplateRepository.listAll())
    .filter((template) => template.isActive && setupEquals(template, snapshot))
    .filter((template) => computeUsability(template, activeProducts).usable)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  return matches[0] ?? null;
}

async function resolveRunSetupAdoption(run: RunListRecord): Promise<RunSetupAdoption> {
  const equivalent = await findEquivalentSetup(run);
  return equivalent
    ? { mode: "existing", templateId: equivalent.id, templateName: equivalent.name }
    : { mode: "fromRun", templateName: adoptedSetupName(run) };
}

/**
 * Resolves the Run Setup a new Schedule adopts from `runId` inside the
 * caller's transaction: the equivalent existing setup, or one new setup
 * snapshotted from the Run (RunRaidContent → RunTemplateRaidContent, planned
 * composition). The Run itself is only read.
 */
export async function adoptRunSetupInTx(
  txOrm: TxOrm,
  input: { runId: string; actor: AuthenticatedUser },
): Promise<{ templateId: string; templateName: string; created: boolean }> {
  const run = await runRepository.findById(input.runId);
  if (!run) {
    throw new DomainError("NOT_FOUND", "Run was not found.", 404);
  }
  const equivalent = await findEquivalentSetup(run);
  if (equivalent) {
    return { templateId: equivalent.id, templateName: equivalent.name, created: false };
  }
  const snapshot = runPlanningSnapshot(run);
  const templateName = adoptedSetupName(run);
  const templateId = await runTemplateRepository.create(
    {
      name: templateName,
      ...snapshot,
      notes: `Created from the existing Run "${run.title}".`,
      createdById: input.actor.id,
      updatedById: input.actor.id,
    },
    txOrm,
  );
  return { templateId, templateName, created: true };
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
        Partial<Pick<CommunityScheduleSlotRecord, "id" | "raidLeadName" | "firstWindowStartAt">>;
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
      ...input.slot,
      // A draft slot (create dialogs) carries only the lead id — the Raid Lead warning needs the name.
      raidLeadName:
        input.slot.raidLeadName ?? (await userRepository.findById(input.slot.raidLeadId))?.name ?? "the selected Raid Lead",
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
      .filter((occurrence) => Date.parse(occurrence.windowEndAt) > now.getTime())
      // Occurrences before the schedule's start boundary do not exist — nothing to attach.
      .filter((occurrence) => !isBeforeScheduleStart(slot.firstWindowStartAt ?? null, occurrence.windowStartAt));

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

  /**
   * Existing Runs a NEW Schedule time can start from ("Use existing Run" in
   * Create Schedule / Add times), each with the configuration it would adopt:
   * weekday / time (Europe/Berlin), Raid Lead (when still eligible) and Run
   * Setup. Same hard eligibility as attach, upcoming only, and never before the
   * chosen start boundary.
   */
  async listAdoptionCandidates(
    user: AuthenticatedUser,
    input: { start?: ScheduleStart; now?: Date } = {},
  ): Promise<AdoptionCandidate[]> {
    if (!canManageCommunitySchedule(user.accountRole)) {
      throw new DomainError("NOT_AUTHORIZED", "You cannot manage this schedule.", 403);
    }
    const now = input.now ?? new Date();
    // Every upcoming Run is a candidate — no raid-ID window limit (a basis Run
    // may be several raid IDs ahead). There is no other planning horizon.
    const ids = await runRepository.listIdsStartingFrom(now.toISOString(), ATTACHABLE_RUN_STATUSES);
    const runs = await runRepository.listManagedByIds(ids);
    // Only still-eligible Raid Leads are adopted; otherwise the user must choose one.
    const leads = new Map((await userRepository.listEligibleRaidLeads()).map((lead) => [lead.id, lead]));

    const candidates: AdoptionCandidate[] = [];
    for (const run of runs) {
      if (Date.parse(run.scheduledStartAt) <= now.getTime()) continue;
      if (await communityScheduleRunRepository.findByRunId(run.id)) continue;
      const time = scheduleTimeOfInstant(run.scheduledStartAt);
      const occurrence = scheduleOccurrenceInWindowOf({ ...time, instant: new Date(run.scheduledStartAt) });
      const boundary = input.start
        ? resolveScheduleStartBoundary({ ...time, start: input.start, now }).firstWindowStartAt
        : null;
      if (isBeforeScheduleStart(boundary, occurrence.windowStartAt)) continue;
      const lead = leads.get(run.raidLeadId);
      candidates.push({
        runId: run.id,
        label: `${runLabel(run)} · ${run.raidLeadName}`,
        scheduledStartAt: run.scheduledStartAt,
        windowStartAt: occurrence.windowStartAt,
        ...time,
        raidLeadId: lead ? lead.id : null,
        raidLeadName: run.raidLeadName,
        runSetup: await resolveRunSetupAdoption(run),
        discordRolePing: run.discordRolePing,
      });
    }
    candidates.sort((a, b) => a.scheduledStartAt.localeCompare(b.scheduledStartAt));
    return candidates;
  },

  /**
   * Schedule-side "Use existing Run" for an existing slot. Attaches only; the
   * Schedule's configuration changes solely with the explicit `adoptSetup`
   * (then future occurrences use the Run's Run Setup — equivalent or snapshot).
   */
  async attachExistingRun(
    user: AuthenticatedUser,
    input: { scheduleSlotId: string; runId: string; adoptSetup?: boolean; now?: Date },
  ): Promise<CommunityScheduleRunRecord> {
    const existing = await communityScheduleRepository.findById(input.scheduleSlotId);
    if (!existing) {
      throw new DomainError("COMMUNITY_SCHEDULE_NOT_FOUND", "Schedule slot was not found.", 404);
    }
    if (!canMaterializeCommunityScheduleOccurrence(user, existing)) {
      throw new DomainError("NOT_AUTHORIZED", "You cannot manage this schedule.", 403);
    }
    const now = input.now ?? new Date();
    let attached: { slot: CommunityScheduleSlotRecord; link: CommunityScheduleRunRecord };
    try {
      attached = await db.transaction(async (handle) => {
        const txOrm = tx(handle);
        // Lock + re-read: serializes with Schedule edits (time / start / deactivation).
        const slot = await communityScheduleRepository.lockInTx(input.scheduleSlotId, txOrm);
        if (!slot) {
          throw new DomainError("COMMUNITY_SCHEDULE_NOT_FOUND", "Schedule slot was not found.", 404);
        }
        if (!slot.isActive) {
          throw new DomainError("COMMUNITY_SCHEDULE_SLOT_INACTIVE", "This schedule slot is inactive.", 409);
        }
        const link = await attachExistingRunInTx(txOrm, { slot, runId: input.runId, actor: user, now });
        if (input.adoptSetup) {
          const adopted = await adoptRunSetupInTx(txOrm, { runId: input.runId, actor: user });
          await communityScheduleRepository.setRunTemplateInTx(slot.id, adopted.templateId, user.id, txOrm);
        }
        return { slot, link };
      });
    } catch (error) {
      mapAttachUniqueViolation(error);
    }
    await recordRunScheduleAttached({ actor: user, slot: attached.slot, link: attached.link });
    return attached.link;
  },
};

export { isBeforeScheduleStart, mapAttachUniqueViolation };
