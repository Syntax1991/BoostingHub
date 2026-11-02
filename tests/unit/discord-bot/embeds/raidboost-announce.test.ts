import { describe, expect, it } from "vitest";
import { buildRaidboostAnnounce } from "@/discord-bot/embeds/raidboost-announce";

describe("buildRaidboostAnnounce", () => {
  it("is role pings + one short line naming the Run — no second embed", () => {
    const announce = buildRaidboostAnnounce({
      runId: "r1111111-1111-4111-8111-111111111111",
      difficulty: "HEROIC",
      lootType: "VIP",
      contentTitle: "Venom & Tide & Kithix",
      phoenixEmoji: "<:PhoenixStarDiscord:123>",
      roleMentions: ["<@&10>", "<@&20>", "<@&30>"],
    });
    expect(announce.content).toBe(
      "<@&10> <@&20> <@&30>\n<:PhoenixStarDiscord:123> Raidboost: **HC** 💎 VIP · Venom & Tide & Kithix — signups open below <:PhoenixStarDiscord:123>",
    );
    expect(announce.allowedMentions.roles).toEqual(["10", "20", "30"]);
    expect("embeds" in announce).toBe(false);
  });

  it("without pings (Ping Discord roles off) it is just the line; missing emoji / title are omitted", () => {
    const announce = buildRaidboostAnnounce({
      runId: "r1111111-1111-4111-8111-111111111111",
      difficulty: "MYTHIC",
      lootType: "SAVED",
      phoenixEmoji: null,
      roleMentions: [],
    });
    expect(announce.content).toBe("Raidboost: **Mythic** 💰❌ Saved — signups open below");
    expect(announce.allowedMentions.roles).toEqual([]);
  });

  it("ignores malformed role mentions for allowedMentions", () => {
    const announce = buildRaidboostAnnounce({
      runId: "r1111111-1111-4111-8111-111111111111",
      difficulty: "NORMAL",
      lootType: "UNSAVED",
      phoenixEmoji: null,
      roleMentions: ["<@&42>", "@everyone"],
    });
    expect(announce.allowedMentions.roles).toEqual(["42"]);
  });
});
