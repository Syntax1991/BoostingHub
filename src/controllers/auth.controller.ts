import { getOptionalUser } from "@/auth/session";
import { isDevAuthEnabled, isDiscordOAuthConfigured } from "@/auth/dev-auth";
import { devIdentityService } from "@/services/dev-identity.service";

export const authPageController = {
  async getLoginPage() {
    const user = await getOptionalUser();
    const identities = isDevAuthEnabled() ? await devIdentityService.list() : [];

    return {
      user,
      discordEnabled: isDiscordOAuthConfigured(),
      devAuthEnabled: isDevAuthEnabled(),
      identities,
    };
  },
};
