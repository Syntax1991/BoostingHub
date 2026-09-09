"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { battleNetService } from "@/services/battle-net.service";
import { characterBlizzardService } from "@/services/character-blizzard.service";
import {
  battleNetRegionSchema,
  importBattleNetCharactersSchema,
  importSessionIdSchema,
  linkBattleNetCharacterSchema,
  refreshBlizzardCharacterSchema,
} from "@/validators/blizzard";

function revalidateCharacterSurfaces(characterId?: string) {
  revalidatePath("/characters");
  revalidatePath("/dashboard");
  revalidatePath("/profile");
  if (characterId) {
    revalidatePath(`/characters/${characterId}`);
  }
}

type ImportSessionPayload = Awaited<
  ReturnType<typeof characterBlizzardService.resolveImportCandidates>
>;

export async function disconnectBattleNetAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = battleNetRegionSchema.parse(input);
    await battleNetService.disconnect(user, parsed.region);
    revalidateCharacterSurfaces();
    return { ok: true, message: `Disconnected Battle.net (${parsed.region}).` };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function importBattleNetCharactersAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = importBattleNetCharactersSchema.parse(input);
    const result = await characterBlizzardService.importCharacters(
      user,
      parsed.importSessionId,
      parsed.selections,
    );
    revalidateCharacterSurfaces();
    return {
      ok: true,
      message: `Imported ${result.importedCharacterIds.length} character(s).`,
    };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function linkBattleNetCharacterAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = linkBattleNetCharacterSchema.parse(input);
    const result = await characterBlizzardService.linkCharacter(
      user,
      parsed.importSessionId,
      parsed.blizzardCharacterId,
      parsed.characterId,
    );
    revalidateCharacterSurfaces(result.characterId);
    return { ok: true, message: "Character linked to Battle.net." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function refreshBlizzardCharacterAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = refreshBlizzardCharacterSchema.parse(input);
    await characterBlizzardService.refreshCharacter(user, parsed.characterId);
    revalidateCharacterSurfaces(parsed.characterId);
    return { ok: true, message: "Character refreshed from Blizzard." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function loadImportSessionAction(
  input: unknown,
): Promise<ActionResult & { data: ImportSessionPayload | null }> {
  try {
    const user = await requireUser();
    const parsed = importSessionIdSchema.parse(input);
    const data = await characterBlizzardService.resolveImportCandidates(
      user,
      parsed.importSessionId,
    );
    return { ok: true, message: "Import session loaded.", data };
  } catch (error) {
    return { ...mapActionError(error), data: null };
  }
}
