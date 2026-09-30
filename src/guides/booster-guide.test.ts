import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  BOOSTER_GUIDE_CARDS,
  BOOSTER_GUIDE_MARKER_PREFIX,
  buildBoosterGuideEmbed,
  hashGuideAssetBytes,
  parseBoosterGuideAssetRevision,
  parseBoosterGuideCardKey,
} from "@/guides/booster-guide";
import {
  guideSignupPreviewButtonActions,
  guideSignupPreviewFixture,
  renderGuideSignupPreviewHtml,
} from "@/guides/booster-guide-discord-preview";
import {
  containsForbiddenGuideScreenshotText,
  FORBIDDEN_GUIDE_SCREENSHOT_TEXT,
} from "@/guides/guide-screenshot-capture";
import {
  EXPECTED_LEGACY_BOOSTER_GUIDE_COUNT,
  executeBoosterGuidePublish,
  guideMessageNeedsUpdate,
  identifyKnownLegacyBoosterGuideSet,
  indexCanonicalGuideMessages,
  isLegacyBoosterGuideMessage,
  LEGACY_BOOSTER_GUIDE_FINGERPRINTS,
  planBoosterGuidePublish,
  validateBoosterGuideCards,
  verifyCanonicalBoosterGuideState,
  type DiscordMessageLike,
  type GuideDiscordClient,
} from "@/guides/booster-guide-publisher";
import { RUN_LOOT_TYPES } from "@/models/enums";

const BOT = "bot-1";

function marked(
  cardKey: string,
  id: string,
  assetRevision: string | null,
  overrides?: Partial<DiscordMessageLike>,
): DiscordMessageLike {
  const card = BOOSTER_GUIDE_CARDS.find((c) => c.key === cardKey)!;
  const embed = buildBoosterGuideEmbed(card, { assetRevision });
  return {
    id,
    author: { id: BOT, bot: true },
    content: "",
    embeds: [
      {
        title: embed.title,
        description: embed.description,
        footer: { text: embed.footer.text },
        fields: embed.fields,
      },
    ],
    attachments: card.imageFile
      ? [{ id: "a1", filename: card.imageFile, url: "https://cdn.example/x.png" }]
      : [],
    components: card.linkButton ? [{ type: 1 }] : [],
    ...overrides,
  };
}

function legacyMessage(
  slot: 1 | 2 | 3 | 4 | 5,
  id: string,
  overrides?: Partial<DiscordMessageLike>,
): DiscordMessageLike {
  const bodies: Record<1 | 2 | 3 | 4 | 5, { content: string; files: string[] }> = {
    1: {
      content: `## 📘 Booster Guide\n\nA quick introduction to **Manawyrm Hub**.\nApp: https://manawyrm-boosting.com`,
      files: ["common-01-login.png"],
    },
    2: {
      content: `### 2. Dashboard\nAt a glance:\n• Upcoming Runs\n\n### 3. Add characters\nUnder **Characters**:`,
      files: ["bo-01-dashboard.png", "bo-02-characters.png"],
    },
    3: {
      content: `### 4. Sign up for a run\nOpen **Runs** → **Sign up**.`,
      files: ["bo-03-runs.png", "bo-04-signup.png"],
    },
    4: {
      content: `### 5. Signing up via the Discord bot\nEvery open run has a channel with buttons.`,
      files: [],
    },
    5: {
      content: `### 6. Status under My Runs\n• Selected\n• Pending`,
      files: ["bo-05-my-runs.png"],
    },
  };
  const body = bodies[slot];
  return {
    id,
    author: { id: BOT, bot: true },
    content: body.content,
    embeds: [],
    attachments: body.files.map((filename, i) => ({
      id: `att-${slot}-${i}`,
      filename,
      url: `https://cdn.example/${filename}`,
    })),
    ...overrides,
  };
}

