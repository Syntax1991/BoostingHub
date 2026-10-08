import { requireUserOrRedirect } from "@/auth/session";
import { canAccessManagement } from "@/auth/authorization";
import { redirect } from "next/navigation";
import { parseRunFilters } from "@/validators/run-filters";
import { parseManageRunFilters } from "@/validators/manage-run-filters";
import { characterService } from "@/services/character.service";
import { battleNetService } from "@/services/battle-net.service";
import { characterBlizzardImportService } from "@/services/character-blizzard-import.service";
import { runService } from "@/services/run.service";
import { runDetailService } from "@/services/run-detail.service";
import { signupService } from "@/services/signup.service";
import { profileService } from "@/services/profile.service";
import { notificationService } from "@/services/notification.service";
import { settingsService } from "@/services/settings.service";
import { sessionManagementService } from "@/services/session-management.service";
import { runTemplateService } from "@/services/run-template.service";
import { requireAdminOrRedirect, requireManagerOrRedirect } from "@/auth/session";
import { parseManageTemplateFilters } from "@/validators/run-template";
import { managementHubService } from "@/services/management-hub.service";
import { userManagementService } from "@/services/user-management.service";
import { parseAdminUserFilters } from "@/validators/user-management";
import { characterOperationsService } from "@/services/character-operations.service";
import { parseCharacterOperationsFilters } from "@/validators/character-operations";
import { systemHealthService } from "@/services/system-health.service";
import { contentCatalogService } from "@/services/content-catalog.service";
import { parseSystemHealthFilters } from "@/validators/system-health";
import { operationalAnalyticsService } from "@/services/operational-analytics.service";
import { communityScheduleService } from "@/services/community-schedule.service";
import { isDomainError } from "@/lib/errors";
import { runCreatePath } from "@/lib/run-routes";

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].length > 0) {
    return value[0];
  }
  return null;
}

export const characterController = {
  async getCharactersPage(searchParams: {
    importSession?: string | string[];
    battlenet?: string | string[];
    region?: string | string[];
    code?: string | string[];
    linked?: string | string[];
  } = {}) {
    const user = await requireUserOrRedirect("/characters");
    const page = await characterService.getCharacterPage(user);
    const importSessionId = firstParam(searchParams.importSession);
    const battleNet = await battleNetService.getCharacterPagePanel(user, importSessionId);

    const candidatesByRegion: Partial<
      Record<
        "EU" | "US",
        Awaited<ReturnType<typeof characterBlizzardImportService.resolveImportCandidates>>
      >
    > = {};

    for (const session of battleNet.liveSessions) {
      try {
        candidatesByRegion[session.region] =
          await characterBlizzardImportService.resolveImportCandidates(user, session.id);
      } catch (error) {
        if (!isDomainError(error)) throw error;
      }
    }

    const preferredRegion = battleNet.importSession?.region;
    const candidates =
      (preferredRegion ? candidatesByRegion[preferredRegion] : null) ??
      Object.values(candidatesByRegion)[0] ??
      null;

    return {
      ...page,
      battleNet: {
        configured: battleNet.configured,
        connections: battleNet.connections,
        importSession: battleNet.importSession,
        liveSessions: battleNet.liveSessions,
        candidates,
        candidatesByRegion,
      },
      battleNetFlash: {
        status: firstParam(searchParams.battlenet),
        region: firstParam(searchParams.region),
        code: firstParam(searchParams.code),
        linked: Math.max(0, Number.parseInt(firstParam(searchParams.linked) ?? "", 10) || 0),
        importSessionId,
      },
    };
  },

  async getCharacterDetailsPage(characterId: string) {
    const user = await requireUserOrRedirect("/characters");
    return characterService.getCharacterDetails(user, characterId);
  },
};

export const runController = {
  async getRunsPage(searchParams: { difficulty?: string | string[]; status?: string | string[] }) {
    const user = await requireUserOrRedirect("/runs");
    const filters = parseRunFilters(searchParams);
    return {
      filters,
      canCreate: canAccessManagement(user.accountRole),
      runs: await runService.listRuns(user, filters),
    };
  },

  async getRunDetailPage(runId: string) {
    const user = await requireUserOrRedirect(`/runs/${runId}`);
    return runDetailService.getRunDetail(user, runId);
  },

  /** Canonical Create Run page — RAID_LEAD/ADMIN only. */
  async getCreateRunsPage() {
    const user = await requireUserOrRedirect(runCreatePath());
    if (!canAccessManagement(user.accountRole)) {
      redirect("/dashboard");
    }
    return runService.getCreateManyForm(user);
  },
};

export const signupController = {
  async getMyRunsPage() {
    const user = await requireUserOrRedirect("/my-runs");
    return signupService.getMyRuns(user);
  },
};

export const notificationController = {
  async getNotificationsPage() {
    const user = await requireUserOrRedirect("/notifications");
    return notificationService.listPage(user);
  },

  async getBellData() {
    const user = await requireUserOrRedirect("/dashboard");
    return notificationService.getBellData(user);
  },
};

