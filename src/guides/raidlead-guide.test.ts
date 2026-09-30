import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  RAIDLEAD_GUIDE_CARDS,
  RAIDLEAD_GUIDE_MARKER_PREFIX,
  buildRaidleadGuideEmbed,
  hashGuideAssetBytes,
  parseRaidleadGuideAssetRevision,
  parseRaidleadGuideCardKey,
} from "@/guides/raidlead-guide";
import {
  containsForbiddenGuideScreenshotText,
  FORBIDDEN_GUIDE_SCREENSHOT_TEXT,
} from "@/guides/guide-screenshot-capture";
import {
  EXPECTED_LEGACY_RAIDLEAD_GUIDE_COUNT,
  executeRaidleadGuidePublish,
  guideMessageNeedsUpdate,
  identifyKnownLegacyRaidleadGuideSet,
  indexCanonicalGuideMessages,
  isLegacyRaidleadGuideMessage,
  LEGACY_RAIDLEAD_GUIDE_FINGERPRINTS,
  planRaidleadGuidePublish,
  validateRaidleadGuideCards,
  verifyCanonicalRaidleadGuideState,
  type DiscordMessageLike,
  type GuideDiscordClient,
  type LegacyRaidleadGuideSlot,
} from "@/guides/raidlead-guide-publisher";
import { APP_BRAND_NAME } from "@/lib/branding";

const BOT = "bot-1";

