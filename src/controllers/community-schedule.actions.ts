"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { communityScheduleMaterializationService } from "@/services/community-schedule-materialization.service";
import { communityScheduleService } from "@/services/community-schedule.service";
import {
  communityScheduleOccurrenceService,
  type AttachCandidate,
} from "@/services/community-schedule-occurrence.service";
import { communityScheduleRepository } from "@/repositories/community-schedule.repository";
import { DomainError } from "@/lib/errors";
import {
  addScheduleTimesSchema,
  attachScheduleRunSchema,
  communityScheduleSlotIdSchema,
  listScheduleAttachCandidatesSchema,
  createCommunityScheduleSlotSchema,
  createSchedulePlanSchema,
  deleteCommunityScheduleRunSetupSchema,
  materializeCommunityScheduleOccurrenceSchema,
  updateCommunityScheduleSlotSchema,
} from "@/validators/community-schedule";
import { createRunTemplateSchema, updateRunTemplateSchema } from "@/validators/run-template";

function revalidateSchedule() {
  revalidatePath("/manage/schedule");
  revalidatePath("/manage/templates");
}

function withMaterializationMessage(base: string, warning: string | null): string {
  return warning ? `${base} ${warning}` : base;
}

export type CreateCommunityScheduleSlotActionResult =
  | { ok: true; message: string; slotId: string }
  | { ok: false; code: string; message: string };

export type CreateCommunitySchedulePlanActionResult =
  | { ok: true; message: string; templateId: string; slotIds: string[] }
  | { ok: false; code: string; message: string };

export type AddCommunityScheduleTimesActionResult =
  | { ok: true; message: string; templateId: string; slotIds: string[] }
  | { ok: false; code: string; message: string };

