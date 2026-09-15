import { describe, expect, it, vi } from "vitest";
import { resolveGuildClassIndicators } from "@/discord-bot/class-emoji-lookup";
import type { Client } from "discord.js";

function fakeEmoji(name: string, id: string, animated = false) {
  return {
    name,
    id,
    animated,
    toString: () => (animated ? `<a:${name}:${id}>` : `<:${name}:${id}>`),
  };
}

describe("resolveGuildClassIndicators", () => {
  it("resolves WowClass indicators from Guild emoji names without hardcoded IDs", async () => {
    const cache = new Map([
      ["1", fakeEmoji("shaman", "123")],
      ["2", fakeEmoji("dk", "456")],
      ["3", fakeEmoji("dh", "789", true)],
    ]);
    const client = {
      guilds: {
        fetch: vi.fn().mockResolvedValue({
          emojis: {
            fetch: vi.fn().mockResolvedValue(undefined),
            cache: {
              values: () => cache.values(),
            },
          },
        }),
      },
    } as unknown as Client;

    const indicators = await resolveGuildClassIndicators(client, "guild-1");
    expect(indicators.SHAMAN).toBe("<:shaman:123>");
    expect(indicators.DEATH_KNIGHT).toBe("<:dk:456>");
    expect(indicators.DEMON_HUNTER).toBe("<a:dh:789>");
    expect(indicators.PRIEST).toBeUndefined();
  });
});
