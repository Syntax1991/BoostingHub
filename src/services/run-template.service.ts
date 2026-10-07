import type { AuthenticatedUser } from "@/auth/authorization";
import { hasAdminAccess, isEligibleRaidLead } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import {
  classifyRunContents,
  expandRunContentPreset,
  listCreateRunContentPresets,
  projectRunContentCoverage,
  projectRunContentDisplay,
  venomousBossMaxFromCatalog,
  type ExpandedRunContent,
  type RunContentPresetKey,
} from "@/lib/run-content-presets";
import { TIDEBOUND_GROTTO_RAID_ID } from "@/lib/wow-raid-catalog";
import { raidRepository, type RaidRecord } from "@/repositories/raid.repository";
import {
  runTemplateRepository,
  type RunTemplateContentWriteSpec,
  type RunTemplateRecord,
} from "@/repositories/run-template.repository";
import { userRepository } from "@/repositories/user.repository";
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

function requireManagerRole(user: AuthenticatedUser): void {
  if (!isEligibleRaidLead(user)) {
    throw new DomainError(
      "NOT_AUTHORIZED",
      "Raid lead or admin permission is required to manage run templates.",
      403,
    );
  }
}

/**
 * Decides which raidLeadId a template should be owned by, before any DB
 * lookup. RAID_LEAD may only ever own their own templates (a forged
 * different id is rejected); ADMIN must explicitly choose an owner. Mirrors
 * run.service.ts's resolveRequestedRaidLeadId, kept separate because the two
 * domains (Run creation vs. template ownership) have distinct error copy and
 * must never be coupled by a shared import.
 */
function resolveTemplateOwnerId(user: AuthenticatedUser, requestedRaidLeadId: string | undefined): string {
  if (hasAdminAccess(user.accountRole)) {
    if (!requestedRaidLeadId) {
      throw new DomainError("RUN_RAID_LEAD_INVALID", "Choose an eligible raid lead.");
    }
    return requestedRaidLeadId;
  }
  if (requestedRaidLeadId && requestedRaidLeadId !== user.id) {
    throw new DomainError("RUN_RAID_LEAD_INVALID", "Raid leads can only manage their own templates.");
  }
  return user.id;
}

async function requireEligibleOwner(raidLeadId: string): Promise<void> {
  const owner = await userRepository.findById(raidLeadId);
  if (!owner || !isEligibleRaidLead(owner)) {
    throw new DomainError("RUN_RAID_LEAD_INVALID", "Choose an eligible raid lead.");
  }
}