export async function createCommunityScheduleSlotAction(
  input: unknown,
): Promise<CreateCommunityScheduleSlotActionResult> {
  try {
    const user = await requireUser();
    const parsed = createCommunityScheduleSlotSchema.parse(input);
    const result = await communityScheduleService.createSlot(user, parsed);
    revalidateSchedule();
    return {
      ok: true,
      message: withMaterializationMessage("Schedule slot created.", result.materialization.warning),
      slotId: result.slot.id,
    };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function createCommunitySchedulePlanAction(
  input: unknown,
): Promise<CreateCommunitySchedulePlanActionResult> {
  try {
    const user = await requireUser();
    const parsed = createSchedulePlanSchema.parse(input);
    const result = await communityScheduleService.createSchedulePlan(user, parsed);
    revalidateSchedule();
    return {
      ok: true,
      message: withMaterializationMessage(
        `Schedule created with ${result.slotIds.length} weekly time${result.slotIds.length === 1 ? "" : "s"}.`,
        result.materialization.warning,
      ),
      templateId: result.templateId,
      slotIds: result.slotIds,
    };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function addCommunityScheduleTimesAction(
  input: unknown,
): Promise<AddCommunityScheduleTimesActionResult> {
  try {
    const user = await requireUser();
    const parsed = addScheduleTimesSchema.parse(input);
    const result = await communityScheduleService.addTimesToSetup(user, parsed);
    revalidateSchedule();
    return {
      ok: true,
      message: withMaterializationMessage(
        `Added ${result.slotIds.length} weekly time${result.slotIds.length === 1 ? "" : "s"}.`,
        result.materialization.warning,
      ),
      templateId: result.templateId,
      slotIds: result.slotIds,
    };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function updateCommunityScheduleRunSetupAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = updateRunTemplateSchema.parse(input);
    await communityScheduleService.updateRunSetup(user, parsed);
    revalidateSchedule();
    revalidatePath("/profile/templates");
    return { ok: true, message: "Run Setup updated." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function updateCommunityScheduleSlotAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = updateCommunityScheduleSlotSchema.parse(input);
    const result = await communityScheduleService.updateSlot(user, parsed);
    revalidateSchedule();
    return {
      ok: true,
      message: withMaterializationMessage("Schedule slot updated.", result.materialization.warning),
    };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function deactivateCommunityScheduleSlotAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = communityScheduleSlotIdSchema.parse(input);
    await communityScheduleService.deactivateSlot(user, parsed.slotId);
    revalidateSchedule();
    return { ok: true, message: "Schedule slot deactivated." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function reactivateCommunityScheduleSlotAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = communityScheduleSlotIdSchema.parse(input);
    const result = await communityScheduleService.reactivateSlot(user, parsed.slotId);
    revalidateSchedule();
    return {
      ok: true,
      message: withMaterializationMessage("Schedule slot reactivated.", result.materialization.warning),
    };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function deleteCommunityScheduleSlotAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = communityScheduleSlotIdSchema.parse(input);
    await communityScheduleService.deleteSlot(user, parsed.slotId);
    revalidateSchedule();
    return { ok: true, message: "Schedule time deleted. Existing Runs were not changed." };
  } catch (error) {
    return mapActionError(error);
  }
}

export type DeleteCommunityScheduleRunSetupActionResult =
  | { ok: true; message: string; deletedSlotCount: number }
  | { ok: false; code: string; message: string };

export async function deleteCommunityScheduleRunSetupAction(
  input: unknown,
): Promise<DeleteCommunityScheduleRunSetupActionResult> {
  try {
    const user = await requireUser();
    const parsed = deleteCommunityScheduleRunSetupSchema.parse(input);
    const result = await communityScheduleService.deleteRunSetup(user, parsed.runTemplateId);
    revalidateSchedule();
    revalidatePath("/profile/templates");
    return {
      ok: true,
      message:
        result.deletedSlotCount === 0
          ? "Run Setup deleted. Existing Runs were not changed."
          : `Run Setup and ${result.deletedSlotCount} Schedule time${result.deletedSlotCount === 1 ? "" : "s"} deleted. Existing Runs were not changed.`,
      deletedSlotCount: result.deletedSlotCount,
    };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function createCommunityScheduleRunSetupAction(
  input: unknown,
): Promise<{ ok: true; message: string; templateId: string } | { ok: false; code: string; message: string }> {
  try {
    const user = await requireUser();
    const parsed = createRunTemplateSchema.parse(input);
    const created = await communityScheduleService.createRunSetup(user, parsed);
    revalidateSchedule();
    revalidatePath("/profile/templates");
    revalidatePath("/manage/templates");
    return { ok: true, message: "Run Setup created.", templateId: created.id };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function duplicateCommunityScheduleRunSetupAction(
  input: unknown,
): Promise<{ ok: true; message: string; templateId: string } | { ok: false; code: string; message: string }> {
  try {
    const user = await requireUser();
    const parsed = deleteCommunityScheduleRunSetupSchema.parse(input);
    const created = await communityScheduleService.duplicateRunSetup(user, parsed.runTemplateId);
    revalidateSchedule();
    revalidatePath("/profile/templates");
    revalidatePath("/manage/templates");
    return { ok: true, message: "Run Setup duplicated.", templateId: created.id };
  } catch (error) {
    return mapActionError(error);
  }
}

export type MaterializeCommunityScheduleOccurrenceActionResult =
  | { ok: true; message: string; runId: string; alreadyExisted: boolean }
  | { ok: false; code: string; message: string };

export async function materializeCommunityScheduleOccurrenceAction(
  input: unknown,
): Promise<MaterializeCommunityScheduleOccurrenceActionResult> {
  try {
    const user = await requireUser();
    const parsed = materializeCommunityScheduleOccurrenceSchema.parse(input);
    const result = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "USER", user },
      { scheduleSlotId: parsed.scheduleSlotId, window: parsed.window },
    );
    revalidateSchedule();
    revalidatePath("/manage/runs");
    return {
      ok: true,
      message: result.alreadyExisted
        ? "A run draft already exists for this occurrence."
        : "Run draft created from schedule.",
      runId: result.runId,
      alreadyExisted: result.alreadyExisted,
    };
  } catch (error) {
    return mapActionError(error);
  }
}

export type ListScheduleAttachCandidatesActionResult =
  | { ok: true; candidates: AttachCandidate[] }
  | { ok: false; code: string; message: string };

/**
 * Existing Runs that may satisfy an occurrence — for an existing slot
 * (Schedule view) or a draft weekday / time / lead (create dialogs).
 */
export async function listScheduleAttachCandidatesAction(
  input: unknown,
): Promise<ListScheduleAttachCandidatesActionResult> {
  try {
    const user = await requireUser();
    const parsed = listScheduleAttachCandidatesSchema.parse(input);
    if ("scheduleSlotId" in parsed) {
      const slot = await communityScheduleRepository.findById(parsed.scheduleSlotId);
      if (!slot) {
        throw new DomainError("COMMUNITY_SCHEDULE_NOT_FOUND", "Schedule slot was not found.", 404);
      }
      const candidates = await communityScheduleOccurrenceService.listAttachCandidates(user, {
        slot,
        windows: parsed.window ? [parsed.window] : undefined,
      });
      return { ok: true, candidates };
    }
    const candidates = await communityScheduleOccurrenceService.listAttachCandidates(user, {
      slot: {
        weekday: parsed.weekday,
        localStartTime: parsed.localStartTime,
        raidLeadId: parsed.raidLeadId,
        runTemplateId: parsed.runTemplateId,
      },
    });
    return { ok: true, candidates };
  } catch (error) {
    return mapActionError(error);
  }
}

export type AttachScheduleRunActionResult =
  | { ok: true; message: string; runId: string }
  | { ok: false; code: string; message: string };

/** Schedule-side "Use existing Run": the occurrence is satisfied by an existing Run (never rewritten). */
export async function attachScheduleRunAction(input: unknown): Promise<AttachScheduleRunActionResult> {
  try {
    const user = await requireUser();
    const parsed = attachScheduleRunSchema.parse(input);
    const link = await communityScheduleOccurrenceService.attachExistingRun(user, parsed);
    revalidateSchedule();
    revalidatePath("/manage/runs");
    revalidatePath(`/runs/${link.runId}`);
    return { ok: true, message: "Existing Run linked to this schedule occurrence.", runId: link.runId };
  } catch (error) {
    return mapActionError(error);
  }
}
