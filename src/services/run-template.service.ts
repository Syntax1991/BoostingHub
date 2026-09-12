import type { AuthenticatedUser } from "@/auth/authorization";
import { hasAdminAccess, isEligibleRaidLead } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { raidRepository } from "@/repositories/raid.repository";
import { runTemplateRepository, type RunTemplateRecord } from "@/repositories/run-template.repository";
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

/** New-selection boundary: create/edit may only target a currently available raid. */
async function requireRaidAvailable(raidId: string) {
  const raid = await raidRepository.findById(raidId);
  if (!raid) {
    throw new DomainError("VALIDATION_FAILED", "Choose a supported raid.");
  }
  if (!raid.availableForRuns) {
    throw new DomainError(
      "RAID_NOT_AVAILABLE_FOR_RUNS",
      "This raid is no longer available for new templates.",
    );
  }
  return raid;
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
 * Raid/User state — never stored, never mutated by a Raid/User change. An
 * invalid template stays exactly as-is; it just stops being offered for new
 * Run creation until whatever went stale is fixed (or it's reactivated after
 * re-validation).
 */
export function computeUsability(template: RunTemplateRecord): TemplateUsability {
  if (!template.isActive) {
    return { usable: false, unusableReason: "This template has been deactivated." };
  }
  if (!template.raidAvailableForRuns) {
    return { usable: false, unusableReason: "This template's raid is no longer available for new runs." };
  }
  if (!template.raidLeadEligible) {
    return { usable: false, unusableReason: "This template's raid lead is no longer eligible to lead runs." };
  }
  if (!isLootTypeAllowedForDifficulty(template.difficulty, template.lootType)) {
    return { usable: false, unusableReason: "This template's loot type is no longer valid for its difficulty." };
  }
  if (
    !Number.isInteger(template.plannedBossCount) ||
    template.plannedBossCount < 1 ||
    template.plannedBossCount > template.totalBossCount
  ) {
    return { usable: false, unusableReason: "This template's planned boss count is no longer valid for its raid." };
  }
  const composition = [template.desiredTankCount, template.desiredHealerCount, template.desiredDpsCount];
  if (composition.some((count) => !Number.isInteger(count) || count < RUN_COMPOSITION_MIN || count > RUN_COMPOSITION_MAX)) {
    return { usable: false, unusableReason: "This template's composition is no longer valid." };
  }
  return { usable: true, unusableReason: null };
}

export const runTemplateService = {
  async listOwn(user: AuthenticatedUser) {
    requireManagerRole(user);
    const templates = await runTemplateRepository.listByRaidLead(user.id);
    return templates.map((template) => ({ ...template, ...computeUsability(template) }));
  },

  async listAll(user: AuthenticatedUser, filters: ManageTemplateFiltersInput = {}) {
    if (!hasAdminAccess(user.accountRole)) {
      throw new DomainError("NOT_AUTHORIZED", "Admin permission is required to manage run templates.", 403);
    }
    const templates = await runTemplateRepository.listAll({ raidLeadId: filters.raidLeadId });
    const withUsability = templates.map((template) => ({ ...template, ...computeUsability(template) }));
    const status = filters.status ?? "active";
    if (status === "all") return withUsability;
    return withUsability.filter((template) => (status === "active" ? template.isActive : !template.isActive));
  },

  async getCreateFormData(user: AuthenticatedUser) {
    requireManagerRole(user);
    await raidRepository.ensureReferenceRaids();
    const raids = await raidRepository.listAvailableForRuns();
    const raidLeads = hasAdminAccess(user.accountRole)
      ? await userRepository.listEligibleRaidLeads()
      : [{ id: user.id, name: user.name, accountRole: user.accountRole }];

    return {
      canAssignRaidLead: hasAdminAccess(user.accountRole),
      raids,
      raidLeads,
    };
  },

  async createTemplate(user: AuthenticatedUser, input: CreateRunTemplateInput) {
    requireManagerRole(user);
    const raidLeadId = resolveTemplateOwnerId(user, input.raidLeadId);
    await requireEligibleOwner(raidLeadId);
    const raid = await requireRaidAvailable(input.raidId);

    assertComposition(input.desiredTankCount, "Desired tanks");
    assertComposition(input.desiredHealerCount, "Desired healers");
    assertComposition(input.desiredDpsCount, "Desired DPS");
    assertValidRunLootType(input.difficulty, input.lootType);
    assertValidPlannedBossCount(input.plannedBossCount, raid.totalBossCount);

    const id = await runTemplateRepository.create({
      name: input.name.trim(),
      raidLeadId,
      raidId: raid.id,
      difficulty: input.difficulty,
      lootType: input.lootType,
      plannedBossCount: input.plannedBossCount,
      desiredTankCount: input.desiredTankCount,
      desiredHealerCount: input.desiredHealerCount,
      desiredDpsCount: input.desiredDpsCount,
      notes: notesValue(input.notes),
      createdById: user.id,
      updatedById: user.id,
    });

    return { id };
  },

  async updateTemplate(user: AuthenticatedUser, input: UpdateRunTemplateInput) {
    requireManagerRole(user);
    const existing = await loadOwnedTemplate(user, input.templateId);
    // ADMIN may reassign the owner (future use only — never touches existing
    // Runs); a RAID_LEAD may only ever keep their own templates their own.
    const raidLeadId = resolveTemplateOwnerId(user, input.raidLeadId ?? existing.raidLeadId);
    await requireEligibleOwner(raidLeadId);
    const raid = await requireRaidAvailable(input.raidId);

    assertComposition(input.desiredTankCount, "Desired tanks");
    assertComposition(input.desiredHealerCount, "Desired healers");
    assertComposition(input.desiredDpsCount, "Desired DPS");
    assertValidRunLootType(input.difficulty, input.lootType);
    assertValidPlannedBossCount(input.plannedBossCount, raid.totalBossCount);

    await runTemplateRepository.update(existing.id, {
      name: input.name.trim(),
      raidLeadId,
      raidId: raid.id,
      difficulty: input.difficulty,
      lootType: input.lootType,
      plannedBossCount: input.plannedBossCount,
      desiredTankCount: input.desiredTankCount,
      desiredHealerCount: input.desiredHealerCount,
      desiredDpsCount: input.desiredDpsCount,
      notes: notesValue(input.notes),
      updatedById: user.id,
    });

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
