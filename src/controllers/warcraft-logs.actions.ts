"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { formatBulkWarcraftLogsDiscoveryMessage } from "@/lib/warcraft-logs/bulk-discovery-message";
import { characterIdSchema } from "@/validators/character";
import { characterWarcraftLogsService } from "@/services/character-warcraft-logs.service";

/**
 * Owner-only explicit Warcraft Logs identity lookup for a Character missing an ID.
 */
export async function linkWarcraftLogsCharacterAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = characterIdSchema.parse(input);
    const result = await characterWarcraftLogsService.linkForOwner(user, parsed.characterId);

    switch (result.status) {
      case "LINKED":
        revalidatePath("/characters");
        revalidatePath(`/characters/${parsed.characterId}`);
        return { ok: true, message: "Warcraft Logs character linked." };
      case "ALREADY_LINKED":
        revalidatePath("/characters");
        revalidatePath(`/characters/${parsed.characterId}`);
        return { ok: true, message: "Warcraft Logs is already linked." };
      case "NOT_FOUND":
        return {
          ok: false,
          code: "WCL_CHARACTER_NOT_FOUND",
          message: "No Warcraft Logs character found yet.",
        };
      case "NOT_CONFIGURED":
        return {
          ok: false,
          code: "WCL_NOT_CONFIGURED",
          message: "Warcraft Logs API is not configured on this server.",
        };
      case "UNSUPPORTED_REGION":
        return {
          ok: false,
          code: "WCL_UNSUPPORTED_REGION",
          message: "This character region is not supported for Warcraft Logs lookup.",
        };
      case "MISMATCH":
        return {
          ok: false,
          code: "WCL_IDENTITY_MISMATCH",
          message: "A different Warcraft Logs identity is already stored for this character.",
        };
      case "TEMPORARY_FAILURE":
        return {
          ok: false,
          code: "WCL_TEMPORARY_FAILURE",
          message: "Warcraft Logs is temporarily unavailable. Try again later.",
        };
      default:
        return { ok: false, code: "UNEXPECTED", message: "Something went wrong. Try again." };
    }
  } catch (error) {
    return mapActionError(error);
  }
}

/**
 * Owner-scoped bulk discovery for ACTIVE Characters missing warcraftLogsId.
 * Ownership and WCL configuration are resolved in the service layer.
 */
export async function linkMissingWarcraftLogsCharactersAction(): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const result = await characterWarcraftLogsService.linkMissingForOwner(user);

    switch (result.status) {
      case "NO_MISSING":
        return {
          ok: true,
          message: "No active characters are missing Warcraft Logs links.",
        };
      case "NOT_CONFIGURED":
        return {
          ok: false,
          code: "WCL_NOT_CONFIGURED",
          message: "Warcraft Logs API is not configured on this server.",
        };
      case "COMPLETED":
        revalidatePath("/characters");
        return {
          ok: true,
          message: formatBulkWarcraftLogsDiscoveryMessage(result.summary),
        };
      default:
        return { ok: false, code: "UNEXPECTED", message: "Something went wrong. Try again." };
    }
  } catch (error) {
    return mapActionError(error);
  }
}
