import { requireUserOrRedirect } from "@/auth/session";
import { parseRunFilters } from "@/validators/run-filters";
import { characterService } from "@/services/character.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";
import { profileService } from "@/services/profile.service";
import { requireAdminOrRedirect, requireManagerOrRedirect } from "@/auth/session";
import { rosterService } from "@/services/roster.service";
import { boosterAccessService } from "@/services/booster-access.service";
import { parseAdminAccessFilters } from "@/validators/booster-access-filters";

export const characterController = {
  async getCharactersPage() {
    const user = await requireUserOrRedirect("/characters");
    return characterService.getCharacterPage(user);
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
  async getManageRunsPage() {
    const user = await requireManagerOrRedirect();
    return rosterService.listManagedRuns(user);
  },

  async getRosterPage(runId: string) {
    const user = await requireManagerOrRedirect();
    return rosterService.getRosterManagementView(user, runId);
  },

  async getBoosterAccessPage(searchParams: {
    status?: string | string[];
    difficulty?: string | string[];
    role?: string | string[];
    query?: string | string[];
  }) {
    const user = await requireAdminOrRedirect();
    const filters = parseAdminAccessFilters(searchParams);
    return {
      filters: {
        status: filters.status ?? "PENDING",
        difficulty: filters.difficulty,
        role: filters.role,
        query: filters.query,
      },
      requests: await boosterAccessService.listAdminAccessRequests(user, {
        status: filters.status ?? "PENDING",
        difficulty: filters.difficulty,
        role: filters.role,
        query: filters.query,
      }),
    };
  },
};
