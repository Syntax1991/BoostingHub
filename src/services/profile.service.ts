import type { AuthenticatedUser } from "@/auth/authorization";
import { boosterAccessRepository } from "@/repositories/booster-access.repository";
import { characterRepository } from "@/repositories/character.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { boosterAccessService } from "@/services/booster-access.service";

export const profileService = {
  async getProfile(user: AuthenticatedUser) {
    const [characters, access, signups] = await Promise.all([
      characterRepository.listByUserId(user.id),
      boosterAccessRepository.listByUserId(user.id),
      signupRepository.listByUserId(user.id),
    ]);

    return {
      user,
      characterCount: characters.length,
      activeCharacterCount: characters.filter((character) => character.isActive).length,
      boosterAccess: boosterAccessService.summarize(access),
      participation: {
        boosterSignups: signups.filter((signup) => signup.participationType === "BOOSTER").length,
        lootbuddySignups: signups.filter((signup) => signup.participationType === "LOOTBUDDY").length,
        selected: signups.filter((signup) => signup.status === "SELECTED").length,
        pending: signups.filter((signup) => signup.status === "PENDING").length,
        notSelected: signups.filter((signup) => signup.status === "NOT_SELECTED").length,
      },
    };
  },
};