function marked(
  cardKey: string,
  id: string,
  assetRevision: string | null,
  overrides?: Partial<DiscordMessageLike>,
): DiscordMessageLike {
  const card = RAIDLEAD_GUIDE_CARDS.find((c) => c.key === cardKey)!;
  const embed = buildRaidleadGuideEmbed(card, { assetRevision });
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
        image: embed.image,
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
  slot: LegacyRaidleadGuideSlot,
  id: string,
  overrides?: Partial<DiscordMessageLike>,
): DiscordMessageLike {
  const bodies: Record<LegacyRaidleadGuideSlot, { content: string; files: string[] }> = {
    1: {
      content: `## 📗 Raid Lead Guide\n\nA quick introduction to **Manawyrm Hub** as a **RAID_LEAD**.`,
      files: ["common-01-login.png", "rl-01-dashboard.png"],
    },
    2: {
      content: `### 3. Create a run\n1. **Runs** → **Create Run**`,
      files: ["rl-04-create-run.png", "rl-03-manage-runs.png"],
    },
    3: {
      content: `### 5. Open the run and control signups\nOn the run page (**Overview**):`,
      files: ["rl-06-run-overview.png", "rl-02-runs.png"],
    },
    4: {
      content: `### 6. Build and publish the roster\n**Roster** tab:`,
      files: ["rl-05-roster.png"],
    },
    5: {
      content: `### 7. Start the run\nOn a **PUBLISHED** run: **Start Run**.`,
      files: ["rl-08-start-run.png", "rl-07-attendance.png"],
    },
    6: {
      content: `### 9. Payout (short)\nAfter **COMPLETED**, **Payout** tab:`,
      files: [],
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
  RAIDLEAD_GUIDE_CARDS.map((card) => [card.key, card.imageFile ? "aaaaaaaaaaaa" : null]),
) as Record<string, string | null>;

describe("raid lead guide v2 content", () => {
  it("has exactly six canonical cards", () => {
    expect(RAIDLEAD_GUIDE_CARDS).toHaveLength(6);
    expect(RAIDLEAD_GUIDE_CARDS.map((c) => c.key)).toEqual([
      "raid-lead-basics",
      "create-run",
      "open-manage-signups",
      "build-roster",
      "run-attendance",
      "complete-payout",
    ]);
  });

  it("documents Community, Publish Roster, and external booster payout exclusion", () => {
    const create = RAIDLEAD_GUIDE_CARDS.find((c) => c.key === "create-run")!;
    const roster = RAIDLEAD_GUIDE_CARDS.find((c) => c.key === "build-roster")!;
    const payout = RAIDLEAD_GUIDE_CARDS.find((c) => c.key === "complete-payout")!;
    expect(create.description).toMatch(/Community/);
    expect(roster.description).toMatch(/Publish Roster/);
    expect(payout.description).toMatch(/External boosters are not on the settlement/);
  });

  it("attaches a screenshot to every card", () => {
    for (const card of RAIDLEAD_GUIDE_CARDS) {
      expect(card.imageFile).toBeTruthy();
    }
  });

  it("stays within Discord embed size limits", () => {
    expect(validateRaidleadGuideCards()).toEqual([]);
  });

  it("parses card key without treating asset revision as part of the key", () => {
    const footer = buildRaidleadGuideEmbed(RAIDLEAD_GUIDE_CARDS[0]!, {
      assetRevision: "deadbeefcafe",
    }).footer.text;
    expect(footer).toContain(`${RAIDLEAD_GUIDE_MARKER_PREFIX}raid-lead-basics`);
    expect(footer).toContain("asset:deadbeefcafe");
    expect(parseRaidleadGuideCardKey(footer)).toBe("raid-lead-basics");
    expect(parseRaidleadGuideAssetRevision(footer)).toBe("deadbeefcafe");
  });
});

describe("legacy raid lead guide set", () => {
  it("models and recognizes all six previous guide messages", () => {
    expect(LEGACY_RAIDLEAD_GUIDE_FINGERPRINTS).toHaveLength(EXPECTED_LEGACY_RAIDLEAD_GUIDE_COUNT);
    const messages = ([1, 2, 3, 4, 5, 6] as const).map((slot) => legacyMessage(slot, `old-${slot}`));
    const set = identifyKnownLegacyRaidleadGuideSet(messages, BOT);
    expect(set.complete).toBe(true);
    expect(set.messageIds).toEqual(["old-1", "old-2", "old-3", "old-4", "old-5", "old-6"]);
    expect(messages.every((m) => isLegacyRaidleadGuideMessage(m, BOT))).toBe(true);
  });

  it("does not recognize unrelated bot messages", () => {
    const unrelated: DiscordMessageLike = {
      id: "x1",
      author: { id: BOT, bot: true },
      content: "### Dashboard status for tonight's run",
      attachments: [{ id: "a", filename: "random.png", url: "https://cdn.example/r.png" }],
    };
    expect(isLegacyRaidleadGuideMessage(unrelated, BOT)).toBe(false);
    const set = identifyKnownLegacyRaidleadGuideSet([unrelated], BOT);
    expect(set.complete).toBe(false);
    expect(set.messageIds).toEqual([]);
  });

  it("refuses retirement planning when the legacy set is incomplete", () => {
    const messages = [legacyMessage(1, "old-1"), legacyMessage(3, "old-3")];
    const plan = planRaidleadGuidePublish({
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

  it("plans retirement against exactly six known legacy ids when complete", () => {
    const messages = ([1, 2, 3, 4, 5, 6] as const).map((slot) => legacyMessage(slot, `old-${slot}`));
    const plan = planRaidleadGuidePublish({
      channelId: "ch",
      botUserId: BOT,
      messages,
      assetRevisions,
      retireLegacy: true,
    });
    expect(plan.errors).toEqual([]);
    expect(plan.legacyComplete).toBe(true);
    expect(plan.legacyMessageIds).toEqual(["old-1", "old-2", "old-3", "old-4", "old-5", "old-6"]);
    expect(plan.actions.filter((a) => a.type === "create")).toHaveLength(6);
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
    const existing = marked("raid-lead-basics", "m1", "aaaaaaaaaaaa");
    expect(guideMessageNeedsUpdate(existing, RAIDLEAD_GUIDE_CARDS[0]!, "aaaaaaaaaaaa")).toBe(false);
  });

  it("treats same filename + different asset revision as update", () => {
    const existing = marked("raid-lead-basics", "m1", "aaaaaaaaaaaa");
    expect(guideMessageNeedsUpdate(existing, RAIDLEAD_GUIDE_CARDS[0]!, "bbbbbbbbbbbb")).toBe(true);
  });

  it("converges to unchanged after the revision is written", () => {
    const updated = marked("raid-lead-basics", "m1", "bbbbbbbbbbbb");
    expect(guideMessageNeedsUpdate(updated, RAIDLEAD_GUIDE_CARDS[0]!, "bbbbbbbbbbbb")).toBe(false);
    const plan = planRaidleadGuidePublish({
      channelId: "ch",
      botUserId: BOT,
      messages: [
        updated,
        ...RAIDLEAD_GUIDE_CARDS.slice(1).map((card, i) =>
          marked(card.key, `m${i + 2}`, assetRevisions[card.key]),
        ),
      ],
      assetRevisions: { ...assetRevisions, "raid-lead-basics": "bbbbbbbbbbbb" },
    });
    expect(plan.actions.every((a) => a.type === "unchanged")).toBe(true);
  });

  it("treats CDN embed.image without attachments as present for screenshot cards", () => {
    const card = RAIDLEAD_GUIDE_CARDS.find((c) => c.key === "raid-lead-basics")!;
    const existing: DiscordMessageLike = {
      id: "m-cdn",
      author: { id: BOT, bot: true },
      content: "",
      embeds: [
        {
          title: card.title,
          description: card.description,
          footer: {
            text: `${APP_BRAND_NAME} · ${RAIDLEAD_GUIDE_MARKER_PREFIX}raid-lead-basics · asset:aaaaaaaaaaaa`,
          },
          image: { url: "https://cdn.discordapp.com/attachments/1/2/rl-01-dashboard.png" },
        },
      ],
      attachments: [],
      components: card.linkButton ? [{ type: 1 }] : [],
    };
    expect(guideMessageNeedsUpdate(existing, card, "aaaaaaaaaaaa")).toBe(false);
  });
});

describe("canonical verification and retirement gate", () => {
  it("requires exactly one message per v2 card", () => {
    const messages = RAIDLEAD_GUIDE_CARDS.map((card, i) =>
      marked(card.key, `m${i}`, assetRevisions[card.key]),
    );
    const ok = verifyCanonicalRaidleadGuideState({
      messages,
      botUserId: BOT,
      assetRevisions,
    });
    expect(ok.ok).toBe(true);

    const missing = verifyCanonicalRaidleadGuideState({
      messages: messages.slice(1),
      botUserId: BOT,
      assetRevisions,
    });
    expect(missing.ok).toBe(false);
    expect(missing.errors.join(" ")).toMatch(/raid-lead-basics/);
  });

  it("does not delete legacy when a canonical card is still missing after upsert", async () => {
    const deleted: string[] = [];
    const cardsNoImage = RAIDLEAD_GUIDE_CARDS.map((c) => ({ ...c, imageFile: null }));
    const nullAssets = Object.fromEntries(cardsNoImage.map((c) => [c.key, null])) as Record<
      string,
      string | null
    >;
    const incompleteAfterUpsert: DiscordMessageLike[] = cardsNoImage.slice(1).map((card, i) => {
      const embed = buildRaidleadGuideEmbed(card, { assetRevision: null });
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

    const plan = planRaidleadGuidePublish({
      channelId: "ch",
      botUserId: BOT,
      messages: [],
      assetRevisions: nullAssets,
      cards: cardsNoImage,
      retireLegacy: true,
    });
    plan.legacyComplete = true;
    plan.legacyMessageIds = ["old-1", "old-2", "old-3", "old-4", "old-5", "old-6"];
    plan.errors = [];

    const result = await executeRaidleadGuidePublish({
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

  it("retires exactly the six known legacy ids after successful verification", async () => {
    const deleted: string[] = [];
    const cardsNoImage = RAIDLEAD_GUIDE_CARDS.map((c) => ({ ...c, imageFile: null }));
    const nullAssets = Object.fromEntries(cardsNoImage.map((c) => [c.key, null])) as Record<
      string,
      string | null
    >;
    const canonicalMessages: DiscordMessageLike[] = cardsNoImage.map((card, i) => {
      const embed = buildRaidleadGuideEmbed(card, { assetRevision: null });
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
    const legacy = ([1, 2, 3, 4, 5, 6] as const).map((slot) => legacyMessage(slot, `old-${slot}`));

    const client: GuideDiscordClient = {
      listMessages: vi.fn(async () => [...canonicalMessages, ...legacy]),
      createMessage: vi.fn(async () => ({ id: "created" })),
      editMessage: vi.fn(async ({ messageId }) => ({ id: messageId })),
      deleteMessage: vi.fn(async (_channelId, messageId) => {
        deleted.push(messageId);
      }),
    };

    const plan = planRaidleadGuidePublish({
      channelId: "ch",
      botUserId: BOT,
      messages: canonicalMessages,
      assetRevisions: nullAssets,
      cards: cardsNoImage,
      retireLegacy: false,
    });
    expect(plan.errors).toEqual([]);
    const retirePlan = {
      ...plan,
      legacyMessageIds: legacy.map((m) => m.id),
      legacyComplete: true,
    };

    const result = await executeRaidleadGuidePublish({
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
    expect(deleted.sort()).toEqual(["old-1", "old-2", "old-3", "old-4", "old-5", "old-6"]);
    expect(result.retiredLegacy).toBe(6);
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
    const plan = planRaidleadGuidePublish({
      channelId: "ch",
      botUserId: BOT,
      messages: [],
      assetRevisions,
    });
    await executeRaidleadGuidePublish({
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
    const messages = [marked("raid-lead-basics", "m1", "aaaaaaaaaaaa")];
    const { byKey } = indexCanonicalGuideMessages(messages, BOT);
    expect(byKey.get("raid-lead-basics")?.[0]?.id).toBe("m1");
  });

  it("refuses ambiguous duplicate canonical cards", () => {
    const plan = planRaidleadGuidePublish({
      channelId: "ch",
      botUserId: BOT,
      messages: [
        marked("raid-lead-basics", "m1", "aaaaaaaaaaaa"),
        marked("raid-lead-basics", "m1b", "aaaaaaaaaaaa"),
      ],
      assetRevisions,
    });
    expect(plan.errors.join(" ")).toMatch(/Ambiguous/);
    expect(plan.actions).toEqual([]);
  });

  it("plans create for a missing card (recovery)", () => {
    const messages = RAIDLEAD_GUIDE_CARDS.slice(1).map((card, i) =>
      marked(card.key, `m${i + 2}`, assetRevisions[card.key]),
    );
    const plan = planRaidleadGuidePublish({
      channelId: "ch",
      botUserId: BOT,
      messages,
      assetRevisions,
    });
    expect(plan.errors).toEqual([]);
    expect(plan.actions.find((a) => a.cardKey === "raid-lead-basics")).toEqual({
      type: "create",
      cardKey: "raid-lead-basics",
    });
  });
});

describe("guide screenshot capture hygiene", () => {
  it("flags forbidden development-auth strings", () => {
    expect(containsForbiddenGuideScreenshotText("Development Identities panel")).toBe(true);
    expect(containsForbiddenGuideScreenshotText("Raid Lead Dashboard")).toBe(false);
    expect(FORBIDDEN_GUIDE_SCREENSHOT_TEXT.length).toBeGreaterThan(0);
  });
});
