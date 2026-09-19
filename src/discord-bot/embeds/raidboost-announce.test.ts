import { describe, expect, it } from "vitest";
import { buildRaidboostAnnounce } from "@/discord-bot/embeds/raidboost-announce";

describe("buildRaidboostAnnounce", () => {
  it("builds Heroic Saved announce matching Carl-bot layout", () => {
    const result = buildRaidboostAnnounce({
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
      difficulty: "MYTHIC",
      lootType: "VIP",
      phoenixEmoji: null,
      roleMentions: ["<@&9>"],
    });
    expect(result.embeds[0]!.toJSON().title).toBe("Raidboost Announce");
    expect(result.embeds[0]!.toJSON().description).toContain("**MY** 💎 Mythic VIP");
    expect(result.content).toBe("<@&9>");
  });

  it("allows empty content when no roles resolved", () => {
    const result = buildRaidboostAnnounce({
      difficulty: "NORMAL",
      lootType: "UNSAVED",
      phoenixEmoji: "<:PhoenixStarDiscord:1>",
      roleMentions: [],
    });
    expect(result.content).toBe("");
    expect(result.allowedMentions.roles).toEqual([]);
    expect(result.embeds[0]!.toJSON().description).toContain("**NM** 💰 Normal Unsaved");
  });
});
