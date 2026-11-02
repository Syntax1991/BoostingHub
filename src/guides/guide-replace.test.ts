import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BOOSTER_GUIDE_CARDS, boosterGuidePublisher } from "@/guides/booster-guide";
import { buildGuideComponents, hashGuideAssetBytes, type GuideCard } from "@/guides/guide-card";
import type { GuidePublisher } from "@/guides/guide-publisher";
import { raidleadGuidePublisher } from "@/guides/raidlead-guide";
import {
  DiscordHttpError,
  discordHttpErrorFrom,
  fetchDiscordAsset,
  guideReplaceDir,
  guideReplaceStatePath,
  hasActiveGuideReplacement,
  planGuideReplacement,
  publishGuideReplacement,
  retireOldGuideMessages,
  type GuideReplaceAdapter,
  type GuideReplaceCard,
  type GuideReplaceContext,
  type GuideReplaceMessage,
  type GuideReplaceState,
} from "@/guides/guide-replace";

const BOT = "900";
const OTHER = "901";
const CHANNEL = "555";

type GuideFixture<Card extends GuideReplaceCard> = {
  adapter: GuideReplaceAdapter<Card>;
  footer: (card: Card) => string;
  build: (card: Card) => { embed: Record<string, unknown>; components: unknown[] | undefined };
};

function revisions(cards: readonly GuideReplaceCard[]): Record<string, string | null> {
  return Object.fromEntries(
    cards.map((card) => [card.key, card.imageFile ? hashGuideAssetBytes(Buffer.from(card.key)) : null]),
  );
}

function guideFixture(publisher: GuidePublisher): GuideFixture<GuideCard> {
  const { cards, format } = publisher;
  const assetRevisions = revisions(cards);
  const embedOf = (card: GuideCard) => format.buildEmbed(card, { assetRevision: assetRevisions[card.key] ?? null });
  return {
    adapter: {
      kind: format.kind,
      cards,
      assetRevisions,
      cardErrors: [],
      cardKeyFromFooter: format.parseCardKey,
      needsUpdate: (message, card, revision) => publisher.needsUpdate(message, card, revision),
      render: (card, revision) => format.buildEmbed(card, { assetRevision: revision }),
    },
    footer: (card) => embedOf(card).footer.text,
    build: (card) => ({ embed: embedOf(card), components: buildGuideComponents(card) }),
  };
}

const boosterFixture = () => guideFixture(boosterGuidePublisher);
const raidleadFixture = () => guideFixture(raidleadGuidePublisher);

/** In-memory channel. Fails on demand, and returns the first message for a repeated nonce like Discord. */
class FakeDiscord<Card extends GuideReplaceCard> {
  messages: GuideReplaceMessage[] = [];
  creates: string[] = [];
  deletes: string[] = [];
  /** Runs before a create or delete call; throw to simulate a failure. */
  beforeCreate: (cardKey: string, attempt: number) => void = () => {};
  beforeDelete: (messageId: string, attempt: number) => void = () => {};
  /** Runs after the message exists; throw to simulate a lost answer. */
  afterCreate: (cardKey: string) => void = () => {};
  private nextId = 2000;
  private nonces = new Map<string, string>();
  private attempts = new Map<string, number>();

  constructor(private readonly fixture: GuideFixture<Card>) {}

