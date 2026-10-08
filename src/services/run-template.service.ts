import type { AuthenticatedUser } from "@/auth/authorization";
import { hasAdminAccess, isEligibleRaidLead } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import {
  projectRunContentCoverage,
  projectRunContentDisplay,
  type ExpandedRunContent,
} from "@/lib/run-content-presets";
import {
  matchProductForContents,
  type ContentBossCounts,
  type PlanningProduct,
} from "@/lib/product-selection";
import { raidRepository } from "@/repositories/raid.repository";
import {
  expandSelectionOrThrow,
  isSelectableProduct,
  productPlanningService,
  requireSelectableProduct,
} from "@/services/product-planning.service";
import {
  runTemplateRepository,
  type RunTemplateContentWriteSpec,
  type RunTemplateRecord,
} from "@/repositories/run-template.repository";
import {
  assertComposition,
  assertValidPlannedBossCount,
  assertValidRunLootType,
  isLootTypeAllowedForDifficulty,
  notesValue,
  RUN_COMPOSITION_MAX,
  RUN_COMPOSITION_MIN,
} from "@/services/run-state";
import type {
  CreateRunTemplateInput,
  ManageTemplateFiltersInput,
  UpdateRunTemplateInput,
} from "@/validators/run-template";

/** ADMIN/OWNER may create/edit/duplicate/deactivate global Run Setups. */
function requireManageTemplates(user: AuthenticatedUser): void {
  if (!hasAdminAccess(user.accountRole)) {
    throw new DomainError(
      "NOT_AUTHORIZED",
      "Admin permission is required to manage run setups.",
      403,
    );
  }
}

/** RAID_LEAD+ may list/use active global presets for Create Run. */
function requireCanUseTemplates(user: AuthenticatedUser): void {
  if (!isEligibleRaidLead(user) && !hasAdminAccess(user.accountRole)) {
    throw new DomainError(
      "NOT_AUTHORIZED",
      "Raid lead or admin permission is required to use run setups.",
      403,
    );
  }
}

/** Template contents as ordered rows (falls back to the legacy singular mirror). */
function templateContentRows(template: RunTemplateRecord) {
  return template.contents.length > 0
    ? template.contents
    : [
        {
          raidId: template.raidId,
          sortOrder: 1,
          plannedBossCount: template.plannedBossCount,
          totalBossCount: template.totalBossCount,
          raidAvailableForRuns: template.raidAvailableForRuns,
          raidName: template.raidName,
          raidSeason: template.raidSeason,
          id: "legacy",
        },
      ];
}

/**
 * Validate existing contents for a copy (duplicate): planned counts inside the
 * raid totals, and the contents still covered by an active Product or made of
 * raids that are still available for new Runs.
 */
async function assertCopyableContents(
  contents: ExpandedRunContent[],
  activeProducts: readonly PlanningProduct[],
): Promise<void> {
  const raids = await raidRepository.listByIds([...new Set(contents.map((row) => row.raidId))]);
  const byId = new Map(raids.map((raid) => [raid.id, raid]));
  for (const content of contents) {
    const raid = byId.get(content.raidId);
    if (!raid) {
      throw new DomainError("VALIDATION_FAILED", "Choose a supported raid.");
    }
    assertValidPlannedBossCount(content.plannedBossCount, raid.totalBossCount);
  }
  const coveredByProduct = matchProductForContents(activeProducts, contents) !== null;
  if (!coveredByProduct && contents.some((content) => !byId.get(content.raidId)!.availableForRuns)) {
    throw new DomainError(
      "RAID_NOT_AVAILABLE_FOR_RUNS",
      "This raid is no longer available for new templates.",
    );
  }
}

async function loadManagedTemplate(
  user: AuthenticatedUser,
  templateId: string,
): Promise<RunTemplateRecord> {
  requireManageTemplates(user);
  const template = await runTemplateRepository.findById(templateId);
  if (!template) {
    throw new DomainError("RUN_TEMPLATE_NOT_FOUND", "Run template was not found.", 404);
  }
  return template;
}

export type TemplateUsability = { usable: boolean; unusableReason: string | null };

/**
 * Usability is computed fresh from joined Raid/content state — never stored.
 * Global setups have no Raid Lead ownership check.
 *
 * Content is usable when it is still covered by an ACTIVE Product (generic
 * match: same raids in order, FIXED counts equal, VARIABLE counts in range —
 * selectable is not required, hiding a product never breaks existing setups)
 * or when every content raid is still available for new Runs (legacy
 * single-raid setups). No product keys, no bundle / Tide special cases.
 */
