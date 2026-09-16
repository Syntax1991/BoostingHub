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
