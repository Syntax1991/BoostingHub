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
  enrichImportCandidateSchema,
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
    const result = await characterBlizzardService.applySelections(
      user,
      parsed.importSessionId,
      parsed.selections,
    );
    revalidateCharacterSurfaces();
    const imported = result.importedCharacterIds.length;
    const linked = result.linkedCharacterIds.length;
    const parts: string[] = [];
    if (imported > 0) parts.push(`imported ${imported}`);
    if (linked > 0) parts.push(`linked ${linked}`);
    return {
      ok: true,
      message:
        parts.length > 0
          ? `Successfully ${parts.join(" and ")} character(s).`
          : "No characters changed.",
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
      {
        specialization: parsed.specialization,
        ...(typeof parsed.itemLevel === "number" ? { itemLevel: parsed.itemLevel } : {}),
      },
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

export async function refreshAllBattleNetCharactersAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = battleNetRegionSchema.parse(input);
    const result = await characterBlizzardService.refreshLinkedCharactersForRegion(
      user,
      parsed.region,
    );
    revalidateCharacterSurfaces();
    if (result.total === 0) {
      return {
        ok: true,
        message: `No active linked ${parsed.region} characters to refresh.`,
      };
    }
    return {
      ok: true,
      message: `Refresh all (${parsed.region}): ${result.refreshed} refreshed, ${result.skipped} skipped, ${result.failed} failed.`,
    };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function enrichImportCandidateAction(
  input: unknown,
): Promise<
  ActionResult & {
    data: {
      blizzardCharacterId: string;
      suggestedSpecialization: string | null;
      suggestedItemLevel: number | null;
    } | null;
  }
> {
  try {
    const user = await requireUser();
    const parsed = enrichImportCandidateSchema.parse(input);
    const data = await characterBlizzardService.enrichImportCandidate(
      user,
      parsed.importSessionId,
      parsed.blizzardCharacterId,
    );
    return { ok: true, message: "Profile enrichment loaded.", data };
  } catch (error) {
    return { ...mapActionError(error), data: null };
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
