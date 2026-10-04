import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRaidboostAnnounce } from "@/discord-bot/embeds/raidboost-announce";

describe("buildRaidboostAnnounce", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds Heroic Saved announce matching Carl-bot layout", () => {
    const result = buildRaidboostAnnounce({
      runId: "run-123",
      difficulty: "HEROIC",
      lootType: "SAVED",
      phoenixEmoji: "<:PhoenixStarDiscord:123>",
      roleMentions: ["<@&111>", "<@&222>", "<@&333>"],
    });

    expect(result.content).toBe("<@&111> <@&222> <@&333>");
    expect(result.allowedMentions.roles).toEqual(["111", "222", "333"]);
    const embed = result.embeds[0]!.toJSON();
    expect(embed.title).toBe("<:PhoenixStarDiscord:123> Raidboost Announce <:PhoenixStarDiscord:123>");
    expect(embed.description).toBe(
      "**HC** 💰❌ Heroic Saved - *Please refer to the channel name for the time* 🕒",
    );
  });

  it("omits phoenix markup when emoji is missing and still pings roles", () => {
    const result = buildRaidboostAnnounce({
      runId: "run-123",
      difficulty: "MYTHIC",
      lootType: "VIP",
      phoenixEmoji: null,
      roleMentions: ["<@&9>"],
    });
    expect(result.embeds[0]!.toJSON().title).toBe("Raidboost Announce");
    expect(result.embeds[0]!.toJSON().description).toContain("**Mythic** 💎 Mythic VIP");
    expect(result.content).toBe("<@&9>");
  });

  it("allows empty content when no roles resolved", () => {
    const result = buildRaidboostAnnounce({
      runId: "run-123",
      difficulty: "NORMAL",
      lootType: "UNSAVED",
      phoenixEmoji: "<:PhoenixStarDiscord:1>",
      roleMentions: [],
    });
    expect(result.content).toBe("");
    expect(result.allowedMentions.roles).toEqual([]);
    expect(result.embeds[0]!.toJSON().description).toContain("**NM** 💰 Normal Unsaved");
  });

  it("links the announce embed title to the canonical run page", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("BETTER_AUTH_URL", "https://example.test");
    const result = buildRaidboostAnnounce({
      runId: "run-123",
      difficulty: "HEROIC",
      lootType: "SAVED",
      phoenixEmoji: "<:PhoenixStarDiscord:123>",
      roleMentions: ["<@&111>"],
    });
    const embed = result.embeds[0]!.toJSON();
    expect(embed.title).toBe("<:PhoenixStarDiscord:123> Raidboost Announce <:PhoenixStarDiscord:123>");
    expect(embed.url).toBe("https://example.test/runs/run-123");
    expect(result.content).toBe("<@&111>");
  });

  it("still builds the announce and omits the URL when production has no base URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_URL", "");
    const result = buildRaidboostAnnounce({
      runId: "run-123",
      difficulty: "HEROIC",
      lootType: "SAVED",
      phoenixEmoji: null,
      roleMentions: ["<@&111>"],
    });
    const embed = result.embeds[0]!.toJSON();
    expect(embed.title).toBe("Raidboost Announce");
    expect(embed.url).toBeUndefined();
    expect(result.content).toBe("<@&111>");
  });
});
