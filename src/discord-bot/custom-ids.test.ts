import { describe, expect, it } from "vitest";
import { buildCustomId, parseCustomId } from "@/discord-bot/custom-ids";

const RUN_ID = "r7777777-7777-4777-8777-777777777777";

describe("custom ids", () => {
  it("round-trips action and runId", () => {
    for (const action of ["signup", "lootbuddy", "cancel"] as const) {
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
});