export function computeUsability(
  template: RunTemplateRecord,
  activeProducts: readonly PlanningProduct[],
): TemplateUsability {
  if (!template.isActive) {
    return { usable: false, unusableReason: "This template has been deactivated." };
  }
  if (!isLootTypeAllowedForDifficulty(template.difficulty, template.lootType)) {
    return { usable: false, unusableReason: "This template's loot type is no longer valid for its difficulty." };
  }

  const contents = templateContentRows(template);

  if (contents.length === 0) {
    return { usable: false, unusableReason: "This template has no raid content." };
  }

  const coveredByProduct =
    matchProductForContents(
      activeProducts.filter((product) => product.active),
      contents,
    ) !== null;
  for (const content of contents) {
    if (!coveredByProduct && !content.raidAvailableForRuns) {
      return {
        usable: false,
        unusableReason: "This template's raid is no longer available for new runs.",
      };
    }
    if (
      !Number.isInteger(content.plannedBossCount) ||
      content.plannedBossCount < 1 ||
      content.plannedBossCount > content.totalBossCount
    ) {
      return {
        usable: false,
        unusableReason: "This template's planned boss count is no longer valid for its raid.",
      };
    }
  }

  const composition = [
    template.desiredTankCount,
    template.desiredHealerCount,
    template.desiredDpsCount,
    template.desiredLootbuddyCount,
  ];
  if (
    composition.some(
      (count) =>
        !Number.isInteger(count) || count < RUN_COMPOSITION_MIN || count > RUN_COMPOSITION_MAX,
    )
  ) {
    return { usable: false, unusableReason: "This template's composition is no longer valid." };
  }
  return { usable: true, unusableReason: null };
}

export function templateContentDisplay(template: RunTemplateRecord) {
  const contents =
    template.contents.length > 0
      ? template.contents
      : [
          {
            raidId: template.raidId,
            raidName: template.raidName,
            sortOrder: 1,
            plannedBossCount: template.plannedBossCount,
            totalBossCount: template.totalBossCount,
          },
        ];
  return projectRunContentDisplay(contents);
}

export function templateCoverage(template: RunTemplateRecord) {
  const contents =
    template.contents.length > 0
      ? template.contents
      : [
          {
            raidId: template.raidId,
            sortOrder: 1,
            plannedBossCount: template.plannedBossCount,
            totalBossCount: template.totalBossCount,
          },
        ];
  return projectRunContentCoverage(contents);
}

async function persistFromProduct(
  input: {
    name: string;
    contents: ExpandedRunContent[];
    difficulty: CreateRunTemplateInput["difficulty"];
    lootType: CreateRunTemplateInput["lootType"];
    desiredTankCount: number;
    desiredHealerCount: number;
    desiredDpsCount: number;
    desiredLootbuddyCount?: number;
    notes?: string | null;
    actorId: string;
  },
  mode: "create" | "update",
  templateId: string | undefined,
  txOrm?: typeof import("@/lib/prisma").orm,
): Promise<{ id: string; contents: RunTemplateContentWriteSpec[] }> {
  const contents = input.contents;

  assertComposition(input.desiredTankCount, "Desired tanks");
  assertComposition(input.desiredHealerCount, "Desired healers");
  assertComposition(input.desiredDpsCount, "Desired DPS");
  assertComposition(input.desiredLootbuddyCount ?? 0, "Desired lootbuddies");
  assertValidRunLootType(input.difficulty, input.lootType);

  const fields = {
    name: input.name.trim(),
    difficulty: input.difficulty,
    lootType: input.lootType,
    contents,
    desiredTankCount: input.desiredTankCount,
    desiredHealerCount: input.desiredHealerCount,
    desiredDpsCount: input.desiredDpsCount,
    desiredLootbuddyCount: input.desiredLootbuddyCount ?? 0,
    notes: notesValue(input.notes),
  };

  if (mode === "create") {
    const id = await runTemplateRepository.create(
      {
        ...fields,
        createdById: input.actorId,
        updatedById: input.actorId,
      },
      txOrm,
    );
    return { id, contents };
  }

  if (!templateId) {
    throw new DomainError("VALIDATION_FAILED", "Template id is required for update.");
  }
  await runTemplateRepository.update(
    templateId,
    {
      ...fields,
      updatedById: input.actorId,
    },
    txOrm,
  );
  return { id: templateId, contents };
}

