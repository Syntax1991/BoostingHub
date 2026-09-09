"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { characterService } from "@/services/character.service";
import {
  characterIdSchema,
  createCharacterSchema,
  updateCharacterSchema,
} from "@/validators/character";

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
export async function createCharacterAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = createCharacterSchema.parse(input);
    const created = await characterService.createCharacter(user, parsed);
    revalidateCharacterSurfaces(created.id);
    return { ok: true, message: "Character added." };
  } catch (error) {
    return mapActionError(error);
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
