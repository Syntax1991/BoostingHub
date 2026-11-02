import { describe, expect, it } from "vitest";
import { BOOSTER_GUIDE_CARDS, BOOSTER_GUIDE_FORMAT, boosterGuidePublisher } from "@/guides/booster-guide";
import {
  guideSignupPreviewButtonActions,
  guideSignupPreviewFixture,
  renderGuideSignupPreviewHtml,
} from "@/guides/booster-guide-discord-preview";
import type { DiscordMessageLike } from "@/guides/guide-publisher";
import { containsForbiddenGuideScreenshotText } from "@/guides/guide-screenshot-capture";
import { APP_BRAND_NAME } from "@/lib/branding";
import { RUN_LOOT_TYPES } from "@/models/enums";

const BOT = "bot-1";

describe("booster guide content", () => {
  it("has exactly five canonical cards", () => {
    expect(BOOSTER_GUIDE_CARDS.map((c) => c.key)).toEqual([
      "getting-started",
      "characters",
      "signing-up",
      "discord-signups",
      "after-signing-up",
    ]);
  });

  it("highlights Discord Quick Sign and does not claim a Web Quick Signup button", () => {
    const discord = BOOSTER_GUIDE_CARDS.find((c) => c.key === "discord-signups")!;
    const web = BOOSTER_GUIDE_CARDS.find((c) => c.key === "signing-up")!;
    expect(JSON.stringify(discord)).toMatch(/Quick Sign/);
    expect(JSON.stringify(web)).not.toMatch(/Web Quick Signup/);
    expect(web.description).toMatch(/Save Booster Offers/);
  });

  it("keeps Discord Signups text-only with offers vs Roster clarified", () => {
    const discord = BOOSTER_GUIDE_CARDS.find((c) => c.key === "discord-signups")!;
    expect(discord.imageFile).toBeNull();
    const embed = BOOSTER_GUIDE_FORMAT.buildEmbed(discord, { assetRevision: null });
    expect(embed.image).toBeUndefined();
    expect(embed.footer.text).toBe(`${APP_BRAND_NAME} · ${BOOSTER_GUIDE_FORMAT.markerPrefix}discord-signups`);
    expect(embed.fields?.map((f) => f.name)).toEqual(["Signup", "Quick Sign", "LB", "Unsign", "Add / Edit Note"]);
    const quick = embed.fields?.find((f) => f.name === "Quick Sign")?.value ?? "";
    expect(quick).toMatch(/signs up all your available characters/i);
    expect(quick).toMatch(/Raid Lead still picks the team/i);
  });

  it("drops a leftover screenshot from the text-only card, then converges", () => {
    const discord = BOOSTER_GUIDE_CARDS.find((c) => c.key === "discord-signups")!;
    const clean = BOOSTER_GUIDE_FORMAT.buildEmbed(discord, { assetRevision: null });
    const message = (overrides: Partial<DiscordMessageLike>): DiscordMessageLike => ({
      id: "discord-old",
      author: { id: BOT, bot: true },
      content: "",
      embeds: [{ title: clean.title, description: clean.description, footer: clean.footer, fields: clean.fields }],
      attachments: [],
      components: [],
      ...overrides,
    });
    const withOldImage = message({
      embeds: [
        {
          title: clean.title,
          description: clean.description,
          footer: { text: `${clean.footer.text} · asset:0123456789ab` },
          fields: clean.fields,
          image: { url: "attachment://bo-06-discord-signups.png" },
        },
      ],
      attachments: [{ id: "att-old", filename: "bo-06-discord-signups.png", url: "https://cdn.example/old.png" }],
    });
    const assetRevisions = Object.fromEntries(BOOSTER_GUIDE_CARDS.map((c) => [c.key, null]));
    const planWith = (m: DiscordMessageLike) =>
      boosterGuidePublisher
        .plan({ channelId: "ch", botUserId: BOT, messages: [m], assetRevisions })
        .actions.find((a) => a.cardKey === "discord-signups");

    expect(planWith(withOldImage)).toEqual({ type: "update", cardKey: "discord-signups", messageId: "discord-old" });
    expect(planWith(message({}))).toEqual({ type: "unchanged", cardKey: "discord-signups", messageId: "discord-old" });
  });
});

describe("builder-driven Discord signup preview", () => {
  it("uses a valid current RunLootType and real button actions", () => {
    const fixture = guideSignupPreviewFixture();
    expect(RUN_LOOT_TYPES).toContain(fixture.lootType);
    expect(guideSignupPreviewButtonActions(fixture)).toEqual(["signup", "quick-signup", "lootbuddy", "cancel", "note"]);
    const html = renderGuideSignupPreviewHtml(fixture);
    expect(html).toContain("Community");
    expect(html).not.toMatch(/\bSplit\b/);
    expect(html).toContain("Quick Sign");
    expect(html).toContain("generated-from-buildSignupEmbed");
  });
});

describe("guide screenshot capture hygiene", () => {
  it("flags forbidden development-auth strings", () => {
    expect(containsForbiddenGuideScreenshotText("Development Identities panel")).toBe(true);
    expect(containsForbiddenGuideScreenshotText("Dashboard Upcoming Runs")).toBe(false);
  });
});