const assetRevisions = Object.fromEntries(
  BOOSTER_GUIDE_CARDS.map((card) => [card.key, card.imageFile ? "aaaaaaaaaaaa" : null]),
) as Record<string, string | null>;

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
    expect(web.description).toMatch(/Save Booster Offers/);
  });

  it("stays within Discord embed size limits", () => {
    expect(validateBoosterGuideCards()).toEqual([]);
  });

  it("parses card key without treating asset revision as part of the key", () => {
    const footer = buildBoosterGuideEmbed(BOOSTER_GUIDE_CARDS[0]!, {
      assetRevision: "deadbeefcafe",
    }).footer.text;
    expect(footer).toContain(`${BOOSTER_GUIDE_MARKER_PREFIX}getting-started`);
    expect(footer).toContain("asset:deadbeefcafe");
    expect(parseBoosterGuideCardKey(footer)).toBe("getting-started");
    expect(parseBoosterGuideAssetRevision(footer)).toBe("deadbeefcafe");
  });
});

describe("legacy booster guide set", () => {
  it("models and recognizes all five previous guide messages", () => {
    expect(LEGACY_BOOSTER_GUIDE_FINGERPRINTS).toHaveLength(EXPECTED_LEGACY_BOOSTER_GUIDE_COUNT);
    const messages = [1, 2, 3, 4, 5].map((slot) =>
      legacyMessage(slot as 1 | 2 | 3 | 4 | 5, `old-${slot}`),
    );
    const set = identifyKnownLegacyBoosterGuideSet(messages, BOT);
    expect(set.complete).toBe(true);
    expect(set.messageIds).toEqual(["old-1", "old-2", "old-3", "old-4", "old-5"]);
    expect(messages.every((m) => isLegacyBoosterGuideMessage(m, BOT))).toBe(true);
  });

  it("does not recognize unrelated bot messages", () => {
    const unrelated: DiscordMessageLike = {
      id: "x1",
      author: { id: BOT, bot: true },
      content: "### Dashboard status for tonight's run",
      attachments: [{ id: "a", filename: "random.png", url: "https://cdn.example/r.png" }],
    };
    expect(isLegacyBoosterGuideMessage(unrelated, BOT)).toBe(false);
    const set = identifyKnownLegacyBoosterGuideSet([unrelated], BOT);
    expect(set.complete).toBe(false);
    expect(set.messageIds).toEqual([]);
  });

  it("refuses retirement planning when the legacy set is incomplete", () => {
    const messages = [legacyMessage(1, "old-1"), legacyMessage(3, "old-3")];
    const plan = planBoosterGuidePublish({
      channelId: "ch",
      botUserId: BOT,
      messages,
      assetRevisions,
      retireLegacy: true,
    });
    expect(plan.errors.join(" ")).toMatch(/retire-legacy/);
    expect(plan.legacyComplete).toBe(false);
    expect(plan.actions).toEqual([]);
  });

  it("plans retirement against exactly five known legacy ids when complete", () => {
    const messages = [1, 2, 3, 4, 5].map((slot) =>
      legacyMessage(slot as 1 | 2 | 3 | 4 | 5, `old-${slot}`),
    );
    const plan = planBoosterGuidePublish({
      channelId: "ch",
      botUserId: BOT,
      messages,
      assetRevisions,
      retireLegacy: true,
    });
    expect(plan.errors).toEqual([]);
    expect(plan.legacyComplete).toBe(true);
    expect(plan.legacyMessageIds).toEqual(["old-1", "old-2", "old-3", "old-4", "old-5"]);
    expect(plan.actions.filter((a) => a.type === "create")).toHaveLength(5);
  });
});

