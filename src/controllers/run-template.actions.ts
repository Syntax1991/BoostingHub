"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { runTemplateService } from "@/services/run-template.service";
import {
  createRunTemplateSchema,
  templateIdSchema,
  updateRunTemplateSchema,
} from "@/validators/run-template";

function revalidateTemplateSurfaces() {
  revalidatePath("/profile/templates");
  revalidatePath("/manage/templates");
  revalidatePath("/manage/runs/create");
}

export type CreateRunTemplateActionResult =
  | { ok: true; message: string; templateId: string }
  | { ok: false; code: string; message: string };

export async function createRunTemplateAction(input: unknown): Promise<CreateRunTemplateActionResult> {
  try {
    const user = await requireUser();
    const parsed = createRunTemplateSchema.parse(input);
    const created = await runTemplateService.createTemplate(user, parsed);
    revalidateTemplateSurfaces();
    return { ok: true, message: "Template created.", templateId: created.id };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function updateRunTemplateAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = updateRunTemplateSchema.parse(input);
    await runTemplateService.updateTemplate(user, parsed);
    revalidateTemplateSurfaces();
    return { ok: true, message: "Template updated." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function deactivateRunTemplateAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = templateIdSchema.parse(input);
    await runTemplateService.deactivate(user, parsed.templateId);
    revalidateTemplateSurfaces();
    return { ok: true, message: "Template deactivated." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function reactivateRunTemplateAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = templateIdSchema.parse(input);
    await runTemplateService.reactivate(user, parsed.templateId);
    revalidateTemplateSurfaces();
    return { ok: true, message: "Template reactivated." };
  } catch (error) {
    return mapActionError(error);
  }
}