/**
 * Editing a Run Setup: choosing a NEW product requires active + selectable;
 * keeping the setup's own current product only requires it to be active
 * (a hidden product must not block unrelated edits).
 */
function resolveProductForTemplateEdit(
  products: readonly PlanningProduct[],
  existing: RunTemplateRecord,
  productId: string,
): PlanningProduct {
  const activeProducts = products.filter((product) => product.active);
  const current = matchProductForContents(activeProducts, templateContentRows(existing));
  if (current?.productId === productId) {
    return activeProducts.find((product) => product.id === productId)!;
  }
  return requireSelectableProduct(products, productId);
}

export type { ContentBossCounts };

export const runTemplateService = {
  /** RAID_LEAD+ read-only catalog of global setups (profile / use). */
  async listOwn(user: AuthenticatedUser) {
    requireCanUseTemplates(user);
    const [templates, activeProducts] = await Promise.all([
      runTemplateRepository.listAll(),
      productPlanningService.listActive(),
    ]);
    return templates.map((template) => {
      const display = templateContentDisplay(template);
      return { ...template, ...computeUsability(template, activeProducts), contentDisplay: display };
    });
  },

  async listAll(user: AuthenticatedUser, filters: ManageTemplateFiltersInput = {}) {
    requireManageTemplates(user);
    const [templates, products] = await Promise.all([
      runTemplateRepository.listAll(),
      productPlanningService.listAll(),
    ]);
    const activeProducts = products.filter((product) => product.active);
    const withUsability = templates.map((template) => {
      const display = templateContentDisplay(template);
      // The product (and counts) the edit form preselects; null when no active product matches.
      const productSelection = matchProductForContents(activeProducts, templateContentRows(template));
      return {
        ...template,
        ...computeUsability(template, activeProducts),
        contentDisplay: display,
        productSelection,
      };
    });
    const status = filters.status ?? "active";
    if (status === "all") return withUsability;
    return withUsability.filter((template) =>
      status === "active" ? template.isActive : !template.isActive,
    );
  },

  async getCreateFormData(user: AuthenticatedUser) {
    requireManageTemplates(user);
    await raidRepository.ensureReferenceRaids();
    const products = (await productPlanningService.listAll()).filter(isSelectableProduct);

    return {
      canAssignRaidLead: false,
      products,
      raidLeads: [] as Array<{ id: string; name: string; accountRole: string }>,
    };
  },

  async createTemplate(user: AuthenticatedUser, input: CreateRunTemplateInput) {
    return this.createTemplateInTx(user, input);
  },

  /**
   * Create an independent copy of a RunTemplate (contents + default composition).
   * Never copies CommunityScheduleSlots, overrides, or materialization history.
   */
  async duplicateTemplate(
    user: AuthenticatedUser,
    templateId: string,
  ): Promise<{ id: string }> {
    const existing = await loadManagedTemplate(user, templateId);
    await raidRepository.ensureReferenceRaids();

    const contents =
      existing.contents.length > 0
        ? existing.contents.map((row) => ({
            raidId: row.raidId,
            sortOrder: row.sortOrder,
            plannedBossCount: row.plannedBossCount,
          }))
        : [
            {
              raidId: existing.raidId,
              sortOrder: 1,
              plannedBossCount: existing.plannedBossCount,
            },
          ];
    await assertCopyableContents(contents, await productPlanningService.listActive());

    const id = await runTemplateRepository.create({
      name: `${existing.name} (copy)`.slice(0, 80),
      difficulty: existing.difficulty,
      lootType: existing.lootType,
      contents,
      desiredTankCount: existing.desiredTankCount,
      desiredHealerCount: existing.desiredHealerCount,
      desiredDpsCount: existing.desiredDpsCount,
      desiredLootbuddyCount: existing.desiredLootbuddyCount,
      notes: existing.notes,
      createdById: user.id,
      updatedById: user.id,
    });
    return { id };
  },

  async createTemplateInTx(
    user: AuthenticatedUser,
    input: CreateRunTemplateInput,
    txOrm?: typeof import("@/lib/prisma").orm,
  ) {
    requireManageTemplates(user);
    await raidRepository.ensureReferenceRaids();
    // New Run Setups may only use active + selectable products.
    const product = requireSelectableProduct(await productPlanningService.listAll(), input.productId);

    const { id } = await persistFromProduct(
      {
        name: input.name,
        contents: expandSelectionOrThrow(product, input.contentBossCounts ?? {}),
        difficulty: input.difficulty,
        lootType: input.lootType,
        desiredTankCount: input.desiredTankCount,
        desiredHealerCount: input.desiredHealerCount,
        desiredDpsCount: input.desiredDpsCount,
        desiredLootbuddyCount: input.desiredLootbuddyCount,
        notes: input.notes,
        actorId: user.id,
      },
      "create",
      undefined,
      txOrm,
    );

    return { id };
  },

  async updateTemplate(user: AuthenticatedUser, input: UpdateRunTemplateInput) {
    const existing = await loadManagedTemplate(user, input.templateId);
    await raidRepository.ensureReferenceRaids();
    const product = resolveProductForTemplateEdit(
      await productPlanningService.listAll(),
      existing,
      input.productId,
    );

    const desiredLootbuddyCount = input.desiredLootbuddyCount ?? existing.desiredLootbuddyCount;
    await persistFromProduct(
      {
        name: input.name,
        contents: expandSelectionOrThrow(product, input.contentBossCounts ?? {}),
        difficulty: input.difficulty,
        lootType: input.lootType,
        desiredTankCount: input.desiredTankCount,
        desiredHealerCount: input.desiredHealerCount,
        desiredDpsCount: input.desiredDpsCount,
        desiredLootbuddyCount,
        notes: input.notes,
        actorId: user.id,
      },
      "update",
      existing.id,
    );

    return { id: existing.id };
  },

  async deactivate(user: AuthenticatedUser, templateId: string) {
    const existing = await loadManagedTemplate(user, templateId);
    if (!existing.isActive) {
      throw new DomainError("RUN_TEMPLATE_ALREADY_INACTIVE", "This template is already inactive.");
    }
    await runTemplateRepository.setActive(existing.id, false, user.id);
    return { id: existing.id };
  },

  async reactivate(user: AuthenticatedUser, templateId: string) {
    const existing = await loadManagedTemplate(user, templateId);
    if (existing.isActive) {
      throw new DomainError("RUN_TEMPLATE_ALREADY_ACTIVE", "This template is already active.");
    }
    const usability = computeUsability({ ...existing, isActive: true }, await productPlanningService.listActive());
    if (!usability.usable) {
      throw new DomainError(
        "RUN_TEMPLATE_UNUSABLE",
        usability.unusableReason ?? "This template can no longer be reactivated.",
      );
    }
    await runTemplateRepository.setActive(existing.id, true, user.id);
    return { id: existing.id };
  },

  async listUsableForCreation(user: AuthenticatedUser) {
    requireCanUseTemplates(user);
    const [templates, activeProducts] = await Promise.all([
      runTemplateRepository.listAll(),
      productPlanningService.listActive(),
    ]);
    return templates
      .map((template) => ({ ...template, ...computeUsability(template, activeProducts) }))
      .filter((template) => template.isActive && template.usable);
  },

  /**
   * Loads a global template for Create Run / mass create. Any eligible raid
   * lead or admin may use an active usable setup — Raid Lead is chosen on
   * the Run/Schedule, not on the template.
   */
  async resolveTemplateForUse(user: AuthenticatedUser, templateId: string): Promise<RunTemplateRecord> {
    requireCanUseTemplates(user);
    const template = await runTemplateRepository.findById(templateId);
    if (!template) {
      throw new DomainError(
        "RUN_TEMPLATE_NOT_FOUND",
        "This template could not be found. Reload and try again.",
        404,
      );
    }
    const usability = computeUsability(template, await productPlanningService.listActive());
    if (!usability.usable) {
      throw new DomainError(
        "RUN_TEMPLATE_UNUSABLE",
        usability.unusableReason ?? "This template is no longer usable. Reload and try again.",
      );
    }
    return template;
  },
};

export type MyRunTemplatesPage = Awaited<ReturnType<typeof runTemplateService.listOwn>>;
export type ManageRunTemplatesPage = Awaited<ReturnType<typeof runTemplateService.listAll>>;
export type CreateRunTemplateFormData = Awaited<
  ReturnType<typeof runTemplateService.getCreateFormData>
>;
