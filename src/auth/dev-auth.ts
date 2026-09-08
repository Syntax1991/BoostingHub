/**
 * Development authentication is a local-only identity picker.
 * It must never become a silent production bypass.
 */
export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export function isDevAuthEnabled(): boolean {
  return !isProductionRuntime() && process.env.DEV_AUTH_ENABLED === "true";
}

export function isDiscordOAuthConfigured(): boolean {
  return Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);
}

export function getDevAuthPassword(): string {
  return process.env.DEV_AUTH_PASSWORD ?? "dev-login-only";
}
