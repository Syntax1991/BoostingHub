import { NextRequest } from "next/server";

/** Base URL the route handlers see; never resolved on the network. */
export const BOT_API_TEST_ORIGIN = "http://bot-api.test";

/**
 * Sets BOOSTINGHUB_BOT_API_TOKEN for a suite and returns the restore function.
 * Assigned directly rather than with vi.stubEnv, so a nested vi.unstubAllEnvs()
 * cannot drop the credential mid-suite.
 */
export function installBotApiToken(token: string): () => void {
  const original = process.env.BOOSTINGHUB_BOT_API_TOKEN;
  process.env.BOOSTINGHUB_BOT_API_TOKEN = token;
  return () => {
    if (original === undefined) delete process.env.BOOSTINGHUB_BOT_API_TOKEN;
    else process.env.BOOSTINGHUB_BOT_API_TOKEN = original;
  };
}

/**
 * A request to a bot route. `token` adds the bot credential, `actingDiscordUserId`
 * the Discord user the bot acts for, and a `body` is sent as JSON.
 */
export function botRequest(
  path: string,
  options: { method?: "GET" | "POST" | "PUT"; token?: string; actingDiscordUserId?: string; body?: unknown } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  if (options.actingDiscordUserId !== undefined) headers["x-discord-user-id"] = options.actingDiscordUserId;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(new URL(path, BOT_API_TEST_ORIGIN), {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

/** The `context` argument of a `/runs/[runId]/…` route handler. */
export function runRouteParams(runId: string) {
  return { params: Promise.resolve({ runId }) };
}
