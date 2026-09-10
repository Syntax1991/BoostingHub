import { describe, expect, it } from "vitest";
import { isDomainError } from "@/lib/errors";
import {
  consumeBattleNetOAuthState,
  createBattleNetOAuthState,
} from "@/lib/blizzard/oauth-state";
import type { BattleNetOAuthStatePayload } from "@/lib/blizzard/oauth-state";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-bnoauth00001";
const otherUserId = "aaaaaaaa-aaaa-4aaa-8aaa-bnoauth00002";

function encodePayload(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function expectStateInvalid(fn: () => unknown) {
  try {
    fn();
    throw new Error("Expected BATTLENET_STATE_INVALID");
  } catch (error) {
    if (error instanceof Error && error.message === "Expected BATTLENET_STATE_INVALID") {
      throw error;
    }
    expect(isDomainError(error) && error.code).toBe("BATTLENET_STATE_INVALID");
  }
}

describe("createBattleNetOAuthState / consumeBattleNetOAuthState", () => {
  it("creates and consumes a valid region-bound state", () => {
    const created = createBattleNetOAuthState({ userId, region: "EU" });
    expect(created.stateParam).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(created.maxAgeSeconds).toBe(600);

    const payload = consumeBattleNetOAuthState({
      cookieValue: created.cookieValue,
      stateParam: created.stateParam,
      userId,
    });

    expect(payload).toMatchObject({
      nonce: created.stateParam,
      userId,
      region: "EU",
      returnPath: "/characters",
    } satisfies Partial<BattleNetOAuthStatePayload>);
    expect(payload.exp).toBeGreaterThan(Date.now());
  });

  it("rejects replay after the cookie is cleared", () => {
    const created = createBattleNetOAuthState({ userId, region: "US" });
    consumeBattleNetOAuthState({
      cookieValue: created.cookieValue,
      stateParam: created.stateParam,
      userId,
    });

    expectStateInvalid(() =>
      consumeBattleNetOAuthState({
        cookieValue: undefined,
        stateParam: created.stateParam,
        userId,
      }),
    );
  });

  it("rejects a state param from a different session (cross-cookie replay)", () => {
    const first = createBattleNetOAuthState({ userId, region: "EU" });
    const second = createBattleNetOAuthState({ userId, region: "EU" });

    expectStateInvalid(() =>
      consumeBattleNetOAuthState({
        cookieValue: first.cookieValue,
        stateParam: second.stateParam,
        userId,
      }),
    );
  });

  it("rejects when the authenticated user does not match the cookie", () => {
    const created = createBattleNetOAuthState({ userId, region: "EU" });

    expectStateInvalid(() =>
      consumeBattleNetOAuthState({
        cookieValue: created.cookieValue,
        stateParam: created.stateParam,
        userId: otherUserId,
      }),
    );
  });

  it("rejects forged cookies with an invalid region", () => {
    const forged = encodePayload({
      nonce: "11111111-1111-4111-8111-111111111111",
      userId,
      region: "KR",
      returnPath: "/characters",
      exp: Date.now() + 60_000,
    });

    expectStateInvalid(() =>
      consumeBattleNetOAuthState({
        cookieValue: forged,
        stateParam: "11111111-1111-4111-8111-111111111111",
        userId,
      }),
    );
  });

  it("rejects when state param and cookie nonce mismatch", () => {
    const created = createBattleNetOAuthState({ userId, region: "US" });

    expectStateInvalid(() =>
      consumeBattleNetOAuthState({
        cookieValue: created.cookieValue,
        stateParam: "00000000-0000-4000-8000-000000000000",
        userId,
      }),
    );
  });

  it("rejects expired state", () => {
    const nonce = "22222222-2222-4222-8222-222222222222";
    const expired = encodePayload({
      nonce,
      userId,
      region: "EU",
      returnPath: "/characters",
      exp: Date.now() - 1,
    });

    expectStateInvalid(() =>
      consumeBattleNetOAuthState({
        cookieValue: expired,
        stateParam: nonce,
        userId,
      }),
    );
  });
});
