"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import {
  raidCatalogImportService,
  type RaidImportPreview,
  type SeasonImportPreview,
} from "@/services/raid-catalog-import.service";
import { raidCatalogService } from "@/services/raid-catalog.service";
import {
  createEncounterSchema,
  createProductSchema,
  encounterIdSchema,
  importRaidSchema,
  importSeasonSchema,
  previewRaidImportSchema,
  seasonKeySchema,
  moveEncounterSchema,
  productIdSchema,
  raidIdSchema,
  updateEncounterSchema,
  updateProductSchema,
  updateRaidSchema,
} from "@/validators/raid-catalog";
import { z } from "zod";

/** Raid Catalog (/manage/raid-catalog) — ADMIN / OWNER only (requireAdmin + service assertion). */

function revalidateRaidCatalog(raidId?: string) {
  revalidatePath("/manage/raid-catalog");
  if (raidId) revalidatePath(`/manage/raid-catalog/raids/${raidId}`);
}

function importSummary(result: { created: number; updated: number; unchanged: number }): string {
  const parts = [
    result.created > 0 ? `${result.created} imported` : null,
    result.updated > 0 ? `${result.updated} updated` : null,
    result.unchanged > 0 ? `${result.unchanged} already up to date` : null,
  ].filter(Boolean);
  return parts.join(", ");
}

export async function previewRaidImportAction(
  input: unknown,
): Promise<ActionResult & { preview?: RaidImportPreview }> {
  try {
    const admin = await requireAdmin();
    const { journalInstanceId } = previewRaidImportSchema.parse(input);
    const preview = await raidCatalogImportService.previewRaidImport(admin, journalInstanceId);
    return { ok: true, message: `Fetched ${preview.plan.name}.`, preview };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function importRaidAction(
  input: unknown,
): Promise<ActionResult & { raidId?: string }> {
  try {
    const admin = await requireAdmin();
    const parsed = importRaidSchema.parse(input);
    const result = await raidCatalogImportService.importRaid(admin, parsed);
    revalidateRaidCatalog(result.raidIds[0]);
    return {
      ok: true,
      message: `${result.plan.name}: ${importSummary(result)}.`,
      raidId: result.raidIds[0],
    };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function previewSeasonImportAction(
  input: unknown,
): Promise<ActionResult & { preview?: SeasonImportPreview }> {
  try {
    const admin = await requireAdmin();
    const { seasonKey } = seasonKeySchema.parse(input);
    const preview = await raidCatalogImportService.previewSeasonImport(admin, seasonKey);
    return { ok: true, message: `Fetched ${preview.season.name}.`, preview };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function importSeasonAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const parsed = importSeasonSchema.parse(input);
    const result = await raidCatalogImportService.importSeason(admin, parsed);
    revalidateRaidCatalog();
    return { ok: true, message: `Season imported: ${importSummary(result)}.` };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function previewRaidRefreshAction(
  input: unknown,
): Promise<ActionResult & { preview?: RaidImportPreview }> {
  try {
    const admin = await requireAdmin();
    const { raidId } = raidIdSchema.parse(input);
    const preview = await raidCatalogImportService.previewRaidRefresh(admin, raidId);
    return { ok: true, message: `Fetched ${preview.plan.name}.`, preview };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function refreshRaidFromBlizzardAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const { raidId } = raidIdSchema.parse(input);
    const result = await raidCatalogImportService.refreshRaid(admin, raidId);
    revalidateRaidCatalog(raidId);
    return {
      ok: true,
      message:
        result.updated > 0
          ? `${result.plan.name} refreshed from Blizzard.`
          : `${result.plan.name} is already up to date.`,
    };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function updateRaidAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const parsed = updateRaidSchema.parse(input);
    await raidCatalogService.updateRaid(admin, parsed);
    revalidateRaidCatalog(parsed.raidId);
    return { ok: true, message: `Raid "${parsed.name}" saved.` };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function retryWclDetectionAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const { raidId } = raidIdSchema.parse(input);
    const { resolved } = await raidCatalogService.retryWclDetection(admin, raidId);
    revalidateRaidCatalog(raidId);
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
    await raidCatalogService.clearWclMapping(admin, raidId);
    revalidateRaidCatalog(raidId);
    return { ok: true, message: "Warcraft Logs mapping cleared." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function deleteRaidAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const { raidId } = raidIdSchema.parse(input);
    const { name } = await raidCatalogService.deleteRaid(admin, raidId);
    revalidateRaidCatalog();
    return { ok: true, message: `Raid "${name}" deleted.` };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function createEncounterAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const parsed = createEncounterSchema.parse(input);
    await raidCatalogService.createEncounter(admin, parsed);
    revalidateRaidCatalog(parsed.raidId);
    return { ok: true, message: `Encounter "${parsed.name}" added.` };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function updateEncounterAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const parsed = updateEncounterSchema.parse(input);
    await raidCatalogService.updateEncounter(admin, parsed);
    revalidateRaidCatalog();
    revalidatePath("/manage/raid-catalog/raids/[raidId]", "page");
    return { ok: true, message: `Encounter "${parsed.name}" saved.` };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function moveEncounterAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const parsed = moveEncounterSchema.parse(input);
    await raidCatalogService.moveEncounter(admin, parsed);
    revalidatePath("/manage/raid-catalog/raids/[raidId]", "page");
    return { ok: true, message: "Encounter order saved." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function deleteEncounterAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const { bossId } = encounterIdSchema.parse(input);
    const { name } = await raidCatalogService.deleteEncounter(admin, bossId);
    revalidateRaidCatalog();
    revalidatePath("/manage/raid-catalog/raids/[raidId]", "page");
    return { ok: true, message: `Encounter "${name}" deleted.` };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function createProductAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const parsed = createProductSchema.parse(input);
    await raidCatalogService.createProduct(admin, parsed);
    revalidateRaidCatalog();
    return { ok: true, message: `Product "${parsed.name}" created.` };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function updateProductAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const parsed = updateProductSchema.parse(input);
    await raidCatalogService.updateProduct(admin, parsed);
    revalidateRaidCatalog();
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
    const { name } = await raidCatalogService.setProductActive(admin, productId, value);
    revalidateRaidCatalog();
    return { ok: true, message: `Product "${name}" ${value ? "activated" : "deactivated"}.` };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function setProductSelectableAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const { productId, value } = productFlagSchema.parse(input);
    const { name } = await raidCatalogService.setProductSelectable(admin, productId, value);
    revalidateRaidCatalog();
    return {
      ok: true,
      message: `Product "${name}" is now ${value ? "selectable" : "hidden from selection"}.`,
    };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function deleteProductAction(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const { productId } = productIdSchema.parse(input);
    const { name } = await raidCatalogService.deleteProduct(admin, productId);
    revalidateRaidCatalog();
    return { ok: true, message: `Product "${name}" deleted.` };
  } catch (error) {
    return mapActionError(error);
  }
}
