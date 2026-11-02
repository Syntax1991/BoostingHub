/**
 * Idempotent Discord guide publisher, shared by the Booster and Raid Lead guides.
 *
 * Identity: bot-authored messages whose embed footer contains
 * `guide:<kind>:v2:<cardKey>[ · asset:<12hex>]`.
 *
 * Screenshot-only changes bump the `asset:` revision and force an edit.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildGuideComponents,
  hashGuideAssetBytes,
  parseGuideAssetRevision,
  type GuideCard,
  type GuideEmbed,
  type GuideFormat,
} from "@/guides/guide-card";
import { DISCORD_EMBED_TOTAL_CHAR_LIMIT } from "@/discord-bot/embeds/signup-embed";
import { DISCORD_EMBED_FIELD_COUNT_LIMIT, DISCORD_EMBED_FIELD_VALUE_LIMIT } from "@/lib/discord-embed-field-chunking";

export const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_EMBED_TITLE_LIMIT = 256;
const DISCORD_EMBED_DESCRIPTION_LIMIT = 4096;
const DISCORD_EMBED_FOOTER_LIMIT = 2048;

export type DiscordMessageLike = {
  id: string;
  author?: { id?: string; bot?: boolean };
  content?: string;
  embeds?: Array<{
    title?: string | null;
    description?: string | null;
    footer?: { text?: string | null } | null;
    fields?: Array<{ name?: string | null; value?: string | null; inline?: boolean | null }>;
    image?: { url?: string | null } | null;
  }>;
  attachments?: Array<{ id: string; filename: string; url: string }>;
  components?: unknown[];
};

export type GuidePublishPlanAction =
  | { type: "unchanged"; cardKey: string; messageId: string }
  | { type: "update"; cardKey: string; messageId: string }
  | { type: "create"; cardKey: string };

export type GuidePublishPlan = {
  channelId: string;
  actions: GuidePublishPlanAction[];
  errors: string[];
  assetRevisions: Record<string, string | null>;
};

export type GuidePublishResult = {
  unchanged: number;
  updated: number;
  created: number;
  messageIdsByCard: Record<string, string>;
};

export type GuideDiscordClient = {
  listMessages(channelId: string): Promise<DiscordMessageLike[]>;
  createMessage(input: {
    channelId: string;
    embed: GuideEmbed;
    components?: unknown[];
    files: Array<{ name: string; data: Buffer }>;
    /** Replace mode only: makes a repeated create return the first message. */
    nonce?: string;
  }): Promise<{ id: string }>;
  editMessage(input: {
    channelId: string;
    messageId: string;
    embed: GuideEmbed;
    components?: unknown[];
    files: Array<{ name: string; data: Buffer }>;
  }): Promise<{ id: string }>;
  deleteMessage(channelId: string, messageId: string): Promise<void>;
};

export async function resolveGuideAssetRevisions(
  screenshotsDir: string,
  cards: readonly GuideCard[],
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const card of cards) {
    if (!card.imageFile) {
      out[card.key] = null;
      continue;
    }
    const bytes = await readFile(resolve(screenshotsDir, card.imageFile));
    out[card.key] = hashGuideAssetBytes(bytes);
  }
  return out;
}

export async function loadGuideScreenshot(screenshotsDir: string, fileName: string): Promise<Buffer> {
  return readFile(resolve(screenshotsDir, fileName));
}

export function defaultScreenshotsDir(root = process.cwd()): string {
  return resolve(root, "docs/guides/screenshots");
}

export type GuidePublisher = ReturnType<typeof createGuidePublisher>;

