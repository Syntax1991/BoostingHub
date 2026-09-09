import { DomainError } from "@/lib/errors";
import type { WowRegion } from "@/models/enums";

export type BlizzardConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

const OAUTH_HOST = "https://oauth.battle.net";

/**
 * Battle.net OAuth + regional API hosts.
 * Discord remains login; these credentials only enable optional game-account linking.
 */
export function isBlizzardConfigured(): boolean {
  const clientId = process.env.BLIZZARD_CLIENT_ID?.trim();
  const clientSecret = process.env.BLIZZARD_CLIENT_SECRET?.trim();
  const redirectUri = process.env.BLIZZARD_REDIRECT_URI?.trim();
  return Boolean(clientId && clientSecret && redirectUri);
}

export function getBlizzardConfig(): BlizzardConfig {
  const clientId = process.env.BLIZZARD_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.BLIZZARD_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = process.env.BLIZZARD_REDIRECT_URI?.trim() ?? "";

  if (!clientId || !clientSecret || !redirectUri) {
    throw new DomainError(
      "BATTLENET_NOT_CONFIGURED",
      "Battle.net integration is not configured.",
      503,
    );
  }

  return { clientId, clientSecret, redirectUri };
}

export function blizzardOAuthAuthorizeUrl(): string {
  return `${OAUTH_HOST}/authorize`;
}

export function blizzardOAuthTokenUrl(): string {
  return `${OAUTH_HOST}/token`;
}

export function blizzardOAuthUserInfoUrl(): string {
  return `${OAUTH_HOST}/userinfo`;
}

export function blizzardApiHost(region: WowRegion): string {
  return region === "EU" ? "https://eu.api.blizzard.com" : "https://us.api.blizzard.com";
}

export function blizzardProfileNamespace(region: WowRegion): string {
  return region === "EU" ? "profile-eu" : "profile-us";
}

export function blizzardLocale(region: WowRegion): string {
  return region === "EU" ? "en_GB" : "en_US";
}
