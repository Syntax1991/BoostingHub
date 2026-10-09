"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { contentCatalogService } from "@/services/content-catalog.service";
import {
  createEncounterSchema,
  createProductSchema,
  createRaidSchema,
  encounterIdSchema,
  moveEncounterSchema,
  productIdSchema,
  raidIdSchema,
  updateEncounterSchema,
  updateProductSchema,
  updateRaidSchema,
} from "@/validators/content-catalog";
import { z } from "zod";

/** Content Catalog (/manage/content) — ADMIN / OWNER only (requireAdmin + service assertion). */

function revalidateContent(raidId?: string) {
  revalidatePath("/manage/content");
  if (raidId) revalidatePath(`/manage/content/raids/${raidId}`);
}

export async function createRaidAction(input: unknown): Promise<ActionResult & { raidId?: string }> {
  try {
    const admin = await requireAdmin();
    const parsed = createRaidSchema.parse(input);
    const { raidId } = await contentCatalogService.createRaid(admin, parsed);
    revalidateContent(raidId);
    return { ok: true, message: `Raid "${parsed.name}" created.`, raidId };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function updateRaidAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const parsed = updateRaidSchema.parse(input);
    await contentCatalogService.updateRaid(admin, parsed);
    revalidateContent(parsed.raidId);
    return { ok: true, message: `Raid "${parsed.name}" saved.` };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function retryWclDetectionAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const { raidId } = raidIdSchema.parse(input);
    const { resolved } = await contentCatalogService.retryWclDetection(admin, raidId);
    revalidateContent(raidId);
    return {
      ok: true,
      message: resolved
        ? "Warcraft Logs mapping updated."
        : "Warcraft Logs still not resolved. Try again later or check the raid name.",
    };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function clearWclMappingAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const { raidId } = raidIdSchema.parse(input);
    await contentCatalogService.clearWclMapping(admin, raidId);
    revalidateContent(raidId);
    return { ok: true, message: "Warcraft Logs mapping cleared." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function deleteRaidAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const { raidId } = raidIdSchema.parse(input);
    const { name } = await contentCatalogService.deleteRaid(admin, raidId);
    revalidateContent();
    return { ok: true, message: `Raid "${name}" deleted.` };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function createEncounterAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const parsed = createEncounterSchema.parse(input);
    await contentCatalogService.createEncounter(admin, parsed);
    revalidateContent(parsed.raidId);
    return { ok: true, message: `Encounter "${parsed.name}" added.` };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function updateEncounterAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const parsed = updateEncounterSchema.parse(input);
    await contentCatalogService.updateEncounter(admin, parsed);
    revalidateContent();
    revalidatePath("/manage/content/raids/[raidId]", "page");
    return { ok: true, message: `Encounter "${parsed.name}" saved.` };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function moveEncounterAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const parsed = moveEncounterSchema.parse(input);
    await contentCatalogService.moveEncounter(admin, parsed);
    revalidatePath("/manage/content/raids/[raidId]", "page");
    return { ok: true, message: "Encounter order saved." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function deleteEncounterAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const { bossId } = encounterIdSchema.parse(input);
    const { name } = await contentCatalogService.deleteEncounter(admin, bossId);
    revalidateContent();
    revalidatePath("/manage/content/raids/[raidId]", "page");
    return { ok: true, message: `Encounter "${name}" deleted.` };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function createProductAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const parsed = createProductSchema.parse(input);
    await contentCatalogService.createProduct(admin, parsed);
    revalidateContent();
    return { ok: true, message: `Product "${parsed.name}" created.` };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function updateProductAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const parsed = updateProductSchema.parse(input);
    await contentCatalogService.updateProduct(admin, parsed);
    revalidateContent();
    return { ok: true, message: `Product "${parsed.name}" saved.` };
  } catch (error) {
    return mapActionError(error);
  }
}

const productFlagSchema = productIdSchema.extend({ value: z.boolean() });

export async function setProductActiveAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const { productId, value } = productFlagSchema.parse(input);
    const { name } = await contentCatalogService.setProductActive(admin, productId, value);
    revalidateContent();
    return { ok: true, message: `Product "${name}" ${value ? "activated" : "deactivated"}.` };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function setProductSelectableAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const { productId, value } = productFlagSchema.parse(input);
    const { name } = await contentCatalogService.setProductSelectable(admin, productId, value);
    revalidateContent();
    return { ok: true, message: `Product "${name}" is now ${value ? "selectable" : "hidden from selection"}.` };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function deleteProductAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const { productId } = productIdSchema.parse(input);
    const { name } = await contentCatalogService.deleteProduct(admin, productId);
    revalidateContent();
    return { ok: true, message: `Product "${name}" deleted.` };
  } catch (error) {
    return mapActionError(error);
  }
}
