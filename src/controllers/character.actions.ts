"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { characterService } from "@/services/character.service";
import { characterIdSchema, createCharactersSchema, lookupCharactersFromRaiderIoSchema, updateCharacterSchema } from "@/validators/character";

function revalidateCharacterSurfaces(characterId?: string) {
  revalidatePath("/characters");
  revalidatePath("/dashboard");
  revalidatePath("/profile");
  revalidatePath("/runs");
  revalidatePath("/my-runs");
  revalidatePath("/manage");
  if (characterId) {
    revalidatePath(`/characters/${characterId}`);
  }
}

/**
 * Character mutations take the owner from the session.
 * Client-supplied userId, class-on-edit, BoosterAccess, and lockouts are ignored.
 */

export type RaiderIoPreviewData = {
  name: string;
  realm: string;
  region: string;
  wowClass: string;
  itemLevel: number | null;
  alreadyOwned: boolean;
};

/**
 * Bulk Raider.IO → Blizzard preview. Server enforces 1–10 URLs.
 * Per-URL failures are returned alongside successes (partial ok).
 */
export async function lookupCharactersFromRaiderIoAction(input: unknown): Promise<
  ActionResult & {
    results: Array<
      | { ok: true; url: string; data: RaiderIoPreviewData }
      | { ok: false; url: string; code: string; message: string }
    > | null;
  }
> {
  try {
    const user = await requireUser();
    const parsed = lookupCharactersFromRaiderIoSchema.parse(input);
    const results = await characterService.previewCharactersFromRaiderIoUrls(user, parsed.urls);
    return { ok: true, message: "Lookup finished.", results };
  } catch (error) {
    return { ...mapActionError(error), results: null };
  }
}

/**
 * Bulk Add Character. Each row re-resolves Blizzard. Partial success is
 * returned per clientId so the UI can retry only failures.
 */
export async function createCharactersAction(input: unknown): Promise<
  ActionResult & {
    results: Array<
      | { clientId: string; ok: true }
      | { clientId: string; ok: false; code: string; message: string }
    > | null;
  }
> {
  try {
    const user = await requireUser();
    const parsed = createCharactersSchema.parse(input);
    const results = await characterService.addCharactersFromBlizzard(user, parsed.characters);
    const anyOk = results.some((row) => row.ok);
    if (anyOk) {
      revalidateCharacterSurfaces();
    }
    const allOk = results.every((row) => row.ok);
    if (allOk) {
      return {
        ok: true,
        message:
          results.length === 1 ? "Character added." : `${results.length} characters added.`,
        results,
      };
    }
    return {
      ok: false,
      code: "PARTIAL_FAILURE",
      message: "Some characters could not be added.",
      results,
    };
  } catch (error) {
    return { ...mapActionError(error), results: null };
  }
}

export async function updateCharacterAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = updateCharacterSchema.parse(input);
    await characterService.updateCharacter(user, parsed.characterId, parsed);
    revalidateCharacterSurfaces(parsed.characterId);
    return { ok: true, message: "Character updated." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function deactivateCharacterAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = characterIdSchema.parse(input);
    await characterService.deactivateCharacter(user, parsed.characterId);
    revalidateCharacterSurfaces(parsed.characterId);
    return { ok: true, message: "Character deactivated." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function deleteCharacterAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = characterIdSchema.parse(input);
    await characterService.deleteCharacter(user, parsed.characterId);
    revalidateCharacterSurfaces(parsed.characterId);
    return { ok: true, message: "Character deleted." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function reactivateCharacterAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = characterIdSchema.parse(input);
    await characterService.reactivateCharacter(user, parsed.characterId);
    revalidateCharacterSurfaces(parsed.characterId);
    return { ok: true, message: "Character reactivated." };
  } catch (error) {
    return mapActionError(error);
  }
}
