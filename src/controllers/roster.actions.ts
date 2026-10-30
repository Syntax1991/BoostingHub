"use server";

import { requireUser } from "@/auth/session";
import { mapActionError, type ActionFailure, type ActionResult } from "@/lib/action-result";
import { pingRoleLabel } from "@/lib/late-fill-help";
import { lateFillHelpFeedback, lateFillHelpService, type PingRolesDialogData } from "@/services/late-fill-help.service";
import { rosterBuilderService } from "@/services/roster-builder.service";
import { rosterService } from "@/services/roster.service";
import {
  rosterCharacterSyncService,
  type RosterCharacterSyncResult,
} from "@/services/roster-character-sync.service";
import {
  applyRosterBuilderSchema,
  customPingSchema,
  proposeRosterBuilderSchema,
  publishRosterSchema,
  repostRosterSchema,
  updateRosterSchema,
  rosterAddPlayerSchema,
  rosterManualAddOptionsSchema,
  rosterPlayerSearchSchema,
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

type RosterPlayerMatches = Awaited<ReturnType<typeof rosterService.searchPlayers>>;
type RosterManualAddOptions = Awaited<ReturnType<typeof rosterService.getManualAddOptions>>;

export async function searchRosterPlayersAction(
  input: unknown,
): Promise<ActionResult & { data: RosterPlayerMatches | null }> {
  try {
    const user = await requireUser();
    const parsed = rosterPlayerSearchSchema.parse(input);
    const data = await rosterService.searchPlayers(user, parsed);
    return { ok: true, message: `${data.length} player${data.length === 1 ? "" : "s"} found.`, data };
  } catch (error) {
    return { ...mapActionError(error), data: null };
  }
}

export async function getRosterManualAddOptionsAction(
  input: unknown,
): Promise<ActionResult & { data: RosterManualAddOptions | null }> {
  try {
    const user = await requireUser();
    const parsed = rosterManualAddOptionsSchema.parse(input);
    const data = await rosterService.getManualAddOptions(user, parsed);
    return { ok: true, message: "Characters loaded.", data };
  } catch (error) {
    return { ...mapActionError(error), data: null };
  }
}

export async function addRosterPlayerAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = rosterAddPlayerSchema.parse(input);
    await rosterService.addRegisteredParticipant(user, parsed);
    return { ok: true, message: "Player added to the roster draft." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function updateRosterAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = updateRosterSchema.parse(input);
    await rosterService.updateRoster(user, parsed);
    return { ok: true, message: "Roster updated." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function repostRosterAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = repostRosterSchema.parse(input);
    await rosterService.repostRoster(user, parsed);
    return { ok: true, message: "The roster will be posted to Discord again." };
  } catch (error) {
    return mapActionError(error);
  }
}

type RosterBuilderData = Awaited<ReturnType<typeof rosterBuilderService.proposeRoster>>;

/** On-demand deterministic roster proposal from Run signups. Does not mutate. */
export async function proposeRosterBuilderAction(
  input: unknown,
): Promise<ActionResult & { data: RosterBuilderData | null }> {
  try {
    const user = await requireUser();
    const parsed = proposeRosterBuilderSchema.parse(input);
    const data = await rosterBuilderService.proposeRoster(user, parsed.runId, {
      baseSelections: parsed.baseSelections,
    });
    return { ok: true, message: "Roster proposal ready.", data };
  } catch (error) {
    return { ...mapActionError(error), data: null };
  }
}

/** Apply a generated proposal via authoritative draft selection. Revalidates server-side. */
export async function applyRosterBuilderAction(
  input: unknown,
): Promise<ActionResult & { data: RosterBuilderData | null }> {
  try {
    const user = await requireUser();
    const parsed = applyRosterBuilderSchema.parse(input);
    const data = await rosterBuilderService.applyRosterProposal(user, parsed);
    return { ok: true, message: "Roster proposal applied.", data };
  } catch (error) {
    return { ...mapActionError(error), data: null };
  }
}

/** Raid Lead "Sync Characters": fresh Blizzard sync of the selected roster Characters without a fresh sync. */
export async function syncRosterCharactersAction(
  input: unknown,
): Promise<ActionResult & { data: RosterCharacterSyncResult | null }> {
  try {
    const user = await requireUser();
    const parsed = rosterRunSchema.parse(input);
    const data = await rosterCharacterSyncService.syncStaleSelected(user, parsed.runId);
    return { ok: true, message: rosterCharacterSyncMessage(data), data };
  } catch (error) {
    return { ...mapActionError(error), data: null };
  }
}

function rosterCharacterSyncMessage(result: RosterCharacterSyncResult): string {
  const parts = [`${result.synced} synced`];
  if (result.failed > 0) parts.push(`${result.failed} failed`);
  if (result.skipped > 0) parts.push(`${result.skipped} skipped (recently synced or in progress)`);
  return `Characters: ${parts.join(" · ")}.`;
}

/** Automatic: ask the Guild ping roles in the Run channel for the missing roles (cooldown per role). */
export async function requestLateFillHelpAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = rosterRunSchema.parse(input);
    const result = await lateFillHelpService.request(user, parsed.runId);
    return { ok: true, message: lateFillHelpFeedback(result) };
  } catch (error) {
    return mapActionError(error);
  }
}

/** Ping roles dialog: the Automatic preview and the roles Custom can ping. Read-only, starts no cooldown. */
export async function getPingRolesDialogDataAction(
  input: unknown,
): Promise<{ ok: true; data: PingRolesDialogData } | ActionFailure> {
  try {
    const user = await requireUser();
    const parsed = rosterRunSchema.parse(input);
    return { ok: true, data: await lateFillHelpService.dialogData(user, parsed.runId) };
  } catch (error) {
    return mapActionError(error);
  }
}

/** Custom request: the Raid Lead's text, pinging the roles they chose, in the Run channel. */
export async function requestCustomPingAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = customPingSchema.parse(input);
    const result = await lateFillHelpService.requestCustom(user, parsed);
    return { ok: true, message: `Ping queued: ${result.roles.map((key) => pingRoleLabel(key)).join(", ")}.` };
  } catch (error) {
    return mapActionError(error);
  }
}
