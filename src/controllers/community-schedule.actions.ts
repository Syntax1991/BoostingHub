"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { communityScheduleService } from "@/services/community-schedule.service";
import {
  communityScheduleSlotIdSchema,
  createCommunityScheduleSlotSchema,
  updateCommunityScheduleSlotSchema,
} from "@/validators/community-schedule";

function revalidateSchedule() {
  revalidatePath("/manage/schedule");
}

export type CreateCommunityScheduleSlotActionResult =
  | { ok: true; message: string; slotId: string }
  | { ok: false; code: string; message: string };

export async function createCommunityScheduleSlotAction(
  input: unknown,
): Promise<CreateCommunityScheduleSlotActionResult> {
  try {
    const user = await requireUser();
    const parsed = createCommunityScheduleSlotSchema.parse(input);
    const created = await communityScheduleService.createSlot(user, parsed);
    revalidateSchedule();
    return { ok: true, message: "Schedule slot created.", slotId: created.id };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function updateCommunityScheduleSlotAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = updateCommunityScheduleSlotSchema.parse(input);
    await communityScheduleService.updateSlot(user, parsed);
    revalidateSchedule();
    return { ok: true, message: "Schedule slot updated." };
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
    await communityScheduleService.reactivateSlot(user, parsed.slotId);
    revalidateSchedule();
    return { ok: true, message: "Schedule slot reactivated." };
  } catch (error) {
    return mapActionError(error);
  }
}
