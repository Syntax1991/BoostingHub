import { getOptionalUser } from "@/auth/session";
import { isDevAuthEnabled, isDiscordOAuthConfigured } from "@/auth/dev-auth";
import { userRepository } from "@/repositories/user.repository";

export const authPageController = {
  async getLoginPage() {
    const user = await getOptionalUser();
    const identities = isDevAuthEnabled() ? await userRepository.listDevIdentities() : [];

    return {
      user,
      discordEnabled: isDiscordOAuthConfigured(),
      devAuthEnabled: isDevAuthEnabled(),
      identities,
    };
  },
};
