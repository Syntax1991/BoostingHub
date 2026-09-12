"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { runService } from "@/services/run.service";
import { runIdSchema, updateRunSchema } from "@/validators/run";
import { createManyRunsSchema } from "@/validators/mass-create-runs";

function revalidateRunSurfaces(runId?: string) {
  revalidatePath("/runs");
  revalidatePath("/my-runs");
  revalidatePath("/manage/runs");
  revalidatePath("/dashboard");
  if (runId) {
    revalidatePath(`/runs/${runId}`);
  }
}

// Note: there is no single-Run createRunAction anymore — Run creation is one
// canonical workflow (createManyRunsAction, 1-25 rows) at /manage/runs/create.
// runService.createRun / createRunSchema remain for internal/test use only.

export type CreateManyRunsActionResult =
  | { ok: true; message: string; runIds: string[] }
  | { ok: false; code: string; message: string };

export async function createManyRunsAction(input: unknown): Promise<CreateManyRunsActionResult> {
  try {
    const user = await requireUser();
    const parsed = createManyRunsSchema.parse(input);
    const created = await runService.createManyRuns(user, parsed);
    revalidateRunSurfaces();
    const count = created.ids.length;
    return { ok: true, message: `Created ${count} run draft${count === 1 ? "" : "s"}.`, runIds: created.ids };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function updateRunAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = updateRunSchema.parse(input);
    await runService.updateRun(user, parsed);
    revalidateRunSurfaces(parsed.runId);
    return { ok: true, message: "Run updated." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function openRunAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = runIdSchema.parse(input);
    await runService.openRun(user, parsed.runId);
    revalidateRunSurfaces(parsed.runId);
    return { ok: true, message: "Run opened. Signups are now open." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function closeRunSignupsAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = runIdSchema.parse(input);
    await runService.setSignupWindow(user, parsed.runId, false);
    revalidateRunSurfaces(parsed.runId);
    return { ok: true, message: "Signup window closed." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function reopenRunSignupsAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = runIdSchema.parse(input);
    await runService.setSignupWindow(user, parsed.runId, true);
    revalidateRunSurfaces(parsed.runId);
    return { ok: true, message: "Signup window reopened." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function cancelRunAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = runIdSchema.parse(input);
    await runService.cancelRun(user, parsed.runId);
    revalidateRunSurfaces(parsed.runId);
    return { ok: true, message: "Run cancelled." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function startRunAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = runIdSchema.parse(input);
    await runService.startRun(user, parsed.runId);
    revalidateRunSurfaces(parsed.runId);
    return { ok: true, message: "Run started. Attendance is ready to mark." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function completeRunAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = runIdSchema.parse(input);
    await runService.completeRun(user, parsed.runId);
    revalidateRunSurfaces(parsed.runId);
    return { ok: true, message: "Run completed." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function archiveRunAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = runIdSchema.parse(input);
    await runService.archiveRun(user, parsed.runId);
    revalidateRunSurfaces(parsed.runId);
    return { ok: true, message: "Run archived." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function restoreRunAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = runIdSchema.parse(input);
    await runService.restoreRun(user, parsed.runId);
    revalidateRunSurfaces(parsed.runId);
    return { ok: true, message: "Run restored." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function deleteRunAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = runIdSchema.parse(input);
    await runService.deleteRun(user, parsed.runId);
    revalidateRunSurfaces();
    return { ok: true, message: "Run deleted." };
  } catch (error) {
    return mapActionError(error);
  }
}
