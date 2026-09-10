import { DomainError } from "@/lib/errors";
import type { WowRegion } from "@/models/enums";
import { WOW_REGIONS } from "@/models/enums";

export const BATTLENET_OAUTH_STATE_COOKIE = "bh_battlenet_oauth_state";

const STATE_TTL_MS = 10 * 60 * 1000;

export type BattleNetOAuthStatePayload = {
  nonce: string;
  userId: string;
  region: WowRegion;
  returnPath: "/characters";
  exp: number;
};

function isRegion(value: unknown): value is WowRegion {
  return typeof value === "string" && (WOW_REGIONS as readonly string[]).includes(value);
}

function encodePayload(payload: BattleNetOAuthStatePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(raw: string): BattleNetOAuthStatePayload | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (
      typeof parsed.nonce !== "string" ||
      typeof parsed.userId !== "string" ||
      !isRegion(parsed.region) ||
      parsed.returnPath !== "/characters" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    return {
      nonce: parsed.nonce,
      userId: parsed.userId,
      region: parsed.region,
      returnPath: "/characters",
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

/**
 * Creates a region-bound OAuth state cookie payload.
 * The Blizzard `state` query param carries only the nonce; the HttpOnly cookie
 * holds the full CSRF-bound payload for replay-safe validation.
 */
export function createBattleNetOAuthState(input: {
  userId: string;
  region: WowRegion;
}): { stateParam: string; cookieValue: string; maxAgeSeconds: number } {
  const nonce = crypto.randomUUID();
  const payload: BattleNetOAuthStatePayload = {
    nonce,
    userId: input.userId,
    region: input.region,
    returnPath: "/characters",
    exp: Date.now() + STATE_TTL_MS,
  };
  return {
    stateParam: nonce,
    cookieValue: encodePayload(payload),
    maxAgeSeconds: Math.floor(STATE_TTL_MS / 1000),
  };
}

export function battleNetOAuthCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/**
 * Consumes and validates the OAuth state cookie against the callback state param.
 * Callers must clear the cookie after consume (success or failure) for replay safety.
 */
export function consumeBattleNetOAuthState(input: {
  cookieValue: string | undefined;
  stateParam: string | undefined;
  userId: string;
}): BattleNetOAuthStatePayload {
  if (!input.cookieValue || !input.stateParam) {
    throw new DomainError("BATTLENET_STATE_INVALID", "Battle.net OAuth state is missing.", 400);
  }

  const payload = decodePayload(input.cookieValue);
  if (!payload || payload.nonce !== input.stateParam) {
    throw new DomainError("BATTLENET_STATE_INVALID", "Battle.net OAuth state is invalid.", 400);
  }

  if (payload.userId !== input.userId) {
    throw new DomainError("BATTLENET_STATE_INVALID", "Battle.net OAuth state does not match this user.", 400);
  }

  if (payload.exp < Date.now()) {
    throw new DomainError("BATTLENET_STATE_INVALID", "Battle.net OAuth state has expired.", 400);
  }

  return payload;
}
