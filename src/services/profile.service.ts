import type { AuthenticatedUser } from "@/auth/authorization";
import { boosterQualificationRepository } from "@/repositories/booster-qualification.repository";
import { characterRepository } from "@/repositories/character.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { boosterQualificationService } from "@/services/booster-qualification.service";

export const profileService = {
  async getProfile(user: AuthenticatedUser) {
    const [characters, qualifications, signups] = await Promise.all([
      characterRepository.listByUserId(user.id),
      boosterQualificationRepository.listByUserId(user.id),
      signupRepository.listByUserId(user.id),
    ]);

    return {
      user,
      characterCount: characters.length,
      activeCharacterCount: characters.filter((character) => character.isActive).length,
      boosterAccess: boosterQualificationService.summarize(qualifications),
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