export const settingsController = {
  async getSettingsPage() {
    const user = await requireUserOrRedirect("/settings");
    const [settings, sessions] = await Promise.all([
      settingsService.getSettings(user),
      sessionManagementService.listOwnSessions(),
    ]);
    return { ...settings, sessions };
  },
};

export const profileController = {
  async getProfilePage() {
    const user = await requireUserOrRedirect("/profile");
    return profileService.getProfile(user);
  },

  /**
   * RAID_LEAD/ADMIN self-service: only the actor's own templates, never
   * another's. Unlike ADMIN management, the raid lead selector is always
   * hidden here — even an ADMIN acting on this page may only own the
   * template as themselves, never assign it to someone else.
   */
  async getMyTemplatesPage() {
    const user = await requireManagerOrRedirect();
    const [templates, formData] = await Promise.all([
      runTemplateService.listOwn(user),
      runTemplateService.getCreateFormData(user),
    ]);
    return {
      templates,
      contentPresets: formData.contentPresets,
      venomousBossMax: formData.venomousBossMax,
      raidLeads: [{ id: user.id, name: user.name, accountRole: user.accountRole }],
      canAssignRaidLead: false,
      defaultRaidLeadId: user.id,
    };
  },
};

export const managementController = {
  async getManageHomePage() {
    const user = await requireManagerOrRedirect();
    return managementHubService.getOverview(user);
  },

  async getManageRunsPage(searchParams: {
    status?: string | string[];
    raidLeadId?: string | string[];
    timeframe?: string | string[];
    archived?: string | string[];
  } = {}) {
    const user = await requireManagerOrRedirect();
    const filters = parseManageRunFilters(searchParams);
    return runService.getManagedRunsPage(user, filters);
  },

  // Note: no single-Run getCreateRunPage anymore — Run creation is one
  // canonical workflow at /runs/create. runService.getCreateForm
  // remains for internal/test use only.
  // Legacy /manage/runs/create redirects to runController.getCreateRunsPage.

  /** @deprecated Prefer runController.getCreateRunsPage — kept for any residual callers. */
  async getCreateManyRunsPage() {
    const user = await requireManagerOrRedirect();
    return runService.getCreateManyForm(user);
  },

  /** RAID_LEAD+ read Community Schedule; ADMIN/OWNER may mutate via actions. */
  async getManageSchedulePage() {
    const user = await requireManagerOrRedirect();
    return communityScheduleService.getPage(user);
  },

  /** ADMIN-only global view across every Raid Lead's templates. */
  async getManageTemplatesPage(searchParams: {
    raidLeadId?: string | string[];
    status?: string | string[];
  } = {}) {
    const user = await requireAdminOrRedirect("/manage/templates");
    const filters = parseManageTemplateFilters(searchParams);
    const [templates, formData] = await Promise.all([
      runTemplateService.listAll(user, filters),
      runTemplateService.getCreateFormData(user),
    ]);
    return {
      templates,
      filters: { ...filters, status: filters.status ?? "active" },
      ...formData,
      defaultRaidLeadId: formData.raidLeads[0]?.id ?? user.id,
    };
  },

  async getUsersPage(searchParams: {
    view?: string | string[];
    query?: string | string[];
    role?: string | string[];
    boostingRole?: string | string[];
    accountStatus?: string | string[];
    pendingAccess?: string | string[];
    sort?: string | string[];
    difficulty?: string | string[];
    requestedRole?: string | string[];
  } = {}) {
    const user = await requireAdminOrRedirect("/manage/users");
    const filters = parseAdminUserFilters(searchParams);
    return userManagementService.getUsersAdminPage(user, filters);
  },

  async getUserDetailPage(userId: string) {
    const user = await requireAdminOrRedirect("/manage/users");
    return userManagementService.getUserDetail(user, userId);
  },

  async getCharactersPage(searchParams: Record<string, string | string[] | undefined> = {}) {
    const user = await requireAdminOrRedirect("/manage/characters");
    return characterOperationsService.getListPage(user, parseCharacterOperationsFilters(searchParams));
  },

  async getCharacterOperationsPage(characterId: string) {
    const user = await requireAdminOrRedirect("/manage/characters");
    return characterOperationsService.getDetail(user, characterId);
  },

  async getContentPage() {
    const user = await requireAdminOrRedirect("/manage/content");
    return contentCatalogService.getPage(user);
  },

  async getContentRaidPage(raidId: string) {
    const user = await requireAdminOrRedirect(`/manage/content/raids/${raidId}`);
    return contentCatalogService.getRaidDetail(user, raidId);
  },

  async getSystemHealthPage(searchParams: Record<string, string | string[] | undefined> = {}) {
    const user = await requireAdminOrRedirect("/manage/system");
    return systemHealthService.getPage(user, parseSystemHealthFilters(searchParams));
  },

  async getAnalyticsPage(searchParams: Record<string, string | string[] | undefined> = {}) {
    const user = await requireAdminOrRedirect("/manage/analytics");
    return operationalAnalyticsService.getReport(user, {
      from: firstParam(searchParams.from),
      to: firstParam(searchParams.to),
    });
  },
};