  private attempt(key: string): number {
    const next = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, next);
    return next;
  }

  seedOldGuide(): string[] {
    return this.fixture.adapter.cards.map((card, index) => {
      const id = String(1000 + index);
      this.messages.push({
        id,
        author: { id: BOT, bot: true },
        content: "",
        embeds: [{ title: "old title", description: "old text", footer: { text: this.fixture.footer(card) } }],
        attachments: [{ id: "a", filename: "old.png", url: `https://cdn.discordapp.com/old/${id}.png` }],
        components: [],
      });
      return id;
    });
  }

  client = {
    listMessages: async () => [...this.messages].reverse(),
    fetchAsset: async (url: string) => {
      const match = /\/card\/([a-z0-9-]+)$/.exec(url);
      return Buffer.from(match ? match[1]! : "old-image");
    },
    deleteMessage: async (_channelId: string, messageId: string) => {
      this.beforeDelete(messageId, this.attempt(`delete:${messageId}`));
      this.deletes.push(messageId);
      this.messages = this.messages.filter((m) => m.id !== messageId);
    },
    createCardMessage: async (input: { card: Card; nonce: string }) => {
      this.beforeCreate(input.card.key, this.attempt(`create:${input.card.key}`));
      const existing = this.nonces.get(input.nonce);
      if (existing) return { id: existing };
      const { embed, components } = this.fixture.build(input.card);
      const id = String(this.nextId);
      this.nextId += 1;
      this.nonces.set(input.nonce, id);
      this.creates.push(input.card.key);
      this.messages.push({
        id,
        author: { id: BOT, bot: true },
        content: "",
        embeds: [
          {
            title: embed.title as string,
            description: embed.description as string,
            footer: embed.footer as { text: string },
            fields: embed.fields as NonNullable<GuideReplaceMessage["embeds"]>[number]["fields"],
            image: input.card.imageFile ? { url: `https://cdn.discordapp.com/card/${input.card.key}` } : undefined,
          },
        ],
        attachments: [],
        components: (components ?? []) as unknown[],
      });
      this.afterCreate(input.card.key);
      return { id };
    },
  };
}

function http429(retryAfter: number, isGlobal = false): DiscordHttpError {
  return new DiscordHttpError(429, "POST", "/x", '{"message":"limited"}', retryAfter, isGlobal);
}

