import { describe, expect, it, vi } from "vitest";
import {
  createGuildEmojiCache,
  fingerprintClassIndicators,
  fingerprintRoleIndicators,
  GUILD_EMOJI_CACHE_TTL_MS,
  resolveGuildEmojiIndicators,
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

type FakeEmoji = ReturnType<typeof fakeEmoji>;

/**
 * Fake client whose Guild emoji REST fetch is counted per guild. `emojisByGuild`
 * is read at fetch time, so tests can change what Discord "returns" later.
 */
function fakeClient(emojisByGuild: Record<string, FakeEmoji[]>) {
  const emojiFetches: Record<string, number> = {};
  const failures: Record<string, Error[]> = {};
  const client = {
    guilds: {
      fetch: vi.fn(async (guildId: string) => {
        let cache: FakeEmoji[] = [];
        return {
          emojis: {
            fetch: vi.fn(async () => {
              emojiFetches[guildId] = (emojiFetches[guildId] ?? 0) + 1;
              await Promise.resolve();
              const failure = failures[guildId]?.shift();
              if (failure) throw failure;
              cache = [...(emojisByGuild[guildId] ?? [])];
            }),
            cache: { values: () => cache.values() },
          },
        };
      }),
    },
  };
  return {
    client: client as unknown as Client,
    fetches: (guildId: string) => emojiFetches[guildId] ?? 0,
    failNext: (guildId: string, error: Error) => (failures[guildId] ??= []).push(error),
  };
}

function controlledClock(start = 1_000_000) {
  let time = start;
  return { now: () => time, advance: (ms: number) => (time += ms) };
}

const GUILD = "guild-1";
const EMOJIS = [
  fakeEmoji("shaman", "123"),
  fakeEmoji("dk", "456"),
  fakeEmoji("dh", "789", true),
  fakeEmoji("tank", "11"),
  fakeEmoji("healer", "22"),
  fakeEmoji("dps", "33"),
  fakeEmoji("loot", "55"),
  fakeEmoji("raidlead", "44"),
  fakeEmoji("lootbuddy", "99"),
];

describe("resolveGuildEmojiIndicators — one snapshot for class and role indicators", () => {
  it("cold lookup: ONE emoji fetch yields both class and role indicators", async () => {
    const discord = fakeClient({ [GUILD]: EMOJIS });
    const cache = createGuildEmojiCache();

    const { classIndicators, roleIndicators } = await resolveGuildEmojiIndicators(discord.client, GUILD, cache);

    expect(discord.fetches(GUILD)).toBe(1);
    expect(classIndicators.SHAMAN).toBe("<:shaman:123>");
    expect(classIndicators.DEATH_KNIGHT).toBe("<:dk:456>");
    expect(classIndicators.DEMON_HUNTER).toBe("<a:dh:789>");
    expect(roleIndicators).toEqual({
      tank: "<:tank:11>",
      healer: "<:healer:22>",
      dps: "<:dps:33>",
      lootbuddy: "<:loot:55>",
      raidlead: "<:raidlead:44>",
    });
  });

  it("missing emojis are omitted (formatters keep their label/unicode fallbacks)", async () => {
    const discord = fakeClient({ [GUILD]: [fakeEmoji("shaman", "123"), fakeEmoji("tank", "11")] });
    const { classIndicators, roleIndicators } = await resolveGuildEmojiIndicators(
      discord.client,
      GUILD,
      createGuildEmojiCache(),
    );
    expect(classIndicators).toEqual({ SHAMAN: "<:shaman:123>" });
    expect(classIndicators.PRIEST).toBeUndefined();
    expect(roleIndicators).toEqual({ tank: "<:tank:11>" });
    expect("healer" in roleIndicators).toBe(false);
  });

  it("no Guild emojis at all: empty indicators, not an error", async () => {
    const discord = fakeClient({ [GUILD]: [] });
    await expect(resolveGuildEmojiIndicators(discord.client, GUILD, createGuildEmojiCache())).resolves.toEqual({
      classIndicators: {},
      roleIndicators: {},
    });
  });
});

describe("createGuildEmojiCache", () => {
  it("warm cache: repeated lookups within the TTL make no further emoji fetch", async () => {
    const discord = fakeClient({ [GUILD]: EMOJIS });
    const clock = controlledClock();
    const cache = createGuildEmojiCache({ now: clock.now });

    await cache.get(discord.client, GUILD);
    for (let i = 0; i < 5; i += 1) {
      clock.advance(60_000);
      await cache.get(discord.client, GUILD);
    }

    expect(discord.fetches(GUILD)).toBe(1);
  });

  it("TTL expiry: exactly one refresh, which replaces the snapshot", async () => {
    const emojis: Record<string, FakeEmoji[]> = { [GUILD]: [fakeEmoji("tank", "11")] };
    const discord = fakeClient(emojis);
    const clock = controlledClock();
    const cache = createGuildEmojiCache({ now: clock.now });

    expect((await cache.get(discord.client, GUILD)).get("tank")).toBe("<:tank:11>");
    emojis[GUILD] = [fakeEmoji("tank", "77")];
    clock.advance(GUILD_EMOJI_CACHE_TTL_MS - 1);
    expect((await cache.get(discord.client, GUILD)).get("tank")).toBe("<:tank:11>");
    clock.advance(1);
    expect((await cache.get(discord.client, GUILD)).get("tank")).toBe("<:tank:77>");
    expect((await cache.get(discord.client, GUILD)).get("tank")).toBe("<:tank:77>");

    expect(discord.fetches(GUILD)).toBe(2);
  });

  it("concurrent cold lookups share one fetch", async () => {
    const discord = fakeClient({ [GUILD]: EMOJIS });
    const cache = createGuildEmojiCache();

    const snapshots = await Promise.all(Array.from({ length: 6 }, () => cache.get(discord.client, GUILD)));

    expect(discord.fetches(GUILD)).toBe(1);
    expect(new Set(snapshots).size).toBe(1);
  });

  it("concurrent lookups on an expired entry share one refresh", async () => {
    const discord = fakeClient({ [GUILD]: EMOJIS });
    const clock = controlledClock();
    const cache = createGuildEmojiCache({ now: clock.now });
    await cache.get(discord.client, GUILD);
    clock.advance(GUILD_EMOJI_CACHE_TTL_MS + 1);

    await Promise.all(Array.from({ length: 6 }, () => cache.get(discord.client, GUILD)));

    expect(discord.fetches(GUILD)).toBe(2);
  });

  it("refresh failure with an earlier snapshot: keeps serving it, warns, and a later refresh succeeds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const emojis: Record<string, FakeEmoji[]> = { [GUILD]: [fakeEmoji("tank", "11")] };
    const discord = fakeClient(emojis);
    const clock = controlledClock();
    const cache = createGuildEmojiCache({ now: clock.now });
    await cache.get(discord.client, GUILD);

    clock.advance(GUILD_EMOJI_CACHE_TTL_MS + 1);
    discord.failNext(GUILD, Object.assign(new Error("Missing Access"), { code: 50001 }));
    const results = await Promise.all([cache.get(discord.client, GUILD), cache.get(discord.client, GUILD)]);
    expect(results.map((snapshot) => snapshot.get("tank"))).toEqual(["<:tank:11>", "<:tank:11>"]);
    expect(discord.fetches(GUILD)).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);

    // Not poisoned: the next call retries and picks up the new data.
    emojis[GUILD] = [fakeEmoji("tank", "88")];
    expect((await cache.get(discord.client, GUILD)).get("tank")).toBe("<:tank:88>");
    expect(discord.fetches(GUILD)).toBe(3);
    warn.mockRestore();
  });

  it("initial fetch failure: the error propagates, nothing is cached, the next call fetches again", async () => {
    const discord = fakeClient({ [GUILD]: EMOJIS });
    const cache = createGuildEmojiCache();
    discord.failNext(GUILD, new Error("Discord down"));

    await expect(cache.get(discord.client, GUILD)).rejects.toThrow("Discord down");
    const snapshot = await cache.get(discord.client, GUILD);

    expect(snapshot.get("shaman")).toBe("<:shaman:123>");
    expect(discord.fetches(GUILD)).toBe(2);
  });

  it("concurrent callers of a failing cold fetch all see the error; nothing stays locked", async () => {
    const discord = fakeClient({ [GUILD]: EMOJIS });
    const cache = createGuildEmojiCache();
    discord.failNext(GUILD, new Error("Discord down"));

    const results = await Promise.allSettled([cache.get(discord.client, GUILD), cache.get(discord.client, GUILD)]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(discord.fetches(GUILD)).toBe(1);
    await expect(cache.get(discord.client, GUILD)).resolves.toBeDefined();
    expect(discord.fetches(GUILD)).toBe(2);
  });

  it("multiple Guilds: snapshots are scoped per Guild id", async () => {
    const discord = fakeClient({ a: [fakeEmoji("tank", "1")], b: [fakeEmoji("tank", "2")] });
    const cache = createGuildEmojiCache();

    expect((await cache.get(discord.client, "a")).get("tank")).toBe("<:tank:1>");
    expect((await cache.get(discord.client, "b")).get("tank")).toBe("<:tank:2>");
    expect((await cache.get(discord.client, "a")).get("tank")).toBe("<:tank:1>");
    expect(discord.fetches("a")).toBe(1);
    expect(discord.fetches("b")).toBe(1);
  });

  it("stays bounded: the oldest idle Guild is evicted beyond the limit", async () => {
    const discord = fakeClient({ a: EMOJIS, b: EMOJIS, c: EMOJIS });
    const cache = createGuildEmojiCache({ maxGuilds: 2 });

    await cache.get(discord.client, "a");
    await cache.get(discord.client, "b");
    await cache.get(discord.client, "c");
    await cache.get(discord.client, "b");
    await cache.get(discord.client, "a");

    expect(discord.fetches("b")).toBe(1);
    expect(discord.fetches("a")).toBe(2);
  });

  it("clear() drops cached snapshots", async () => {
    const discord = fakeClient({ [GUILD]: EMOJIS });
    const cache = createGuildEmojiCache();
    await cache.get(discord.client, GUILD);
    cache.clear();
    await cache.get(discord.client, GUILD);
    expect(discord.fetches(GUILD)).toBe(2);
  });

  it("duplicate emoji names: the later emoji wins, as before", async () => {
    const discord = fakeClient({ [GUILD]: [fakeEmoji("tank", "1"), fakeEmoji("tank", "2")] });
    const { roleIndicators } = await resolveGuildEmojiIndicators(discord.client, GUILD, createGuildEmojiCache());
    expect(roleIndicators.tank).toBe("<:tank:2>");
  });
});

describe("fingerprints over cached indicators", () => {
  it("are identical to fingerprints of the same emojis built directly", async () => {
    const discord = fakeClient({ [GUILD]: EMOJIS });
    const { classIndicators, roleIndicators } = await resolveGuildEmojiIndicators(
      discord.client,
      GUILD,
      createGuildEmojiCache(),
    );
    expect(fingerprintClassIndicators(classIndicators)).toBe(
      fingerprintClassIndicators({ SHAMAN: "<:shaman:123>", DEATH_KNIGHT: "<:dk:456>", DEMON_HUNTER: "<a:dh:789>" }),
    );
    expect(fingerprintRoleIndicators(roleIndicators)).toBe(
      "tank:11|healer:22|dps:33|lootbuddy:55|raidlead:44",
    );
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

describe("fingerprintRoleIndicators", () => {
  it("uses compact role:id pairs", () => {
    const fp = fingerprintRoleIndicators({ tank: "<:tank:11>", raidlead: "<:raidlead:44>" });
    expect(fp).toContain("tank:11");
    expect(fp).toContain("raidlead:44");
    expect(fp).toContain("healer:");
  });
});