describe("asset fingerprinting", () => {
  it("hashes screenshot bytes stably", () => {
    const a = hashGuideAssetBytes(Buffer.from("png-bytes-a"));
    const b = hashGuideAssetBytes(Buffer.from("png-bytes-a"));
    const c = hashGuideAssetBytes(Buffer.from("png-bytes-b"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(12);
    expect(createHash("sha256").update("png-bytes-a").digest("hex").startsWith(a)).toBe(true);
  });

  it("treats same filename + same asset revision as unchanged", () => {
    const existing = marked("getting-started", "m1", "aaaaaaaaaaaa");
    expect(guideMessageNeedsUpdate(existing, BOOSTER_GUIDE_CARDS[0]!, "aaaaaaaaaaaa")).toBe(false);
  });

  it("treats same filename + different asset revision as update", () => {
    const existing = marked("getting-started", "m1", "aaaaaaaaaaaa");
    expect(guideMessageNeedsUpdate(existing, BOOSTER_GUIDE_CARDS[0]!, "bbbbbbbbbbbb")).toBe(true);
  });

  it("converges to unchanged after the revision is written", () => {
    const updated = marked("getting-started", "m1", "bbbbbbbbbbbb");
    expect(guideMessageNeedsUpdate(updated, BOOSTER_GUIDE_CARDS[0]!, "bbbbbbbbbbbb")).toBe(false);
    const plan = planBoosterGuidePublish({
      channelId: "ch",
      botUserId: BOT,
      messages: [
        updated,
        ...BOOSTER_GUIDE_CARDS.slice(1).map((card, i) =>
          marked(card.key, `m${i + 2}`, assetRevisions[card.key]),
        ),
      ],
      assetRevisions: { ...assetRevisions, "getting-started": "bbbbbbbbbbbb" },
    });
    expect(plan.actions.every((a) => a.type === "unchanged")).toBe(true);
  });
});

describe("canonical verification and retirement gate", () => {
  it("requires exactly one message per v2 card", () => {
    const messages = BOOSTER_GUIDE_CARDS.map((card, i) =>
      marked(card.key, `m${i}`, assetRevisions[card.key]),
    );
    const ok = verifyCanonicalBoosterGuideState({
      messages,
      botUserId: BOT,
      assetRevisions,
    });
    expect(ok.ok).toBe(true);

    const missing = verifyCanonicalBoosterGuideState({
      messages: messages.slice(1),
      botUserId: BOT,
      assetRevisions,
    });
    expect(missing.ok).toBe(false);
    expect(missing.errors.join(" ")).toMatch(/getting-started/);
  });

  it("does not delete legacy when a canonical card is still missing after upsert", async () => {
    const deleted: string[] = [];
    const cardsNoImage = BOOSTER_GUIDE_CARDS.map((c) => ({ ...c, imageFile: null }));
    const nullAssets = Object.fromEntries(cardsNoImage.map((c) => [c.key, null])) as Record<
      string,
      string | null
    >;
    const incompleteAfterUpsert: DiscordMessageLike[] = cardsNoImage.slice(1).map((card, i) => {
      const embed = buildBoosterGuideEmbed(card, { assetRevision: null });
      return {
        id: `v2-${i + 1}`,
        author: { id: BOT, bot: true },
        content: "",
        embeds: [
          {
            title: embed.title,
            description: embed.description,
            footer: { text: embed.footer.text },
            fields: embed.fields,
          },
        ],
        attachments: [],
        components: card.linkButton ? [{ type: 1 }] : [],
      };
    });

    const client: GuideDiscordClient = {
      listMessages: vi.fn(async () => incompleteAfterUpsert),
      createMessage: vi.fn(async () => ({ id: "created" })),
      editMessage: vi.fn(async ({ messageId }) => ({ id: messageId })),
      deleteMessage: vi.fn(async (_channelId, messageId) => {
        deleted.push(messageId);
      }),
    };

    const plan = planBoosterGuidePublish({
      channelId: "ch",
      botUserId: BOT,
      messages: [],
      assetRevisions: nullAssets,
      cards: cardsNoImage,
      retireLegacy: true,
    });
    // Pretend we already validated a complete legacy set at plan time.
    plan.legacyComplete = true;
    plan.legacyMessageIds = ["old-1", "old-2", "old-3", "old-4", "old-5"];
    plan.errors = [];

    const result = await executeBoosterGuidePublish({
      client,
      channelId: "ch",
      plan,
      screenshotsDir: ".",
      botUserId: BOT,
      cards: cardsNoImage,
      retireLegacy: true,
      dryRun: false,
    });

    expect(deleted).toEqual([]);
    expect(result.retiredLegacy).toBe(0);
    expect(result.retirementSkippedReason).toMatch(/canonical verification failed/);
  });

  it("retires exactly the five known legacy ids after successful verification", async () => {
    const deleted: string[] = [];
    const cardsNoImage = BOOSTER_GUIDE_CARDS.map((c) => ({ ...c, imageFile: null }));
    const nullAssets = Object.fromEntries(cardsNoImage.map((c) => [c.key, null])) as Record<
      string,
      string | null
    >;
    const canonicalMessages: DiscordMessageLike[] = cardsNoImage.map((card, i) => {
      const embed = buildBoosterGuideEmbed(card, { assetRevision: null });
      return {
        id: `v2-${i}`,
        author: { id: BOT, bot: true },
        content: "",
        embeds: [
          {
            title: embed.title,
            description: embed.description,
            footer: { text: embed.footer.text },
            fields: embed.fields,
          },
        ],
        attachments: [],
        components: card.linkButton ? [{ type: 1 }] : [],
      };
    });
    const legacy = [1, 2, 3, 4, 5].map((slot) =>
      legacyMessage(slot as 1 | 2 | 3 | 4 | 5, `old-${slot}`),
    );

    const client: GuideDiscordClient = {
      listMessages: vi.fn(async () => [...canonicalMessages, ...legacy]),
      createMessage: vi.fn(async () => ({ id: "created" })),
      editMessage: vi.fn(async ({ messageId }) => ({ id: messageId })),
      deleteMessage: vi.fn(async (_channelId, messageId) => {
        deleted.push(messageId);
      }),
    };

    const plan = planBoosterGuidePublish({
      channelId: "ch",
      botUserId: BOT,
      messages: canonicalMessages,
      assetRevisions: nullAssets,
      cards: cardsNoImage,
      retireLegacy: false,
    });
    expect(plan.errors).toEqual([]);
    // Retirement is gated at execute-time after re-read; attach the known set explicitly.
    const retirePlan = {
      ...plan,
      legacyMessageIds: legacy.map((m) => m.id),
      legacyComplete: true,
    };

    const result = await executeBoosterGuidePublish({
      client,
      channelId: "ch",
      plan: retirePlan,
      screenshotsDir: ".",
      botUserId: BOT,
      cards: cardsNoImage,
      retireLegacy: true,
      dryRun: false,
    });

    expect(result.retirementSkippedReason).toBeUndefined();
    expect(deleted.sort()).toEqual(["old-1", "old-2", "old-3", "old-4", "old-5"]);
    expect(result.retiredLegacy).toBe(5);
  });
});

describe("publisher dry-run", () => {
  it("performs no Discord mutation", async () => {
    const client: GuideDiscordClient = {
      listMessages: vi.fn(),
      createMessage: vi.fn(),
      editMessage: vi.fn(),
      deleteMessage: vi.fn(),
    };
    const plan = planBoosterGuidePublish({
      channelId: "ch",
      botUserId: BOT,
      messages: [],
      assetRevisions,
    });
    await executeBoosterGuidePublish({
      client,
      channelId: "ch",
      plan,
      screenshotsDir: ".",
      botUserId: BOT,
      dryRun: true,
    });
    expect(client.createMessage).not.toHaveBeenCalled();
    expect(client.editMessage).not.toHaveBeenCalled();
    expect(client.deleteMessage).not.toHaveBeenCalled();
  });

  it("indexes canonical messages by footer marker", () => {
    const messages = [marked("getting-started", "m1", "aaaaaaaaaaaa")];
    const { byKey } = indexCanonicalGuideMessages(messages, BOT);
    expect(byKey.get("getting-started")?.[0]?.id).toBe("m1");
  });
});

describe("builder-driven Discord signup preview", () => {
  it("uses a valid current RunLootType and real button actions", () => {
    const fixture = guideSignupPreviewFixture();
    expect(RUN_LOOT_TYPES).toContain(fixture.lootType);
    expect(fixture.lootType).not.toBe("Split" as never);
    expect(guideSignupPreviewButtonActions(fixture)).toEqual([
      "signup",
      "quick-signup",
      "lootbuddy",
      "cancel",
    ]);
    const html = renderGuideSignupPreviewHtml(fixture);
    expect(html).toContain("Community");
    expect(html).not.toMatch(/\bSplit\b/);
    expect(html).toContain("Quick Signup");
    expect(html).toContain("generated-from-buildSignupEmbed");
  });
});

describe("guide screenshot capture hygiene", () => {
  it("flags forbidden development-auth strings", () => {
    expect(containsForbiddenGuideScreenshotText("Development Identities panel")).toBe(true);
    expect(containsForbiddenGuideScreenshotText("Dashboard Upcoming Runs")).toBe(false);
    expect(FORBIDDEN_GUIDE_SCREENSHOT_TEXT.length).toBeGreaterThan(0);
  });
});
