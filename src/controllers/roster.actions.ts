"use server";

import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { rosterService } from "@/services/roster.service";
import {
  publishRosterSchema,
  rosterRunSchema,
  rosterVersionSchema,
  saveExternalBoostersSchema,
  saveRosterDraftSchema,
} from "@/validators/roster";

export async function saveExternalBoostersAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = saveExternalBoostersSchema.parse(input);
    await rosterService.saveExternalBoosters(user, parsed);
    return { ok: true, message: "External boosters saved." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function saveRosterDraftAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = saveRosterDraftSchema.parse(input);
    await rosterService.saveDraftSelection(user, parsed);
    return { ok: true, message: "Roster draft saved." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function prepareRosterEditAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = rosterVersionSchema.parse(input);
    await rosterService.preparePublishedRosterForEditing(user, parsed);
    return { ok: true, message: "Draft seeded from the published roster." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function validateRosterAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = rosterRunSchema.parse(input);
    const result = await rosterService.validateDraft(user, parsed.runId);
    if (!result.canPublish) {
      return { ok: false, code: "ROSTER_VALIDATION_FAILED", message: result.blockers[0]?.message ?? "Cannot publish." };
    }
    if (result.warnings.length > 0) {
      return { ok: true, message: result.warnings[0]?.message ?? "Roster has warnings." };
    }
    return { ok: true, message: "Roster is ready to publish." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function publishRosterAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = publishRosterSchema.parse(input);
    await rosterService.publishRoster(user, parsed);
    return { ok: true, message: "Roster published." };
  } catch (error) {
    return mapActionError(error);
  }
}
