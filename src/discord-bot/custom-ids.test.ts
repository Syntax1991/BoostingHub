import { describe, expect, it } from "vitest";
import {
  buildCharacterScopedCustomId,
  buildCustomId,
  parseCharacterScopedCustomId,
  parseCustomId,
} from "@/discord-bot/custom-ids";

const RUN_ID = "r7777777-7777-4777-8777-777777777777";
const CHARACTER_ID = "c1111111-1111-4111-8111-111111111111";

describe("custom ids", () => {
  it("round-trips action and runId", () => {
    for (const action of ["signup", "lootbuddy", "cancel", "signup-confirm", "signup-discard"] as const) {
      const id = buildCustomId(action, RUN_ID);
      expect(parseCustomId(id)).toEqual({ action, runId: RUN_ID });
    }
  });

  it("rejects building a custom id for a malformed runId", () => {
    expect(() => buildCustomId("signup", "short")).toThrow();
    expect(() => buildCustomId("signup", "has a space")).toThrow();
  });

  it("rejects parsing an unrelated or malformed custom id", () => {
    expect(parseCustomId("not-ours:signup:r7777777-7777-4777-8777-777777777777")).toBeNull();
    expect(parseCustomId("boostinghub:unknown-action:r7777777-7777-4777-8777-777777777777")).toBeNull();
    expect(parseCustomId("boostinghub:signup")).toBeNull();
    expect(parseCustomId("boostinghub:signup:short")).toBeNull();
  });

  it("round-trips a character-scoped custom id", () => {
    const id = buildCharacterScopedCustomId("signup-role", RUN_ID, CHARACTER_ID);
    expect(parseCharacterScopedCustomId(id)).toEqual({
      action: "signup-role",
      runId: RUN_ID,
      characterId: CHARACTER_ID,
    });
  });

  it("does not cross-parse a 3-part custom id as character-scoped, or vice versa", () => {
    const plain = buildCustomId("signup", RUN_ID);
    expect(parseCharacterScopedCustomId(plain)).toBeNull();

    const scoped = buildCharacterScopedCustomId("signup-role", RUN_ID, CHARACTER_ID);
    expect(parseCustomId(scoped)).toBeNull();
  });

  it("rejects building a character-scoped custom id for a malformed runId or characterId", () => {
    expect(() => buildCharacterScopedCustomId("signup-role", "short", CHARACTER_ID)).toThrow();
    expect(() => buildCharacterScopedCustomId("signup-role", RUN_ID, "short")).toThrow();
  });
});
