import { afterAll } from "vitest";

/**
 * Test-only guard: the game-data APIs (Warcraft Logs, Blizzard / Battle.net,
 * Raider.IO) must never be called for real from the test suite. A local .env
 * with real credentials otherwise turns best-effort enrichment into live
 * network calls, making test timing depend on external services.
 *
 * Wraps the global fetch present at setup time: a request to one of these
 * hosts is rejected AND recorded, and the test file fails in afterAll — so a
 * call the application swallows (enrichment is best-effort and never throws)
 * still surfaces. Suites that unit-test a client stub fetch themselves
 * (vi.stubGlobal / vi.spyOn), which replaces this wrapper while they run.
 * Every other request (local database, app routes) is untouched.
 */
const BLOCKED_HOST_SUFFIXES = ["warcraftlogs.com", "battle.net", "blizzard.com", "raider.io"];

function blockedHost(input: RequestInfo | URL): string | null {
  try {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const host = url.hostname.toLowerCase();
    return BLOCKED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`)) ? host : null;
  } catch {
    return null;
  }
}

const escaped: string[] = [];
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const host = blockedHost(input);
  if (host) {
    escaped.push(host);
    throw new Error(`[external-api-guard] live request to ${host} blocked in tests — mock the API client.`);
  }
  return realFetch(input, init);
}) as typeof fetch;

afterAll(() => {
  if (escaped.length > 0) {
    const counts = [...new Set(escaped)].map((host) => `${host} ×${escaped.filter((h) => h === host).length}`);
    throw new Error(`[external-api-guard] unmocked external API requests in this file: ${counts.join(", ")}`);
  }
});
