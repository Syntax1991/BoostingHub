import { requireUserOrRedirect } from "@/auth/session";
import { parseRunFilters } from "@/validators/run-filters";
import { parseManageRunFilters } from "@/validators/manage-run-filters";
import { characterService } from "@/services/character.service";
import { battleNetService } from "@/services/battle-net.service";
import { characterBlizzardService } from "@/services/character-blizzard.service";
import { runService } from "@/services/run.service";
import { runDetailService } from "@/services/run-detail.service";
import { signupService } from "@/services/signup.service";
import { profileService } from "@/services/profile.service";
import { requireAdminOrRedirect, requireManagerOrRedirect } from "@/auth/session";
import { boosterAccessService } from "@/services/booster-access.service";
import { managementHubService } from "@/services/management-hub.service";
import { userManagementService } from "@/services/user-management.service";
import { userRepository } from "@/repositories/user.repository";
import { parseAdminAccessFilters } from "@/validators/booster-access-filters";
import { parseAdminUserFilters } from "@/validators/user-management";
import { isDomainError } from "@/lib/errors";

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
  } = {}) {
    const user = await requireUserOrRedirect("/characters");
    const page = await characterService.getCharacterPage(user);
    const importSessionId = firstParam(searchParams.importSession);
    const battleNet = await battleNetService.getCharacterPagePanel(user, importSessionId);

    const candidatesByRegion: Partial<
      Record<
        "EU" | "US",
        Awaited<ReturnType<typeof characterBlizzardService.resolveImportCandidates>>
      >
    > = {};

    for (const session of battleNet.liveSessions) {
      try {
        candidatesByRegion[session.region] =
          await characterBlizzardService.resolveImportCandidates(user, session.id);
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
      runs: await runService.listRuns(user, filters),
    };
  },

  async getRunDetailPage(runId: string) {
    const user = await requireUserOrRedirect(`/runs/${runId}`);
    return runDetailService.getRunDetail(user, runId);
  },
};

export const signupController = {
  async getMyRunsPage() {
    const user = await requireUserOrRedirect("/my-runs");
    return signupService.getMyRuns(user);
  },
};

export const profileController = {
  async getProfilePage() {
    const user = await requireUserOrRedirect("/profile");
    return profileService.getProfile(user);
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
  } = {}) {
    const user = await requireManagerOrRedirect();
    const filters = parseManageRunFilters(searchParams);
    return runService.getManagedRunsPage(user, filters);
  },

  async getCreateRunPage() {
    const user = await requireManagerOrRedirect();
    return runService.getCreateForm(user);
  },

  async getBoosterAccessPage(searchParams: {
    view?: string | string[];
    status?: string | string[];
    difficulty?: string | string[];
    role?: string | string[];
    query?: string | string[];
    userId?: string | string[];
  }) {
    const user = await requireAdminOrRedirect();
    const filters = parseAdminAccessFilters(searchParams);
    const view = filters.view ?? "qualifications";
    const grantCandidates = await userRepository.listAdminUsers({ sort: "name" });
    const listed = await boosterAccessService.listAdminAccessRequests(user, {
      view,
      status: filters.status,
      difficulty: filters.difficulty,
      role: filters.role,
      query: filters.query,
      userId: filters.userId,
    });
    return {
      view: listed.view,
      legacyPendingCount: listed.legacyPendingCount,
      approvedQualificationCount: listed.approvedQualificationCount,
      filters: {
        view: listed.view,
        status: listed.view === "legacy" ? "PENDING" : (filters.status ?? "ALL"),
        difficulty: filters.difficulty,
        role: filters.role,
        query: filters.query,
        userId: filters.userId,
      },
      grantUsers: grantCandidates.map((row) => ({
        id: row.id,
        name: row.name,
        discordUsername: row.discordUsername,
      })),
      qualifications: listed.qualifications,
      legacyRequests: listed.legacyRequests,
    };
  },

  async getUsersPage(searchParams: {
    query?: string | string[];
    role?: string | string[];
    access?: string | string[];
    sort?: string | string[];
  } = {}) {
    const user = await requireAdminOrRedirect("/manage/users");
    const filters = parseAdminUserFilters(searchParams);
    return {
      filters,
      users: await userManagementService.listUsers(user, filters),
    };
  },

  async getUserDetailPage(userId: string) {
    const user = await requireAdminOrRedirect("/manage/users");
    return userManagementService.getUserDetail(user, userId);
  },
};
