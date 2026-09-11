import { describe, expect, it } from "vitest";
import { buildCustomId, parseCustomId } from "@/discord-bot/custom-ids";

const RUN_ID = "r7777777-7777-4777-8777-777777777777";

const CHARACTER_ID = "c8888888-8888-4888-8888-888888888888";

describe("custom ids", () => {
  it("round-trips action and runId", () => {
    for (const action of ["signup", "lootbuddy", "cancel", "signup-confirm"] as const) {
      const id = buildCustomId(action, RUN_ID);
      expect(parseCustomId(id)).toEqual({ action, runId: RUN_ID });
    }
  });

  it("round-trips a character-scoped action with its characterId", () => {
    const id = buildCustomId("signup-role", RUN_ID, CHARACTER_ID);
    expect(parseCustomId(id)).toEqual({ action: "signup-role", runId: RUN_ID, characterId: CHARACTER_ID });
  });

  it("rejects building a custom id for a malformed runId", () => {
    expect(() => buildCustomId("signup", "short")).toThrow();
    expect(() => buildCustomId("signup", "has a space")).toThrow();
  });

  it("rejects building a character-scoped custom id for a malformed characterId", () => {
    expect(() => buildCustomId("signup-role", RUN_ID, "short")).toThrow();
  });

  it("rejects attaching a characterId to an action that isn't character-scoped", () => {
    expect(() => buildCustomId("signup", RUN_ID, CHARACTER_ID)).toThrow();
  });

  it("rejects parsing an unrelated or malformed custom id", () => {
    expect(parseCustomId("not-ours:signup:r7777777-7777-4777-8777-777777777777")).toBeNull();
    expect(parseCustomId("boostinghub:unknown-action:r7777777-7777-4777-8777-777777777777")).toBeNull();
    expect(parseCustomId("boostinghub:signup")).toBeNull();
    expect(parseCustomId("boostinghub:signup:short")).toBeNull();
    expect(parseCustomId(`boostinghub:signup:${RUN_ID}:${CHARACTER_ID}`)).toBeNull();
    expect(parseCustomId(`boostinghub:signup-role:${RUN_ID}:short`)).toBeNull();
  });
});