export function createGuidePublisher(config: {
  format: GuideFormat;
  cards: readonly GuideCard[];
  /** Guide-specific content rules, on top of the Discord size limits. */
  contentErrors: (cards: readonly GuideCard[]) => string[];
}) {
  const { format, contentErrors } = config;
  const expectedCardCount = config.cards.length;

  function indexMessages(
    messages: DiscordMessageLike[],
    botUserId: string,
  ): {
    byKey: Map<string, DiscordMessageLike[]>;
    foreignBotGuideLike: DiscordMessageLike[];
  } {
    const byKey = new Map<string, DiscordMessageLike[]>();
    const foreignBotGuideLike: DiscordMessageLike[] = [];

    for (const message of messages) {
      const footer = message.embeds?.[0]?.footer?.text ?? "";
      const key = format.parseCardKey(footer);
      if (!key) continue;
      if (botUserId && message.author?.id && message.author.id !== botUserId) {
        foreignBotGuideLike.push(message);
        continue;
      }
      const list = byKey.get(key) ?? [];
      list.push(message);
      byKey.set(key, list);
    }

    return { byKey, foreignBotGuideLike };
  }

  function validateCards(cards: readonly GuideCard[] = config.cards): string[] {
    const errors: string[] = [];
    if (cards.length !== expectedCardCount) {
      errors.push(`Expected exactly ${expectedCardCount} canonical cards, got ${cards.length}`);
    }
    const keys = new Set<string>();
    for (const card of cards) {
      if (keys.has(card.key)) errors.push(`Duplicate card key: ${card.key}`);
      keys.add(card.key);
      const size = format.measureEmbed(card);
      if (size.titleChars > DISCORD_EMBED_TITLE_LIMIT) {
        errors.push(`${card.key}: title exceeds ${DISCORD_EMBED_TITLE_LIMIT}`);
      }
      if (size.descriptionChars > DISCORD_EMBED_DESCRIPTION_LIMIT) {
        errors.push(`${card.key}: description exceeds ${DISCORD_EMBED_DESCRIPTION_LIMIT}`);
      }
      if (size.fieldCount > DISCORD_EMBED_FIELD_COUNT_LIMIT) {
        errors.push(`${card.key}: too many fields`);
      }
      if (size.maxFieldChars > DISCORD_EMBED_FIELD_VALUE_LIMIT) {
        errors.push(`${card.key}: field value exceeds ${DISCORD_EMBED_FIELD_VALUE_LIMIT}`);
      }
      if (size.footerChars > DISCORD_EMBED_FOOTER_LIMIT) {
        errors.push(`${card.key}: footer exceeds ${DISCORD_EMBED_FOOTER_LIMIT}`);
      }
      if (size.totalChars > DISCORD_EMBED_TOTAL_CHAR_LIMIT) {
        errors.push(`${card.key}: embed total exceeds ${DISCORD_EMBED_TOTAL_CHAR_LIMIT}`);
      }
      const footer = format.buildEmbed(card, {
        assetRevision: card.imageFile ? "a".repeat(12) : null,
      }).footer.text;
      if (!footer.includes(`${format.markerPrefix}${card.key}`)) {
        errors.push(`${card.key}: footer marker missing`);
      }
      if (format.parseCardKey(footer) !== card.key) {
        errors.push(`${card.key}: footer key does not round-trip`);
      }
    }
    errors.push(...contentErrors(cards));
    return errors;
  }

  /** Compare rendered embed + asset revision to decide whether an edit is needed. */
  function needsUpdate(existing: DiscordMessageLike, card: GuideCard, assetRevision: string | null): boolean {
    const desired = format.buildEmbed(card, { assetRevision });
    const embed = existing.embeds?.[0];
    if (!embed) return true;
    if ((embed.title ?? "") !== desired.title) return true;
    if ((embed.description ?? "") !== desired.description) return true;
    if ((embed.footer?.text ?? "") !== desired.footer.text) return true;

    const existingFields = embed.fields ?? [];
    const desiredFields = desired.fields ?? [];
    if (JSON.stringify(existingFields) !== JSON.stringify(desiredFields)) return true;

    const existingNames = new Set((existing.attachments ?? []).map((a) => a.filename));
    const hasEmbedImage = Boolean(embed.image?.url);
    if (card.imageFile) {
      // Discord may keep the file only as a CDN embed.image after upload.
      const hasNamedAttachment = existingNames.has(card.imageFile);
      if (!hasNamedAttachment && !hasEmbedImage) return true;
    } else if ((existing.attachments?.length ?? 0) > 0 || hasEmbedImage) {
      // Text-only cards must drop both the attachment and any leftover embed.image.
      return true;
    }

    const existingAsset = parseGuideAssetRevision(embed.footer?.text);
    if ((assetRevision ?? null) !== (existingAsset ?? null)) return true;

    const wantLink = Boolean(card.linkButton);
    const hasComponents = (existing.components?.length ?? 0) > 0;
    if (wantLink !== hasComponents) return true;

    return false;
  }

  function plan(input: {
    channelId: string;
    botUserId: string;
    messages: DiscordMessageLike[];
    cards?: readonly GuideCard[];
    assetRevisions: Record<string, string | null>;
  }): GuidePublishPlan {
    const cards = input.cards ?? config.cards;
    const errors = validateCards(cards);
    const { byKey, foreignBotGuideLike } = indexMessages(input.messages, input.botUserId);

    if (foreignBotGuideLike.length > 0) {
      errors.push(
        `Found ${foreignBotGuideLike.length} guide-marked message(s) from another author — refusing to mutate.`,
      );
    }

    for (const [key, list] of byKey) {
      if (list.length > 1) {
        errors.push(`Ambiguous state: card key "${key}" appears on ${list.length} messages — refusing.`);
      }
      if (!cards.some((c) => c.key === key)) {
        errors.push(`Unknown canonical key "${key}" present in channel — refusing rather than deleting.`);
      }
    }

    const actions: GuidePublishPlanAction[] = [];
    if (errors.length === 0) {
      for (const card of cards) {
        const existing = byKey.get(card.key)?.[0];
        const revision = input.assetRevisions[card.key] ?? null;
        if (!existing) {
          actions.push({ type: "create", cardKey: card.key });
          continue;
        }
        if (needsUpdate(existing, card, revision)) {
          actions.push({ type: "update", cardKey: card.key, messageId: existing.id });
        } else {
          actions.push({ type: "unchanged", cardKey: card.key, messageId: existing.id });
        }
      }
    }

    return {
      channelId: input.channelId,
      actions: errors.length ? [] : actions,
      errors,
      assetRevisions: input.assetRevisions,
    };
  }

  async function execute(input: {
    client: GuideDiscordClient;
    channelId: string;
    plan: GuidePublishPlan;
    screenshotsDir: string;
    cards?: readonly GuideCard[];
    dryRun?: boolean;
  }): Promise<GuidePublishResult> {
    if (input.plan.errors.length > 0) {
      throw new Error(input.plan.errors.join("\n"));
    }
    const cards = input.cards ?? config.cards;
    const messageIdsByCard: Record<string, string> = {};
    let unchanged = 0;
    let updated = 0;
    let created = 0;

    if (input.dryRun) {
      for (const action of input.plan.actions) {
        if (action.type === "unchanged") {
          unchanged += 1;
          messageIdsByCard[action.cardKey] = action.messageId;
        } else if (action.type === "update") {
          updated += 1;
          messageIdsByCard[action.cardKey] = action.messageId;
        } else if (action.type === "create") {
          created += 1;
        }
      }
      return { unchanged, updated, created, messageIdsByCard };
    }

    for (const action of input.plan.actions) {
      const card = cards.find((c) => c.key === action.cardKey);
      if (!card) throw new Error(`Missing card ${action.cardKey}`);
      const assetRevision = input.plan.assetRevisions[card.key] ?? null;
      const embed = format.buildEmbed(card, { assetRevision });
      const components = buildGuideComponents(card);
      const files = card.imageFile
        ? [{ name: card.imageFile, data: await loadGuideScreenshot(input.screenshotsDir, card.imageFile) }]
        : [];

      if (action.type === "unchanged") {
        unchanged += 1;
        messageIdsByCard[action.cardKey] = action.messageId;
        continue;
      }
      if (action.type === "update") {
        const result = await input.client.editMessage({
          channelId: input.channelId,
          messageId: action.messageId,
          embed,
          components,
          files,
        });
        updated += 1;
        messageIdsByCard[action.cardKey] = result.id;
        continue;
      }
      if (action.type === "create") {
        const result = await input.client.createMessage({
          channelId: input.channelId,
          embed,
          components,
          files,
        });
        created += 1;
        messageIdsByCard[action.cardKey] = result.id;
      }
    }

    return { unchanged, updated, created, messageIdsByCard };
  }

  return { format, cards: config.cards, validateCards, indexMessages, needsUpdate, plan, execute };
}
