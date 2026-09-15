import { describe, expect, it, vi } from "vitest";
import {
  fingerprintClassIndicators,
  resolveGuildClassIndicators,
} from "@/discord-bot/class-emoji-lookup";
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

describe("fingerprintClassIndicators", () => {
  it("uses compact class:id pairs without markup brackets", () => {
    const fp = fingerprintClassIndicators({
      SHAMAN: "<:shaman:123>",
      DEMON_HUNTER: "<a:dh:789>",
    });
    expect(fp).toContain("SHAMAN:123");
    expect(fp).toContain("DEMON_HUNTER:789");
    expect(fp).not.toContain("<");
  });

  it("is deterministic regardless of input insertion order", () => {
    const a = fingerprintClassIndicators({
      SHAMAN: "<:shaman:123>",
      MAGE: "<:mage:456>",
    });
    const b = fingerprintClassIndicators({
      MAGE: "<:mage:456>",
      SHAMAN: "<:shaman:123>",
    });
    expect(a).toBe(b);
  });

  it("changes when a class emoji id changes", () => {
    const before = fingerprintClassIndicators({ SHAMAN: "<:shaman:123>" });
    const after = fingerprintClassIndicators({ SHAMAN: "<:shaman:999>" });
    expect(before).not.toBe(after);
  });

  it("returns a stable empty-slot fingerprint for an empty map", () => {
    const empty = fingerprintClassIndicators({});
    expect(empty).toContain("SHAMAN:");
    expect(empty).toContain("PRIEST:");
    expect(empty).toBe(fingerprintClassIndicators({}));
  });
});