function expandPresetOrThrow(input: {
  contentPreset: RunContentPresetKey;
  venomousPlannedBossCount: number;
}): ExpandedRunContent[] {
  try {
    return expandRunContentPreset({
      preset: input.contentPreset,
      venomousPlannedBossCount: input.venomousPlannedBossCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid run content preset.";
    if (message.toLowerCase().includes("planned boss count")) {
      throw new DomainError("RUN_BOSS_COUNT_INVALID", message);
    }
    throw new DomainError("VALIDATION_FAILED", message);
  }
}

/**
 * Resolve every Raid referenced by template contents. Tidebound may appear as
 * a fixed Bundle companion even when availableForRuns=false — same rule as
 * Create Run. Standalone Tide is not a Create product and is rejected unless
 * it is part of the canonical Bundle classification.
 */
async function resolveRaidsForTemplateContents(
  contents: ExpandedRunContent[],
): Promise<Map<string, RaidRecord>> {
  const raidIds = [...new Set(contents.map((row) => row.raidId))];
  const raids = await raidRepository.listByIds(raidIds);
  const byId = new Map(raids.map((raid) => [raid.id, raid]));
  const productKey = classifyRunContents(contents);

  for (const content of contents) {
    const raid = byId.get(content.raidId);
    if (!raid) {
      throw new DomainError("VALIDATION_FAILED", "Choose a supported raid.");
    }
    const tideInBundle =
      content.raidId === TIDEBOUND_GROTTO_RAID_ID && productKey === "MIDNIGHT_S2_BUNDLE";
    if (!raid.availableForRuns && !tideInBundle) {
      throw new DomainError(
        "RAID_NOT_AVAILABLE_FOR_RUNS",
        "This raid is no longer available for new templates.",
      );
    }
    assertValidPlannedBossCount(content.plannedBossCount, raid.totalBossCount);
  }

  return byId;
}

function assertOwnsTemplate(user: AuthenticatedUser, template: RunTemplateRecord): void {
  if (hasAdminAccess(user.accountRole)) return;
  if (template.raidLeadId !== user.id) {
    throw new DomainError("NOT_AUTHORIZED", "You cannot manage this template.", 403);
  }
}

async function loadOwnedTemplate(user: AuthenticatedUser, templateId: string): Promise<RunTemplateRecord> {
  const template = await runTemplateRepository.findById(templateId);
  if (!template) {
    throw new DomainError("RUN_TEMPLATE_NOT_FOUND", "Run template was not found.", 404);
  }
  assertOwnsTemplate(user, template);
  return template;
}

export type TemplateUsability = { usable: boolean; unusableReason: string | null };

/**
 * A template's usability is always computed fresh from its current joined
 * Raid/User/content state — never stored. Evaluates ALL content rows.
 * Bundle Tide (availableForRuns=false) is allowed when the contents classify
 * as the canonical Season 2 Bundle product.
 */
export function computeUsability(template: RunTemplateRecord): TemplateUsability {
  if (!template.isActive) {
    return { usable: false, unusableReason: "This template has been deactivated." };
  }
  if (!template.raidLeadEligible) {
    return { usable: false, unusableReason: "This template's raid lead is no longer eligible to lead runs." };
  }
  if (!isLootTypeAllowedForDifficulty(template.difficulty, template.lootType)) {
    return { usable: false, unusableReason: "This template's loot type is no longer valid for its difficulty." };
  }

  const contents =
    template.contents.length > 0
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

  if (contents.length === 0) {
    return { usable: false, unusableReason: "This template has no raid content." };
  }

  const productKey = classifyRunContents(contents);
  for (const content of contents) {
    const tideInBundle =
      content.raidId === TIDEBOUND_GROTTO_RAID_ID && productKey === "MIDNIGHT_S2_BUNDLE";
    if (!content.raidAvailableForRuns && !tideInBundle) {
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

  if (productKey === "CUSTOM") {
    return {
      usable: false,
      unusableReason: "This template's content combination is no longer a supported run product.",
    };
  }

  const composition = [
    template.desiredTankCount,
    template.desiredHealerCount,
    template.desiredDpsCount,
    template.desiredLootbuddyCount,
  ];
  if (composition.some((count) => !Number.isInteger(count) || count < RUN_COMPOSITION_MIN || count > RUN_COMPOSITION_MAX)) {
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

async function persistFromPreset(
  input: {
    name: string;
    contentPreset: RunContentPresetKey;
    venomousPlannedBossCount: number;
    difficulty: CreateRunTemplateInput["difficulty"];
    lootType: CreateRunTemplateInput["lootType"];
    desiredTankCount: number;
    desiredHealerCount: number;
    desiredDpsCount: number;
    desiredLootbuddyCount?: number;
    notes?: string | null;
    raidLeadId: string;
    actorId: string;
  },
  mode: "create" | "update",
  templateId: string | undefined,
  txOrm?: typeof import("@/lib/prisma").orm,
): Promise<{ id: string; contents: RunTemplateContentWriteSpec[] }> {
  const contents = expandPresetOrThrow({
    contentPreset: input.contentPreset,
    venomousPlannedBossCount: input.venomousPlannedBossCount,
  });
  await resolveRaidsForTemplateContents(contents);

  assertComposition(input.desiredTankCount, "Desired tanks");
  assertComposition(input.desiredHealerCount, "Desired healers");
  assertComposition(input.desiredDpsCount, "Desired DPS");
  assertComposition(input.desiredLootbuddyCount ?? 0, "Desired lootbuddies");
  assertValidRunLootType(input.difficulty, input.lootType);

  const fields = {
    name: input.name.trim(),
    raidLeadId: input.raidLeadId,
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

export const runTemplateService = {
  async listOwn(user: AuthenticatedUser) {
    requireManagerRole(user);
    const templates = await runTemplateRepository.listByRaidLead(user.id);
    return templates.map((template) => {
      const display = templateContentDisplay(template);
      return { ...template, ...computeUsability(template), contentDisplay: display };
    });
  },

  async listAll(user: AuthenticatedUser, filters: ManageTemplateFiltersInput = {}) {
    if (!hasAdminAccess(user.accountRole)) {
      throw new DomainError("NOT_AUTHORIZED", "Admin permission is required to manage run templates.", 403);
    }
    const templates = await runTemplateRepository.listAll({ raidLeadId: filters.raidLeadId });
    const withUsability = templates.map((template) => {
      const display = templateContentDisplay(template);
      return { ...template, ...computeUsability(template), contentDisplay: display };
    });
    const status = filters.status ?? "active";
    if (status === "all") return withUsability;
    return withUsability.filter((template) => (status === "active" ? template.isActive : !template.isActive));
  },

  async getCreateFormData(user: AuthenticatedUser) {
    requireManagerRole(user);
    await raidRepository.ensureReferenceRaids();
    const contentPresets = listCreateRunContentPresets();
    const raidLeads = hasAdminAccess(user.accountRole)
      ? await userRepository.listEligibleRaidLeads()
      : [{ id: user.id, name: user.name, accountRole: user.accountRole }];

    return {
      canAssignRaidLead: hasAdminAccess(user.accountRole),
      contentPresets,
      venomousBossMax: venomousBossMaxFromCatalog(),
      raidLeads,
    };
  },

  async createTemplate(user: AuthenticatedUser, input: CreateRunTemplateInput) {
    return this.createTemplateInTx(user, input);
  },

  /**
   * Create an independent copy of a RunTemplate (contents + composition).
   * Never copies CommunityScheduleSlots or materialization history.
   */
  async duplicateTemplate(
    user: AuthenticatedUser,
    templateId: string,
  ): Promise<{ id: string }> {
    requireManagerRole(user);
    const existing = await loadOwnedTemplate(user, templateId);
    await requireEligibleOwner(existing.raidLeadId);
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
    await resolveRaidsForTemplateContents(contents);

    const id = await runTemplateRepository.create({
      name: `${existing.name} (copy)`.slice(0, 80),
      raidLeadId: existing.raidLeadId,
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

  /**
   * Validate + persist a RunTemplate, optionally inside an outer transaction
   * (e.g. Community Schedule plan create). Same rules as createTemplate.
   */
  async createTemplateInTx(
    user: AuthenticatedUser,
    input: CreateRunTemplateInput,
    txOrm?: typeof import("@/lib/prisma").orm,
  ) {
    requireManagerRole(user);
    const raidLeadId = resolveTemplateOwnerId(user, input.raidLeadId);
    await requireEligibleOwner(raidLeadId);
    await raidRepository.ensureReferenceRaids();

    const { id } = await persistFromPreset(
      {
        name: input.name,
        contentPreset: input.contentPreset,
        venomousPlannedBossCount: input.venomousPlannedBossCount,
        difficulty: input.difficulty,
        lootType: input.lootType,
        desiredTankCount: input.desiredTankCount,
        desiredHealerCount: input.desiredHealerCount,
        desiredDpsCount: input.desiredDpsCount,
        desiredLootbuddyCount: input.desiredLootbuddyCount,
        notes: input.notes,
        raidLeadId,
        actorId: user.id,
      },
      "create",
      undefined,
      txOrm,
    );

    return { id };
  },

  async updateTemplate(user: AuthenticatedUser, input: UpdateRunTemplateInput) {
    requireManagerRole(user);
    const existing = await loadOwnedTemplate(user, input.templateId);
    // ADMIN may reassign the owner (future use only — never touches existing
    // Runs); a RAID_LEAD may only ever keep their own templates their own.
    const raidLeadId = resolveTemplateOwnerId(user, input.raidLeadId ?? existing.raidLeadId);
    await requireEligibleOwner(raidLeadId);
    await raidRepository.ensureReferenceRaids();

    const desiredLootbuddyCount = input.desiredLootbuddyCount ?? existing.desiredLootbuddyCount;
    await persistFromPreset(
      {
        name: input.name,
        contentPreset: input.contentPreset,
        venomousPlannedBossCount: input.venomousPlannedBossCount,
        difficulty: input.difficulty,
        lootType: input.lootType,
        desiredTankCount: input.desiredTankCount,
        desiredHealerCount: input.desiredHealerCount,
        desiredDpsCount: input.desiredDpsCount,
        desiredLootbuddyCount,
        notes: input.notes,
        raidLeadId,
        actorId: user.id,
      },
      "update",
      existing.id,
    );

    return { id: existing.id };
  },

  async deactivate(user: AuthenticatedUser, templateId: string) {
    requireManagerRole(user);
    const existing = await loadOwnedTemplate(user, templateId);
    if (!existing.isActive) {
      throw new DomainError("RUN_TEMPLATE_ALREADY_INACTIVE", "This template is already inactive.");
    }
    await runTemplateRepository.setActive(existing.id, false, user.id);
    return { id: existing.id };
  },

  /**
   * Reactivation must re-validate current domain state — never blindly flips
   * the flag back on. If the raid has since gone historical, the owner is no
   * longer eligible, or any other usability check now fails, reactivation is
   * rejected with the same reason the selector would show.
   */
  async reactivate(user: AuthenticatedUser, templateId: string) {
    requireManagerRole(user);
    const existing = await loadOwnedTemplate(user, templateId);
    if (existing.isActive) {
      throw new DomainError("RUN_TEMPLATE_ALREADY_ACTIVE", "This template is already active.");
    }
    const usability = computeUsability({ ...existing, isActive: true });
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
    requireManagerRole(user);
    const templates = hasAdminAccess(user.accountRole)
      ? await runTemplateRepository.listAll()
      : await runTemplateRepository.listByRaidLead(user.id);
    return templates
      .map((template) => ({ ...template, ...computeUsability(template) }))
      .filter((template) => template.isActive && template.usable);
  },

  /**
   * Used by run.service.ts's createManyRuns integration when a templateId is
   * present: loads the template fresh from the DB (never trusting a
   * client-supplied DTO), authorizes the actor's use of it, and confirms it
   * is still usable — all BEFORE any Run row is prepared or persisted. The
   * returned record's raidLeadId is authoritative for every resulting Run.
   */
  async resolveTemplateForUse(user: AuthenticatedUser, templateId: string): Promise<RunTemplateRecord> {
    const template = await runTemplateRepository.findById(templateId);
    if (!template) {
      throw new DomainError(
        "RUN_TEMPLATE_NOT_FOUND",
        "This template could not be found. Reload and try again.",
        404,
      );
    }
    if (!hasAdminAccess(user.accountRole) && template.raidLeadId !== user.id) {
      throw new DomainError("NOT_AUTHORIZED", "You cannot use this template.", 403);
    }
    const usability = computeUsability(template);
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
export type CreateRunTemplateFormData = Awaited<ReturnType<typeof runTemplateService.getCreateFormData>>;