describe("guide replace", () => {
  let snapshotDir: string;
  let sleeps: number[];

  beforeEach(async () => {
    snapshotDir = await mkdtemp(join(tmpdir(), "guide-replace-"));
    sleeps = [];
  });

  afterEach(async () => {
    await rm(snapshotDir, { recursive: true, force: true });
  });

  function context<Card extends GuideReplaceCard>(
    fixture: GuideFixture<Card>,
    discord: FakeDiscord<Card>,
  ): GuideReplaceContext<Card> {
    return {
      adapter: fixture.adapter,
      client: discord.client as unknown as GuideReplaceContext<Card>["client"],
      channelId: CHANNEL,
      botUserId: BOT,
      snapshotDir,
      writePauseMs: 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    };
  }

  async function savedState(): Promise<GuideReplaceState> {
    return JSON.parse(await readFile(guideReplaceStatePath(snapshotDir, CHANNEL), "utf8")) as GuideReplaceState;
  }

  describe.each([
    ["booster", boosterFixture, 5],
    ["raidlead", raidleadFixture, 6],
  ] as const)("full flow for %s", (_name, makeFixture, count) => {
    it("creates and verifies first, deletes only in the separate second run, then stays a no-op", async () => {
      const fixture = makeFixture() as unknown as GuideFixture<GuideReplaceCard>;
      const discord = new FakeDiscord(fixture);
      const oldIds = discord.seedOldGuide();

      const created = await publishGuideReplacement(context(fixture, discord));
      expect(created.ok).toBe(true);
      expect(created.phase).toBe("verified");
      expect(created.created).toBe(count);
      expect(discord.deletes).toEqual([]);
      expect(discord.messages).toHaveLength(count * 2);
      expect(created.remainingOldIds).toEqual(oldIds);

      const retired = await retireOldGuideMessages(context(fixture, discord));
      expect(retired.ok).toBe(true);
      expect(retired.phase).toBe("done");
      expect(discord.deletes).toEqual(oldIds);
      expect(discord.messages.map((m) => m.id)).toEqual(Object.values(retired.newByCard));
      expect(discord.messages.map((m) => fixture.adapter.cardKeyFromFooter(m.embeds?.[0]?.footer?.text))).toEqual(
        fixture.adapter.cards.map((c) => c.key),
      );

      const again = await publishGuideReplacement(context(fixture, discord));
      const retiredAgain = await retireOldGuideMessages(context(fixture, discord));
      expect(again.ok && retiredAgain.ok).toBe(true);
      expect(discord.creates).toHaveLength(count);
      expect(discord.deletes).toEqual(oldIds);
      await expect(hasActiveGuideReplacement(snapshotDir, CHANNEL)).resolves.toBe(false);
    });
  });

  it("keeps the normal publisher's duplicate refusal while old and new coexist, and its no-op afterwards", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    discord.seedOldGuide();
    await publishGuideReplacement(context(fixture, discord));
    await expect(hasActiveGuideReplacement(snapshotDir, CHANNEL)).resolves.toBe(true);

    const during = boosterGuidePublisher.plan({
      channelId: CHANNEL,
      botUserId: BOT,
      messages: discord.messages,
      assetRevisions: fixture.adapter.assetRevisions,
    });
    expect(during.errors.join(" ")).toMatch(/Ambiguous state/);

    await retireOldGuideMessages(context(fixture, discord));
    const after = boosterGuidePublisher.plan({
      channelId: CHANNEL,
      botUserId: BOT,
      messages: discord.messages,
      assetRevisions: fixture.adapter.assetRevisions,
    });
    expect(after.errors).toEqual([]);
    expect(after.actions.every((action) => action.type === "unchanged")).toBe(true);
  });

  it("saves the full snapshot and image bytes before the first create", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    discord.seedOldGuide();
    let stateAtFirstCreate: GuideReplaceState | null = null;
    let snapshotAtFirstCreate = "";
    discord.beforeCreate = () => {
      throw new Error("stop here");
    };
    const outcome = await publishGuideReplacement(context(fixture, discord));
    stateAtFirstCreate = await savedState();
    snapshotAtFirstCreate = await readFile(stateAtFirstCreate.snapshotPath, "utf8");

    expect(outcome.ok).toBe(false);
    expect(stateAtFirstCreate.oldMessages).toHaveLength(5);
    expect(JSON.parse(snapshotAtFirstCreate).messages).toHaveLength(5);
    const media = await readdir(resolve(guideReplaceDir(snapshotDir, CHANNEL), `media-${stateAtFirstCreate.runId}`));
    expect(media).toHaveLength(5);
  });

  it("writes nothing when the snapshot fails", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    discord.seedOldGuide();
    const ctx = context(fixture, discord);
    ctx.client = {
      ...ctx.client,
      fetchAsset: async () => {
        throw new Error("cdn down");
      },
    };
    const outcome = await publishGuideReplacement(ctx);
    expect(outcome.ok).toBe(false);
    expect(outcome.errors.join(" ")).toMatch(/Snapshot failed/);
    expect(discord.creates).toEqual([]);
  });

  it("partial create failure: keeps the old guide, deletes nothing, resumes without duplicates", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    const oldIds = discord.seedOldGuide();
    discord.beforeCreate = (key) => {
      if (key === "signing-up") throw new DiscordHttpError(500, "POST", "/x", "boom", null, false);
    };

    const failed = await publishGuideReplacement(context(fixture, discord));
    expect(failed.ok).toBe(false);
    expect(failed.phase).toBe("creating");
    expect(discord.creates).toEqual(["getting-started", "characters"]);
    expect(discord.deletes).toEqual([]);
    expect(oldIds.every((id) => discord.messages.some((m) => m.id === id))).toBe(true);

    const retire = await retireOldGuideMessages(context(fixture, discord));
    expect(retire.ok).toBe(false);
    expect(discord.deletes).toEqual([]);

    discord.beforeCreate = () => {};
    const resumed = await publishGuideReplacement(context(fixture, discord));
    expect(resumed.ok).toBe(true);
    expect(resumed.created).toBe(3);
    expect(discord.creates).toEqual(BOOSTER_GUIDE_CARDS.map((c) => c.key));
  });

  it("adopts a message whose create answer was lost instead of creating it again", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    discord.seedOldGuide();
    discord.afterCreate = (key) => {
      if (key === "characters") throw new Error("connection reset");
    };

    expect((await publishGuideReplacement(context(fixture, discord))).ok).toBe(false);
    const state = await savedState();
    expect(state.pendingCardKey).toBe("characters");
    expect(state.newByCard.characters).toBeUndefined();

    discord.afterCreate = () => {};
    const resumed = await publishGuideReplacement(context(fixture, discord));
    expect(resumed.ok).toBe(true);
    expect(resumed.adopted).toBe(1);
    expect(discord.creates.filter((key) => key === "characters")).toHaveLength(1);
  });

  it("waits once for a short 429 and retries with the same nonce", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    discord.seedOldGuide();
    discord.beforeCreate = (key, attempt) => {
      if (key === "getting-started" && attempt === 1) throw http429(3);
    };
    const outcome = await publishGuideReplacement(context(fixture, discord));
    expect(outcome.ok).toBe(true);
    expect(sleeps).toContain(3500);
    expect(discord.creates.filter((key) => key === "getting-started")).toHaveLength(1);
  });

  it("stops without waiting on a long 429 and records the earliest next try", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    discord.seedOldGuide();
    let calls = 0;
    discord.beforeCreate = () => {
      calls += 1;
      throw http429(3600);
    };
    const ctx = context(fixture, discord);
    ctx.now = () => new Date("2026-11-02T00:00:00.000Z");
    const outcome = await publishGuideReplacement(ctx);
    expect(outcome.ok).toBe(false);
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
    expect(outcome.earliestResumeAt).toBe("2026-11-02T01:00:00.000Z");
  });

  it("stops after a second 429 and never loops", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    discord.seedOldGuide();
    let calls = 0;
    discord.beforeCreate = () => {
      calls += 1;
      throw http429(1);
    };
    expect((await publishGuideReplacement(context(fixture, discord))).ok).toBe(false);
    expect(calls).toBe(2);
  });

  it("stops at once on a global 429", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    discord.seedOldGuide();
    let calls = 0;
    discord.beforeCreate = () => {
      calls += 1;
      throw http429(1, true);
    };
    expect((await publishGuideReplacement(context(fixture, discord))).ok).toBe(false);
    expect(calls).toBe(1);
  });

  it("partial delete failure: stops, names the ids left, resumes with only those", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    const oldIds = discord.seedOldGuide();
    await publishGuideReplacement(context(fixture, discord));
    discord.beforeDelete = (id) => {
      if (id === oldIds[2]) throw new DiscordHttpError(500, "DELETE", "/x", "boom", null, false);
    };

    const failed = await retireOldGuideMessages(context(fixture, discord));
    expect(failed.ok).toBe(false);
    expect(failed.phase).toBe("deleting");
    expect(discord.deletes).toEqual(oldIds.slice(0, 2));
    expect(failed.remainingOldIds).toEqual(oldIds.slice(2));

    discord.beforeDelete = () => {};
    const resumed = await retireOldGuideMessages(context(fixture, discord));
    expect(resumed.ok).toBe(true);
    expect(resumed.phase).toBe("done");
    expect(discord.deletes).toEqual(oldIds);
  });

  it("treats Unknown Message on delete as already gone", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    const oldIds = discord.seedOldGuide();
    await publishGuideReplacement(context(fixture, discord));
    discord.beforeDelete = (id) => {
      if (id === oldIds[0]) {
        discord.messages = discord.messages.filter((m) => m.id !== id);
        throw new DiscordHttpError(404, "DELETE", "/x", '{"code":10008}', null, false);
      }
    };
    expect((await retireOldGuideMessages(context(fixture, discord))).phase).toBe("done");
  });

  it.each([
    ["foreign message", { id: "1500", author: { id: OTHER }, content: "hello", embeds: [] }, /another author/],
    [
      "foreign guide marker",
      {
        id: "1500",
        author: { id: OTHER },
        embeds: [{ footer: { text: "Manawyrm Hub · guide:booster:v2:characters" } }],
      },
      /marker "characters" from another author/,
    ],
    [
      "unknown marker",
      { id: "1500", author: { id: BOT }, embeds: [{ footer: { text: "Manawyrm Hub · guide:booster:v2:mystery" } }] },
      /unknown guide marker "mystery"/,
    ],
    ["unmarked own message", { id: "1500", author: { id: BOT }, content: "note", embeds: [] }, /no guide marker/],
  ] as const)("refuses to start with a %s and writes nothing", async (_name, intruder, pattern) => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    discord.seedOldGuide();
    discord.messages.push(intruder as unknown as GuideReplaceMessage);
    const outcome = await publishGuideReplacement(context(fixture, discord));
    expect(outcome.ok).toBe(false);
    expect(outcome.errors.join(" ")).toMatch(pattern);
    expect(discord.creates).toEqual([]);
    await expect(hasActiveGuideReplacement(snapshotDir, CHANNEL)).resolves.toBe(false);
  });

  it("refuses duplicate markers when no replacement was saved", () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    discord.seedOldGuide();
    discord.messages.push({ ...discord.messages[0]!, id: "1500" });
    const plan = planGuideReplacement(fixture.adapter, BOT, discord.messages);
    expect(plan.errors.join(" ")).toMatch(/appears on 2 messages/);
  });

  it("deletes nothing when a foreign message appeared before phase C, and leaves that message alone", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    discord.seedOldGuide();
    await publishGuideReplacement(context(fixture, discord));
    discord.messages.push({ id: "5000", author: { id: OTHER }, content: "hi", embeds: [] });

    const outcome = await retireOldGuideMessages(context(fixture, discord));
    expect(outcome.ok).toBe(false);
    expect(outcome.errors.join(" ")).toMatch(/Unexpected message 5000/);
    expect(discord.deletes).toEqual([]);
  });

  it("deletes nothing when a saved old message changed its marker", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    const oldIds = discord.seedOldGuide();
    await publishGuideReplacement(context(fixture, discord));
    const target = discord.messages.find((m) => m.id === oldIds[0])!;
    target.embeds = [{ footer: { text: "something else" } }];

    expect((await retireOldGuideMessages(context(fixture, discord))).ok).toBe(false);
    expect(discord.deletes).toEqual([]);
  });

  it("deletes nothing when a new message no longer matches its card", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    discord.seedOldGuide();
    const created = await publishGuideReplacement(context(fixture, discord));
    const target = discord.messages.find((m) => m.id === created.newByCard.characters)!;
    target.embeds![0]!.description = "edited";

    const outcome = await retireOldGuideMessages(context(fixture, discord));
    expect(outcome.ok).toBe(false);
    expect(outcome.errors.join(" ")).toMatch(/does not match card "characters"/);
    expect(discord.deletes).toEqual([]);
  });

  it("stops and does not recreate when a saved new message vanished", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    discord.seedOldGuide();
    discord.beforeCreate = (key) => {
      if (key === "signing-up") throw new Error("stop");
    };
    await publishGuideReplacement(context(fixture, discord));
    const state = await savedState();
    discord.messages = discord.messages.filter((m) => m.id !== state.newByCard["getting-started"]);
    discord.beforeCreate = () => {};

    const outcome = await publishGuideReplacement(context(fixture, discord));
    expect(outcome.ok).toBe(false);
    expect(outcome.errors.join(" ")).toMatch(/is gone/);
    expect(discord.creates).toEqual(["getting-started", "characters"]);
  });

  it("fails verification on a wrong image, a mention or the wrong button", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    discord.seedOldGuide();
    const ctx = context(fixture, discord);
    const realCreate = ctx.client.createCardMessage;
    ctx.client = {
      ...ctx.client,
      createCardMessage: async (input) => {
        const result = await realCreate(input);
        const message = discord.messages.find((m) => m.id === result.id)!;
        if (input.card.key === "characters") message.embeds![0]!.image = { url: "https://cdn.discordapp.com/card/wrong" };
        if (input.card.key === "signing-up") message.mentions = [{ id: "1" }];
        if (input.card.key === "getting-started") message.components = [{ components: [{ label: "x", url: "y" }] }];
        return result;
      },
    };
    const outcome = await publishGuideReplacement(ctx);
    expect(outcome.ok).toBe(false);
    expect(outcome.phase).toBe("creating");
    const text = outcome.errors.join(" ");
    expect(text).toMatch(/wrong image/);
    expect(text).toMatch(/mentions someone/);
    expect(text).toMatch(/wrong link button/);
    expect(discord.deletes).toEqual([]);
  });

  it("fails verification when new messages are out of card order", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    discord.seedOldGuide();
    discord.afterCreate = (key) => {
      if (key === "characters") {
        const message = discord.messages.at(-1)!;
        message.id = "1999";
      }
    };
    const ctx = context(fixture, discord);
    const realCreate = ctx.client.createCardMessage;
    ctx.client = {
      ...ctx.client,
      createCardMessage: async (input) => {
        const result = await realCreate(input);
        return input.card.key === "characters" ? { id: "1999" } : result;
      },
    };
    const outcome = await publishGuideReplacement(ctx);
    expect(outcome.ok).toBe(false);
    expect(outcome.errors.join(" ")).toMatch(/not in card order/);
  });

  it("refuses to continue when guide text changed since the run started", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    discord.seedOldGuide();
    discord.beforeCreate = (key) => {
      if (key === "characters") throw new Error("stop");
    };
    await publishGuideReplacement(context(fixture, discord));
    discord.beforeCreate = () => {};

    const changed = {
      ...fixture,
      adapter: { ...fixture.adapter, render: () => "another text" },
    };
    const outcome = await publishGuideReplacement(context(changed, discord));
    expect(outcome.ok).toBe(false);
    expect(outcome.errors.join(" ")).toMatch(/changed since this replacement started/);
    expect(discord.creates).toEqual(["getting-started"]);
  });

  it("refuses a parallel run through the lock and leaves its lock file alone", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    discord.seedOldGuide();
    await publishGuideReplacement(context(fixture, discord));
    const lock = resolve(guideReplaceDir(snapshotDir, CHANNEL), "lock");
    await writeFile(lock, "1");

    await expect(retireOldGuideMessages(context(fixture, discord))).rejects.toThrow(/Another replace run/);
    expect(discord.deletes).toEqual([]);
    await expect(readFile(lock, "utf8")).resolves.toBe("1");
  });

  it("refuses to retire without a saved replacement and deletes nothing", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    discord.seedOldGuide();
    const outcome = await retireOldGuideMessages(context(fixture, discord));
    expect(outcome.ok).toBe(false);
    expect(discord.deletes).toEqual([]);
  });

  it("refuses invalid cards before any Discord call", async () => {
    const fixture = boosterFixture();
    const discord = new FakeDiscord(fixture);
    discord.seedOldGuide();
    const invalid = { ...fixture, adapter: { ...fixture.adapter, cardErrors: ["bad card"] } };
    const outcome = await publishGuideReplacement(context(invalid, discord));
    expect(outcome.errors).toEqual(["bad card"]);
    expect(discord.creates).toEqual([]);
  });
});

describe("Discord error and asset helpers", () => {
  it("reads Retry-After from the header first, then from the body", () => {
    const headers = (value: string | null) => ({ get: () => value });
    expect(discordHttpErrorFrom(429, "POST", "/x", '{"retry_after":9}', headers("3")).retryAfterSeconds).toBe(3);
    expect(discordHttpErrorFrom(429, "POST", "/x", '{"retry_after":9.5}', headers(null)).retryAfterSeconds).toBe(9.5);
    expect(discordHttpErrorFrom(429, "POST", "/x", "not json", headers(null)).retryAfterSeconds).toBeNull();
    expect(discordHttpErrorFrom(429, "POST", "/x", '{"global":true}', headers("1")).isGlobal).toBe(true);
  });

  it("keeps the existing error text format", () => {
    const error = discordHttpErrorFrom(403, "GET", "/y", "denied", { get: () => null });
    expect(error.message).toBe("Discord 403 GET /y: denied");
  });

  it("reads images only from Discord's CDN over https", async () => {
    await expect(fetchDiscordAsset("https://example.com/a.png")).rejects.toThrow(/Refusing/);
    await expect(fetchDiscordAsset("http://cdn.discordapp.com/a.png")).rejects.toThrow(/Refusing/);
  });
});
