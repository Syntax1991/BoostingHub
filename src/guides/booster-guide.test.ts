import { describe, expect, it, vi } from "vitest";
import {
  BOOSTER_GUIDE_CARDS,
  BOOSTER_GUIDE_MARKER_PREFIX,
  buildBoosterGuideEmbed,
  parseBoosterGuideCardKey,
} from "@/guides/booster-guide";
import {
  executeBoosterGuidePublish,
  guideMessageNeedsUpdate,
  indexCanonicalGuideMessages,
  isLegacyBoosterGuideMessage,
  planBoosterGuidePublish,
  validateBoosterGuideCards,
  type DiscordMessageLike,
  type GuideDiscordClient,
} from "@/guides/booster-guide-publisher";

describe("booster guide v2 content", () => {
  it("has exactly five canonical cards", () => {
    expect(BOOSTER_GUIDE_CARDS).toHaveLength(5);
    expect(BOOSTER_GUIDE_CARDS.map((c) => c.key)).toEqual([
      "getting-started",
      "characters",
      "signing-up",
      "discord-signups",
      "after-signing-up",
    ]);
  });

  it("highlights Discord Quick Signup and does not claim a Web Quick Signup button", () => {
    const discord = BOOSTER_GUIDE_CARDS.find((c) => c.key === "discord-signups")!;
    const web = BOOSTER_GUIDE_CARDS.find((c) => c.key === "signing-up")!;
    expect(JSON.stringify(discord)).toMatch(/Quick Signup/);
    expect(JSON.stringify(web)).not.toMatch(/Web Quick Signup/);
    expect(JSON.stringify(web)).not.toMatch(/website Quick Signup/i);
    expect(web.description).toMatch(/Save Booster Offers/);
  });

  it("stays within Discord embed size limits", () => {
    expect(validateBoosterGuideCards()).toEqual([]);
  });

  it("embeds a stable footer marker per card", () => {
    for (const card of BOOSTER_GUIDE_CARDS) {
      const footer = buildBoosterGuideEmbed(card).footer.text;
      expect(footer).toContain(`${BOOSTER_GUIDE_MARKER_PREFIX}${card.key}`);
      expect(parseBoosterGuideCardKey(footer)).toBe(card.key);
    }
  });

  it("maps screenshots for attachment:// filenames", () => {
    const withImage = BOOSTER_GUIDE_CARDS.filter((c) => c.imageFile);
    expect(withImage.length).toBeGreaterThanOrEqual(4);
    for (const card of withImage) {
      expect(buildBoosterGuideEmbed(card).image?.url).toBe(`attachment://${card.imageFile}`);
    }
  });
});

describe("booster guide publisher planning", () => {
  const botUserId = "bot-1";

  function marked(cardKey: string, id: string, overrides?: Partial<DiscordMessageLike>): DiscordMessageLike {
    const card = BOOSTER_GUIDE_CARDS.find((c) => c.key === cardKey)!;
    const embed = buildBoosterGuideEmbed(card);
    return {
      id,
      author: { id: botUserId, bot: true },
      content: "",
      embeds: [
        {
          title: embed.title,
          description: embed.description,
          footer: { text: embed.footer.text },
          fields: embed.fields,
        } as DiscordMessageLike["embeds"] extends (infer E)[] | undefined ? E : never,
      ],
      attachments: card.imageFile ? [{ id: "a1", filename: card.imageFile, url: "https://cdn.example/x.png" }] : [],
      components: card.linkButton ? [{ type: 1 }] : [],
      ...overrides,
    };
  }

  it("indexes canonical messages by footer marker", () => {
    const messages = [marked("getting-started", "m1"), marked("characters", "m2")];
    const { byKey, legacy } = indexCanonicalGuideMessages(messages, botUserId);
    expect(byKey.get("getting-started")?.[0]?.id).toBe("m1");
    expect(byKey.get("characters")?.[0]?.id).toBe("m2");
    expect(legacy).toEqual([]);
  });

  it("detects legacy append-only guide messages", () => {
    const legacy: DiscordMessageLike = {
      id: "old-1",
      author: { id: botUserId, bot: true },
      content: "## 📘 Booster Guide\nA quick introduction…",
      embeds: [],
    };
    expect(isLegacyBoosterGuideMessage(legacy, botUserId)).toBe(true);
    expect(isLegacyBoosterGuideMessage(marked("getting-started", "m1"), botUserId)).toBe(false);
  });

  it("refuses duplicate canonical keys", () => {
    const plan = planBoosterGuidePublish({
      channelId: "ch",
      botUserId,
      messages: [marked("getting-started", "m1"), marked("getting-started", "m2")],
    });
    expect(plan.errors.join(" ")).toMatch(/Ambiguous state/);
    expect(plan.actions).toEqual([]);
  });

  it("plans creates for an empty channel", () => {
    const plan = planBoosterGuidePublish({ channelId: "ch", botUserId, messages: [] });
    expect(plan.errors).toEqual([]);
    expect(plan.actions.filter((a) => a.type === "create")).toHaveLength(5);
  });

  it("plans unchanged when content already matches", () => {
    const messages = BOOSTER_GUIDE_CARDS.map((card, i) => marked(card.key, `m${i}`));
    const plan = planBoosterGuidePublish({ channelId: "ch", botUserId, messages });
    expect(plan.errors).toEqual([]);
    expect(plan.actions.every((a) => a.type === "unchanged")).toBe(true);
  });

  it("plans updates when embed copy drifts", () => {
    const stale = marked("getting-started", "m1");
    stale.embeds![0]!.description = "outdated";
    expect(guideMessageNeedsUpdate(stale, BOOSTER_GUIDE_CARDS[0]!)).toBe(true);
    const messages = [
      stale,
      ...BOOSTER_GUIDE_CARDS.slice(1).map((card, i) => marked(card.key, `m${i + 1}`)),
    ];
    const plan = planBoosterGuidePublish({ channelId: "ch", botUserId, messages });
    expect(plan.actions.some((a) => a.type === "update" && a.cardKey === "getting-started")).toBe(true);
  });

  it("only retires legacy when explicitly requested", () => {
    const legacy: DiscordMessageLike = {
      id: "old-1",
      author: { id: botUserId, bot: true },
      content: "## 📘 Booster Guide",
    };
    const without = planBoosterGuidePublish({
      channelId: "ch",
      botUserId,
      messages: [legacy],
      retireLegacy: false,
    });
    expect(without.actions.some((a) => a.type === "retire-legacy")).toBe(false);
    expect(without.legacyMessageIds).toEqual(["old-1"]);

    const withRetire = planBoosterGuidePublish({
      channelId: "ch",
      botUserId,
      messages: [legacy],
      retireLegacy: true,
    });
    expect(withRetire.actions.some((a) => a.type === "retire-legacy" && a.messageId === "old-1")).toBe(
      true,
    );
  });
});

