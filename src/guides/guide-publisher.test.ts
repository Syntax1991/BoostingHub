import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { boosterGuidePublisher } from "@/guides/booster-guide";
import { hashGuideAssetBytes, parseGuideAssetRevision } from "@/guides/guide-card";
import type { DiscordMessageLike, GuideDiscordClient, GuidePublisher } from "@/guides/guide-publisher";
import { raidleadGuidePublisher } from "@/guides/raidlead-guide";
import { APP_BRAND_NAME } from "@/lib/branding";

const BOT = "bot-1";

describe("hashGuideAssetBytes", () => {
  it("hashes screenshot bytes stably", () => {
    const a = hashGuideAssetBytes(Buffer.from("png-bytes-a"));
    expect(a).toBe(hashGuideAssetBytes(Buffer.from("png-bytes-a")));
    expect(a).not.toBe(hashGuideAssetBytes(Buffer.from("png-bytes-b")));
    expect(a).toHaveLength(12);
    expect(createHash("sha256").update("png-bytes-a").digest("hex").startsWith(a)).toBe(true);
  });
});

describe.each<[string, GuidePublisher]>([
  ["booster", boosterGuidePublisher],
  ["raidlead", raidleadGuidePublisher],
])("%s guide publisher", (_kind, publisher) => {
  const { cards, format } = publisher;
  const first = cards.find((c) => c.imageFile)!;
  const assetRevisions = Object.fromEntries(
    cards.map((card) => [card.key, card.imageFile ? "aaaaaaaaaaaa" : null]),
  ) as Record<string, string | null>;

  function marked(cardKey: string, id: string, assetRevision: string | null): DiscordMessageLike {
    const card = cards.find((c) => c.key === cardKey)!;
    const embed = format.buildEmbed(card, { assetRevision });
    return {
      id,
      author: { id: BOT, bot: true },
      content: "",
      embeds: [{ title: embed.title, description: embed.description, footer: { text: embed.footer.text }, fields: embed.fields, image: embed.image }],
      attachments: card.imageFile ? [{ id: "a1", filename: card.imageFile, url: "https://cdn.example/x.png" }] : [],
      components: card.linkButton ? [{ type: 1 }] : [],
    };
  }
  const currentGuide = () => cards.map((card, i) => marked(card.key, `m${i}`, assetRevisions[card.key] ?? null));
  const planFor = (messages: DiscordMessageLike[], revisions = assetRevisions) =>
    publisher.plan({ channelId: "ch", botUserId: BOT, messages, assetRevisions: revisions });

  function fakeClient(): GuideDiscordClient {
    return {
      listMessages: vi.fn(async () => []),
      createMessage: vi.fn(async () => ({ id: "created" })),
      editMessage: vi.fn(async ({ messageId }) => ({ id: messageId })),
      deleteMessage: vi.fn(),
    };
  }

  it("keeps every card within the Discord limits and the guide's content rules", () => {
    expect(publisher.validateCards()).toEqual([]);
    expect(publisher.validateCards(cards.slice(1)).join(" ")).toMatch(/Expected exactly/);
    expect(publisher.validateCards([...cards, cards[0]!]).join(" ")).toMatch(/Duplicate card key/);
    expect(publisher.validateCards([{ ...first, title: "x".repeat(257) }, ...cards.slice(1)]).join(" ")).toMatch(/title exceeds/);
  });

  it("parses the card key without treating the asset revision as part of it", () => {
    const footer = format.buildEmbed(first, { assetRevision: "deadbeefcafe" }).footer.text;
    expect(footer).toBe(`${APP_BRAND_NAME} · ${format.markerPrefix}${first.key} · asset:deadbeefcafe`);
    expect(format.parseCardKey(footer)).toBe(first.key);
    expect(parseGuideAssetRevision(footer)).toBe("deadbeefcafe");
  });

  it("decides updates by asset revision and converges once it is written", () => {
    const existing = marked(first.key, "m1", "aaaaaaaaaaaa");
    expect(publisher.needsUpdate(existing, first, "aaaaaaaaaaaa")).toBe(false);
    expect(publisher.needsUpdate(existing, first, "bbbbbbbbbbbb")).toBe(true);

    const updated = marked(first.key, "m1", "bbbbbbbbbbbb");
    const others = currentGuide().filter((m) => format.parseCardKey(m.embeds![0]!.footer!.text) !== first.key);
    const plan = planFor([updated, ...others], { ...assetRevisions, [first.key]: "bbbbbbbbbbbb" });
    expect(plan.actions).toHaveLength(cards.length);
    expect(plan.actions.every((a) => a.type === "unchanged")).toBe(true);
  });

  it("treats a CDN embed image without attachments as present for screenshot cards", () => {
    const existing = marked(first.key, "m-cdn", "aaaaaaaaaaaa");
    existing.attachments = [];
    existing.embeds![0]!.image = { url: "https://cdn.discordapp.com/attachments/1/2/shot.png" };
    expect(publisher.needsUpdate(existing, first, "aaaaaaaaaaaa")).toBe(false);
  });

  it("performs no Discord mutation on a dry run", async () => {
    const client = fakeClient();
    const result = await publisher.execute({ client, channelId: "ch", plan: planFor([]), screenshotsDir: ".", dryRun: true });
    expect(result.created).toBe(cards.length);
    expect(client.createMessage).not.toHaveBeenCalled();
    expect(client.editMessage).not.toHaveBeenCalled();
    expect(client.deleteMessage).not.toHaveBeenCalled();
  });

  it("edits a changed card in place, keeps the rest and deletes nothing", async () => {
    const client = fakeClient();
    const noImages = cards.map((c) => ({ ...c, imageFile: null }));
    const revisions = Object.fromEntries(noImages.map((c) => [c.key, null]));
    const messages = noImages.map((card, i) => {
      const embed = format.buildEmbed(card, { assetRevision: null });
      return {
        id: `m${i}`,
        author: { id: BOT, bot: true },
        content: "",
        embeds: [{ title: i === 0 ? "old title" : embed.title, description: embed.description, footer: embed.footer, fields: embed.fields }],
        attachments: [],
        components: card.linkButton ? [{ type: 1 }] : [],
      };
    });
    const plan = publisher.plan({ channelId: "ch", botUserId: BOT, messages, assetRevisions: revisions, cards: noImages });
    expect(plan.errors).toEqual([]);

    const result = await publisher.execute({ client, channelId: "ch", plan, screenshotsDir: ".", cards: noImages });

    expect(result).toMatchObject({ created: 0, updated: 1, unchanged: cards.length - 1 });
    expect(client.editMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(client.editMessage).mock.calls[0]![0].messageId).toBe("m0");
    expect(client.createMessage).not.toHaveBeenCalled();
    expect(client.deleteMessage).not.toHaveBeenCalled();
  });

  it("refuses to execute a plan with errors", async () => {
    const client = fakeClient();
    const plan = { channelId: "ch", actions: [], errors: ["bad state"], assetRevisions };
    await expect(publisher.execute({ client, channelId: "ch", plan, screenshotsDir: "." })).rejects.toThrow("bad state");
    expect(client.createMessage).not.toHaveBeenCalled();
  });

  it("plans a create for a missing card", () => {
    const plan = planFor(currentGuide().slice(1));
    expect(plan.errors).toEqual([]);
    expect(plan.actions.find((a) => a.cardKey === cards[0]!.key)).toEqual({ type: "create", cardKey: cards[0]!.key });
  });

  it("refuses duplicate cards", () => {
    const plan = planFor([...currentGuide(), marked(cards[0]!.key, "copy", assetRevisions[cards[0]!.key] ?? null)]);
    expect(plan.errors.join(" ")).toMatch(/Ambiguous/);
    expect(plan.actions).toEqual([]);
  });

  it("refuses a card key it does not know", () => {
    const stray = marked(first.key, "stray", "aaaaaaaaaaaa");
    stray.embeds![0]!.footer = { text: `${format.markerPrefix}some-random-old-key` };
    const plan = planFor([...currentGuide(), stray]);
    expect(plan.errors.join(" ")).toMatch(/Unknown canonical key "some-random-old-key"/);
    expect(plan.actions).toEqual([]);
  });

  it("refuses guide-marked messages from another author", () => {
    const foreign = marked(first.key, "foreign", "aaaaaaaaaaaa");
    foreign.author = { id: "someone-else", bot: true };
    const plan = planFor([...currentGuide(), foreign]);
    expect(plan.errors.join(" ")).toMatch(/from another author/);
    expect(plan.actions).toEqual([]);
  });

  it("ignores unmarked messages in the channel", () => {
    const unmarked: DiscordMessageLike = { id: "x1", author: { id: BOT, bot: true }, content: "### Old post" };
    const plan = planFor([...currentGuide(), unmarked]);
    expect(plan.errors).toEqual([]);
    expect(plan.actions.every((a) => a.type === "unchanged")).toBe(true);
  });
});
