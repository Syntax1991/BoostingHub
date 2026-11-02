import { readdirSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { srcPath } from "@tests/helpers/repo-paths";

/**
 * Every bot API route, found on disk so a new route cannot miss the check, must refuse a
 * caller without the bot credential before it does anything else.
 */
const BOT_API_DIR = srcPath("app", "api", "bot");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const ANY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000000";

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

const routes = routeFiles(BOT_API_DIR).map((file) => ({
  file,
  name: path.relative(BOT_API_DIR, path.dirname(file)).replace(/\\/g, "/"),
}));

function context(name: string) {
  const params = Object.fromEntries([...name.matchAll(/\[([^\]]+)\]/g)].map((match) => [match[1]!, ANY_ID]));
  return { params: Promise.resolve(params) };
}

function request(name: string, method: string, headers: Record<string, string>) {
  const url = new URL(`/api/bot/${name.replace(/\[[^\]]+\]/g, ANY_ID)}`, "http://bot-api.test");
  return new NextRequest(url, { method, headers, body: method === "GET" ? undefined : "{}" });
}

beforeAll(() => {
  vi.stubEnv("BOOSTINGHUB_BOT_API_TOKEN", "bot-credential-test-token");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("bot API credentials on every route", () => {
  it("finds the bot routes", () => {
    expect(routes.length).toBeGreaterThanOrEqual(24);
  });

  it.each(routes)("$name refuses a missing or wrong token", async ({ file, name }) => {
    const route = (await import(/* @vite-ignore */ file)) as Partial<Record<(typeof METHODS)[number], Handler>>;
    const handlers = METHODS.flatMap((method) => (route[method] ? [[method, route[method]] as const] : []));
    expect(handlers.length).toBeGreaterThan(0);

    for (const [method, handler] of handlers) {
      const missing = await handler(request(name, method, {}), context(name));
      expect(missing.status, `${method} without a token`).toBe(401);
      const wrong = await handler(request(name, method, { authorization: "Bearer wrong-token" }), context(name));
      expect(wrong.status, `${method} with a wrong token`).toBe(401);
    }
  });
});