describe("booster guide publisher execution", () => {
  it("dry-run performs no Discord mutation", async () => {
    const client: GuideDiscordClient = {
      listMessages: vi.fn(),
      createMessage: vi.fn(),
      editMessage: vi.fn(),
      deleteMessage: vi.fn(),
    };
    const plan = planBoosterGuidePublish({ channelId: "ch", botUserId: "bot", messages: [] });
    const result = await executeBoosterGuidePublish({
      client,
      channelId: "ch",
      plan,
      screenshotsDir: ".",
      dryRun: true,
    });
    expect(result.created).toBe(5);
    expect(client.createMessage).not.toHaveBeenCalled();
    expect(client.editMessage).not.toHaveBeenCalled();
    expect(client.deleteMessage).not.toHaveBeenCalled();
  });

  it("edits existing canonical messages instead of duplicating them", async () => {
    const edited: string[] = [];
    const created: string[] = [];
    const card = BOOSTER_GUIDE_CARDS[0]!;
    const existing: DiscordMessageLike = {
      id: "existing-1",
      author: { id: "bot", bot: true },
      embeds: [
        {
          title: "old",
          description: "old",
          footer: { text: buildBoosterGuideEmbed(card).footer.text },
        },
      ],
      attachments: [],
    };
    const messages = [
      existing,
      ...BOOSTER_GUIDE_CARDS.slice(1).map((c, i) => ({
        id: `ok-${i}`,
        author: { id: "bot", bot: true },
        embeds: [
          {
            title: buildBoosterGuideEmbed(c).title,
            description: buildBoosterGuideEmbed(c).description,
            footer: { text: buildBoosterGuideEmbed(c).footer.text },
            fields: buildBoosterGuideEmbed(c).fields,
          },
        ],
        attachments: c.imageFile
          ? [{ id: "a", filename: c.imageFile, url: "https://cdn.example/x.png" }]
          : [],
        components: c.linkButton ? [{ type: 1 }] : [],
      })),
    ];

    const plan = planBoosterGuidePublish({ channelId: "ch", botUserId: "bot", messages });
    const client: GuideDiscordClient = {
      listMessages: vi.fn(),
      createMessage: vi.fn(async ({ embed }) => {
        created.push(String(embed.footer.text));
        return { id: `new-${created.length}` };
      }),
      editMessage: vi.fn(async ({ messageId }) => {
        edited.push(messageId);
        return { id: messageId };
      }),
      deleteMessage: vi.fn(),
    };

    // Avoid reading real screenshot files: stub by using empty files via a fake load path —
    // execute reads screenshots for update/create. Use dryRun false only with image-less cards.
    // Force imageFile null by filtering actions: instead mock read by providing screenshots that exist.
    // Simpler: spy and only run update for getting-started with files=[] by temporarily clearing image —
    // Call edit path through execute with a custom plan.
    const updateOnlyPlan = {
      channelId: "ch",
      actions: [{ type: "update" as const, cardKey: "getting-started", messageId: "existing-1" }],
      legacyMessageIds: [] as string[],
      errors: [] as string[],
    };

    const cardsNoImage = BOOSTER_GUIDE_CARDS.map((c) =>
      c.key === "getting-started" ? { ...c, imageFile: null } : c,
    );

    await executeBoosterGuidePublish({
      client,
      channelId: "ch",
      plan: updateOnlyPlan,
      screenshotsDir: ".",
      cards: cardsNoImage,
      dryRun: false,
    });

    expect(edited).toEqual(["existing-1"]);
    expect(created).toEqual([]);
    expect(plan.actions.some((a) => a.type === "create" && a.cardKey === "getting-started")).toBe(false);
  });
});
