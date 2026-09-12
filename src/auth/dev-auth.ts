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

/**
 * Gates the development account bootstrap (see dev-account-bootstrap.service.ts).
 * Code-level gate, not just configuration: NODE_ENV=production disables this
 * even if DEV_ACCOUNT_BOOTSTRAP_ENABLED is accidentally left "true" in a
 * deployed environment's variables.
 */
export function isDevAccountBootstrapEnabled(): boolean {
  return !isProductionRuntime() && process.env.DEV_ACCOUNT_BOOTSTRAP_ENABLED === "true";
}

/** The one Discord snowflake eligible for bootstrap. Never username/email/display name. */
export function getDevAdminDiscordUserId(): string | null {
  return process.env.DEV_ADMIN_DISCORD_USER_ID?.trim() || null;
}
