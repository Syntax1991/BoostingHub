import type { WowRegion } from "@/models/enums";

export type WarcraftLogsConfig = {
  clientId: string;
  clientSecret: string;
};

/**
 * Optional public Warcraft Logs API credentials (client-credentials only).
 * Missing config must never fail app startup — WCL is enrichment-only.
 */
export function isWarcraftLogsConfigured(): boolean {
  const clientId = process.env.WARCRAFT_LOGS_CLIENT_ID?.trim();
  const clientSecret = process.env.WARCRAFT_LOGS_CLIENT_SECRET?.trim();
  return Boolean(clientId && clientSecret);
}

/** Returns null when credentials are absent — callers treat WCL as unavailable. */
export function getWarcraftLogsConfigOrNull(): WarcraftLogsConfig | null {
  const clientId = process.env.WARCRAFT_LOGS_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.WARCRAFT_LOGS_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) {
    return null;
  }
  return { clientId, clientSecret };
}

export function warcraftLogsOAuthTokenUrl(): string {
  return "https://www.warcraftlogs.com/oauth/token";
}

/** Public GraphQL endpoint for the client-credentials flow. */
export function warcraftLogsGraphqlUrl(): string {
  return "https://www.warcraftlogs.com/api/v2/client";
}

/**
 * BoostingHub region → WCL `serverRegion`.
 * Returns null for unsupported regions (never invent a lookup).
 */
export function toWarcraftLogsServerRegion(region: WowRegion): "EU" | "US" | null {
  if (region === "EU") return "EU";
  if (region === "US") return "US";
  return null;
}

/** Comma/space separated Discord snowflakes; anything else is ignored, duplicates dropped. */
function snowflakeList(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(/[\s,]+/)
        .map((entry) => entry.trim())
        .filter((entry) => /^\d{15,25}$/.test(entry)),
    ),
  ];
}

/**
 * Discord AUTHOR ids of trusted log bots / webhooks (for a webhook post
 * Discord sets author.id to the webhook id). Only their report links are used.
 * Empty = automatic linking is off.
 */
export function trustedWarcraftLogsReportAuthorIds(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  return snowflakeList(env.DISCORD_WCL_REPORT_AUTHOR_IDS);
}

/**
 * Discord CHANNEL ids of dedicated log channels where the trusted log bot
 * posts reports for all Runs (not ids of authors). Reports found there are
 * matched to Runs centrally. Empty = central discovery is off; a trusted link
 * posted in a Run's own channel still works.
 */
export function warcraftLogsReportChannelIds(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  return snowflakeList(env.DISCORD_WCL_REPORT_CHANNEL_IDS);
}
