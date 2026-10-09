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
  RAIDLEAD_GUIDE_CARD_KEY_RENAMES,
  resolveRaidleadGuideCardKey,
  validateRaidleadGuideCardKeyRenames,
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
      "complete-run",
    ]);
  });

  it("documents Community, Publish Roster, and a completion step without any financial workflow", () => {
    const create = RAIDLEAD_GUIDE_CARDS.find((c) => c.key === "create-run")!;
    const roster = RAIDLEAD_GUIDE_CARDS.find((c) => c.key === "build-roster")!;
    const complete = RAIDLEAD_GUIDE_CARDS.find((c) => c.key === "complete-run")!;
    expect(create.description).toMatch(/Community/);
    expect(roster.description).toMatch(/Publish Roster/);
    expect(complete.description).toMatch(/Correct Attendance/);
    for (const card of RAIDLEAD_GUIDE_CARDS) {
      expect(JSON.stringify(card)).not.toMatch(/payout|settlement|mark paid|gold pot/i);
    }
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

describe("canonical card key renames", () => {
  const currentGuide = () =>
    RAIDLEAD_GUIDE_CARDS.map((card, i) => marked(card.key, `m${i}`, assetRevisions[card.key]));

  /** The completion card as published before the payout removal (old key + old copy). */
  function publishedCompletePayout(id: string): DiscordMessageLike {
    const message = marked("complete-run", id, assetRevisions["complete-run"]);
    const embed = message.embeds![0]!;
    return {
      ...message,
      embeds: [
        {
          ...embed,
          title: "💰 Complete & Payout",
          description: "After **Complete**, open the **Payout** tab.",
          footer: {
            text: embed.footer!.text!.replace(
              `${RAIDLEAD_GUIDE_MARKER_PREFIX}complete-run`,
              `${RAIDLEAD_GUIDE_MARKER_PREFIX}complete-payout`,
            ),
          },
        },
      ],
    };
  }

  /** Production state before republish: basics with payout wording + complete-payout. */
  function productionBeforeRepublish(): DiscordMessageLike[] {
    const messages = currentGuide();
    const basics = messages[0]!;
    messages[0] = {
      ...basics,
      embeds: [
        {
          ...basics.embeds![0]!,
          description: `${basics.embeds![0]!.description} Use the Dashboard for Build Roster / Start / Attendance / Payout hand-offs.`,
        },
      ],
    };
    messages[5] = publishedCompletePayout("1554676249627070554");
    return messages;
  }

  it("declares complete-payout → complete-run and the declared renames are valid", () => {
    expect(RAIDLEAD_GUIDE_CARD_KEY_RENAMES).toContainEqual({ from: "complete-payout", to: "complete-run" });
    expect(validateRaidleadGuideCardKeyRenames()).toEqual([]);
    expect(resolveRaidleadGuideCardKey("complete-payout")).toBe("complete-run");
    expect(resolveRaidleadGuideCardKey("create-run")).toBe("create-run");
  });

  it("leaves a plan over current canonical keys only unchanged (no-op)", () => {
    const plan = planRaidleadGuidePublish({ channelId: "ch", botUserId: BOT, messages: currentGuide(), assetRevisions });
    expect(plan.errors).toEqual([]);
    expect(plan.actions).toHaveLength(6);
    expect(plan.actions.every((a) => a.type === "unchanged")).toBe(true);
  });

  it("resolves an existing complete-payout message to the complete-run card", () => {
    const { byKey } = indexCanonicalGuideMessages(productionBeforeRepublish(), BOT);
    expect(byKey.get("complete-run")?.map((m) => m.id)).toEqual(["1554676249627070554"]);
    expect(byKey.has("complete-payout")).toBe(false);
  });

  it("plans UPDATE of the renamed message and of the basics card, with no create and no orphan", () => {
    const plan = planRaidleadGuidePublish({
      channelId: "ch",
      botUserId: BOT,
      messages: productionBeforeRepublish(),
      assetRevisions,
    });
    expect(plan.errors).toEqual([]);
    expect(plan.actions).toHaveLength(6);
    expect(plan.actions.filter((a) => a.type === "create")).toEqual([]);
    expect(plan.actions.filter((a) => a.type === "update")).toEqual([
      { type: "update", cardKey: "raid-lead-basics", messageId: "m0" },
      { type: "update", cardKey: "complete-run", messageId: "1554676249627070554" },
    ]);
    expect(plan.actions.some((a) => a.cardKey === "complete-payout")).toBe(false);
  });

  it("plans UPDATE for a renamed card even when its content already matches (footer migrates)", () => {
    const messages = currentGuide();
    const current = messages[5]!;
    const footer = current.embeds![0]!.footer!.text!;
    messages[5] = {
      ...current,
      id: "renamed",
      embeds: [{ ...current.embeds![0]!, footer: { text: footer.replace(":complete-run", ":complete-payout") } }],
    };
    const plan = planRaidleadGuidePublish({ channelId: "ch", botUserId: BOT, messages, assetRevisions });
    expect(plan.actions.find((a) => a.cardKey === "complete-run")).toEqual({
      type: "update",
      cardKey: "complete-run",
      messageId: "renamed",
    });
  });

  it("publishes the update in place with the complete-run footer, and verification then passes", async () => {
    const edits: Array<{ messageId: string; footer: string; title: string }> = [];
    const client: GuideDiscordClient = {
      listMessages: vi.fn(async () => []),
      createMessage: vi.fn(async () => ({ id: "created" })),
      editMessage: vi.fn(async ({ messageId, embed }) => {
        edits.push({ messageId, footer: embed.footer.text, title: embed.title });
        return { id: messageId };
      }),
      deleteMessage: vi.fn(),
    };
    const cardsNoImage = RAIDLEAD_GUIDE_CARDS.map((c) => ({ ...c, imageFile: null }));
    const nullAssets = Object.fromEntries(cardsNoImage.map((c) => [c.key, null])) as Record<string, string | null>;
    const before = cardsNoImage.map((card, i) => {
      const embed = buildRaidleadGuideEmbed(card, { assetRevision: null });
      const footer =
        card.key === "complete-run" ? embed.footer.text.replace(":complete-run", ":complete-payout") : embed.footer.text;
      return {
        id: card.key === "complete-run" ? "1554676249627070554" : `m${i}`,
        author: { id: BOT, bot: true },
        content: "",
        embeds: [{ title: embed.title, description: embed.description, footer: { text: footer }, fields: embed.fields }],
        attachments: [],
        components: card.linkButton ? [{ type: 1 }] : [],
      } satisfies DiscordMessageLike;
    });
    const plan = planRaidleadGuidePublish({
      channelId: "ch",
      botUserId: BOT,
      messages: before,
      assetRevisions: nullAssets,
      cards: cardsNoImage,
    });
    expect(plan.errors).toEqual([]);

    const result = await executeRaidleadGuidePublish({
      client,
      channelId: "ch",
      plan,
      screenshotsDir: ".",
      botUserId: BOT,
      cards: cardsNoImage,
      dryRun: false,
    });

    expect(result).toMatchObject({ created: 0, updated: 1, unchanged: 5, retiredLegacy: 0 });
    expect(client.createMessage).not.toHaveBeenCalled();
    expect(client.deleteMessage).not.toHaveBeenCalled();
    expect(edits).toHaveLength(1);
    expect(edits[0]!.messageId).toBe("1554676249627070554");
    expect(parseRaidleadGuideCardKey(edits[0]!.footer)).toBe("complete-run");
    expect(edits[0]!.footer).toContain(`${RAIDLEAD_GUIDE_MARKER_PREFIX}complete-run`);
    expect(result.messageIdsByCard["complete-run"]).toBe("1554676249627070554");

    // Re-read after the edit: the migrated footer satisfies canonical verification.
    const after = before.map((m) =>
      m.id === "1554676249627070554"
        ? { ...m, embeds: [{ ...m.embeds[0]!, footer: { text: edits[0]!.footer } }] }
        : m,
    );
    const verified = verifyCanonicalRaidleadGuideState({
      messages: after,
      botUserId: BOT,
      cards: cardsNoImage,
      assetRevisions: nullAssets,
    });
    expect(verified.ok).toBe(true);
  });

  it("refuses when both the renamed and the current card are present (no orphan, no guess)", () => {
    const messages = [...currentGuide(), publishedCompletePayout("old")];
    const plan = planRaidleadGuidePublish({ channelId: "ch", botUserId: BOT, messages, assetRevisions });
    expect(plan.errors.join(" ")).toMatch(/Ambiguous state: card key "complete-run" appears on 2 messages/);
    expect(plan.actions).toEqual([]);
  });

  it("still refuses an unknown key that is not a declared rename", () => {
    const messages = currentGuide();
    const stray = marked("create-run", "stray", assetRevisions["create-run"]);
    const footer = stray.embeds![0]!.footer!.text!;
    messages.push({
      ...stray,
      embeds: [{ ...stray.embeds![0]!, footer: { text: footer.replace(":create-run", ":some-random-old-key") } }],
    });
    const plan = planRaidleadGuidePublish({ channelId: "ch", botUserId: BOT, messages, assetRevisions });
    expect(plan.errors.join(" ")).toMatch(/Unknown canonical key "some-random-old-key"/);
    expect(plan.actions).toEqual([]);
  });

  it("fails validation for a rename whose target is not a current card", () => {
    const renames = [{ from: "complete-payout", to: "complete-gold" }];
    expect(validateRaidleadGuideCardKeyRenames(RAIDLEAD_GUIDE_CARDS, renames).join(" ")).toMatch(
      /target is not a current card/,
    );
    const plan = planRaidleadGuidePublish({
      channelId: "ch",
      botUserId: BOT,
      messages: currentGuide(),
      assetRevisions,
      renames,
    });
    expect(plan.errors.join(" ")).toMatch(/target is not a current card/);
    expect(plan.actions).toEqual([]);
  });

  it("fails validation for ambiguous, self, current-key and chained renames", () => {
    const errors = (renames: Array<{ from: string; to: string }>) =>
      validateRaidleadGuideCardKeyRenames(RAIDLEAD_GUIDE_CARDS, renames).join(" ");
    expect(
      errors([
        { from: "complete-payout", to: "complete-run" },
        { from: "complete-payout", to: "run-attendance" },
      ]),
    ).toMatch(/declared more than once/);
    expect(errors([{ from: "complete-run", to: "complete-run" }])).toMatch(/maps to itself/);
    expect(errors([{ from: "create-run", to: "complete-run" }])).toMatch(/source is still a current card key/);
    expect(
      errors([
        { from: "older-key", to: "complete-payout" },
        { from: "complete-payout", to: "complete-run" },
      ]),
    ).toMatch(/no chaining/);
  });

  it("does not affect the legacy six-message set (renames are v2-footer only)", () => {
    const legacy = ([1, 2, 3, 4, 5, 6] as const).map((slot) => legacyMessage(slot, `old-${slot}`));
    const set = identifyKnownLegacyRaidleadGuideSet([...productionBeforeRepublish(), ...legacy], BOT);
    expect(set.complete).toBe(true);
    expect(set.messageIds).toEqual(["old-1", "old-2", "old-3", "old-4", "old-5", "old-6"]);
    expect(isLegacyRaidleadGuideMessage(publishedCompletePayout("x"), BOT)).toBe(false);
  });
});

describe("guide screenshot capture hygiene", () => {
  it("flags forbidden development-auth strings", () => {
    expect(containsForbiddenGuideScreenshotText("Development Identities panel")).toBe(true);
    expect(containsForbiddenGuideScreenshotText("Raid Lead Dashboard")).toBe(false);
    expect(FORBIDDEN_GUIDE_SCREENSHOT_TEXT.length).toBeGreaterThan(0);
  });
});
