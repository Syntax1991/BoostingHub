/**
 * Idempotent Booster Guide publisher (Discord).
 *
 * Identity: bot-authored messages whose embed footer contains
 * `guide:booster:v2:<cardKey>`. Updates edit in place; missing cards are
 * created; duplicate keys or ambiguous legacy mixes refuse instead of deleting.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  BOOSTER_GUIDE_CARDS,
  BOOSTER_GUIDE_MARKER_PREFIX,
  buildBoosterGuideComponents,
  buildBoosterGuideEmbed,
  measureBoosterGuideEmbed,
  parseBoosterGuideCardKey,
  type BoosterGuideCard,
} from "@/guides/booster-guide";
import { DISCORD_EMBED_TOTAL_CHAR_LIMIT } from "@/discord-bot/embeds/signup-embed";
import { DISCORD_EMBED_FIELD_COUNT_LIMIT, DISCORD_EMBED_FIELD_VALUE_LIMIT } from "@/lib/discord-embed-field-chunking";

export const DISCORD_API = "https://discord.com/api/v10";
export const DISCORD_MESSAGE_CONTENT_LIMIT = 2000;
export const DISCORD_EMBED_TITLE_LIMIT = 256;
export const DISCORD_EMBED_DESCRIPTION_LIMIT = 4096;
export const DISCORD_EMBED_FOOTER_LIMIT = 2048;

export type DiscordMessageLike = {
  id: string;
  author?: { id?: string; bot?: boolean };
  content?: string;
  embeds?: Array<{
    title?: string | null;
    description?: string | null;
    footer?: { text?: string | null } | null;
  }>;
  attachments?: Array<{ id: string; filename: string; url: string }>;
  components?: unknown[];
};

export type GuidePublishPlanAction =
  | { type: "unchanged"; cardKey: string; messageId: string }
  | { type: "update"; cardKey: string; messageId: string }
  | { type: "create"; cardKey: string }
  | { type: "retire-legacy"; messageId: string; reason: string };

export type GuidePublishPlan = {
  channelId: string;
  actions: GuidePublishPlanAction[];
  legacyMessageIds: string[];
  errors: string[];
};

export type GuidePublishResult = {
  unchanged: number;
  updated: number;
  created: number;
  retiredLegacy: number;
  messageIdsByCard: Record<string, string>;
};

export type GuideDiscordClient = {
  listMessages(channelId: string): Promise<DiscordMessageLike[]>;
  createMessage(input: {
    channelId: string;
    embed: ReturnType<typeof buildBoosterGuideEmbed>;
    components?: unknown[];
    files: Array<{ name: string; data: Buffer }>;
  }): Promise<{ id: string }>;
  editMessage(input: {
    channelId: string;
    messageId: string;
    embed: ReturnType<typeof buildBoosterGuideEmbed>;
    components?: unknown[];
    files: Array<{ name: string; data: Buffer }>;
  }): Promise<{ id: string }>;
  deleteMessage(channelId: string, messageId: string): Promise<void>;
};

/** Heuristic: old append-only booster guide posts (no v2 footer marker). */
export function isLegacyBoosterGuideMessage(message: DiscordMessageLike, botUserId: string): boolean {
  if (botUserId) {
    if (message.author?.id !== botUserId) return false;
  } else if (!message.author?.bot) {
    return false;
  }

  const footer = message.embeds?.[0]?.footer?.text ?? "";
  if (parseBoosterGuideCardKey(footer)) return false;

  const content = message.content ?? "";
  const title = message.embeds?.[0]?.title ?? "";
  const blob = `${content}\n${title}\n${message.embeds?.[0]?.description ?? ""}`;
  return (
    /Booster Guide/i.test(blob) ||
    /Anleitung für Booster/i.test(blob) ||
    /Sign up for a run/i.test(blob) ||
    /Signing up via the Discord bot/i.test(blob) ||
    /📘/.test(blob)
  );
}

export function indexCanonicalGuideMessages(
  messages: DiscordMessageLike[],
  botUserId: string,
): {
  byKey: Map<string, DiscordMessageLike[]>;
  legacy: DiscordMessageLike[];
  foreignBotGuideLike: DiscordMessageLike[];
} {
  const byKey = new Map<string, DiscordMessageLike[]>();
  const legacy: DiscordMessageLike[] = [];
  const foreignBotGuideLike: DiscordMessageLike[] = [];

  for (const message of messages) {
    const footer = message.embeds?.[0]?.footer?.text ?? "";
    const key = parseBoosterGuideCardKey(footer);
    if (key) {
      if (botUserId && message.author?.id && message.author.id !== botUserId) {
        foreignBotGuideLike.push(message);
        continue;
      }
      const list = byKey.get(key) ?? [];
      list.push(message);
      byKey.set(key, list);
      continue;
    }
    if (isLegacyBoosterGuideMessage(message, botUserId)) {
      legacy.push(message);
    }
  }

  return { byKey, legacy, foreignBotGuideLike };
}

export function validateBoosterGuideCards(cards: readonly BoosterGuideCard[] = BOOSTER_GUIDE_CARDS): string[] {
  const errors: string[] = [];
  if (cards.length !== 5) {
    errors.push(`Expected exactly 5 canonical cards, got ${cards.length}`);
  }
  const keys = new Set<string>();
  for (const card of cards) {
    if (keys.has(card.key)) errors.push(`Duplicate card key: ${card.key}`);
    keys.add(card.key);
    const size = measureBoosterGuideEmbed(card);
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
    if (!footerContainsMarker(card)) {
      errors.push(`${card.key}: footer marker missing`);
    }
  }

  const discordCard = cards.find((c) => c.key === "discord-signups");
  if (discordCard && !/Quick Signup/i.test(JSON.stringify(discordCard))) {
    errors.push("discord-signups card must mention Quick Signup");
  }
  const webCard = cards.find((c) => c.key === "signing-up");
  if (webCard && /Web Quick Signup|website Quick Signup button/i.test(JSON.stringify(webCard))) {
    errors.push("signing-up must not claim a Web Quick Signup button");
  }

  return errors;
}

function footerContainsMarker(card: BoosterGuideCard): boolean {
  return buildBoosterGuideEmbed(card).footer.text.includes(`${BOOSTER_GUIDE_MARKER_PREFIX}${card.key}`);
}

/** Compare rendered embed + attachment names to decide whether an edit is needed. */
export function guideMessageNeedsUpdate(
  existing: DiscordMessageLike,
  card: BoosterGuideCard,
): boolean {
  const desired = buildBoosterGuideEmbed(card);
  const embed = existing.embeds?.[0];
  if (!embed) return true;
  if ((embed.title ?? "") !== desired.title) return true;
  if ((embed.description ?? "") !== desired.description) return true;
  if ((embed.footer?.text ?? "") !== desired.footer.text) return true;

  const existingFields = (existing.embeds?.[0] as { fields?: GuideEmbedField[] } | undefined)?.fields ?? [];
  const desiredFields = desired.fields ?? [];
  if (JSON.stringify(existingFields) !== JSON.stringify(desiredFields)) return true;

  const existingNames = new Set((existing.attachments ?? []).map((a) => a.filename));
  if (card.imageFile && !existingNames.has(card.imageFile)) return true;
  if (!card.imageFile && (existing.attachments?.length ?? 0) > 0) return true;

  const wantLink = Boolean(card.linkButton);
  const hasComponents = (existing.components?.length ?? 0) > 0;
  if (wantLink !== hasComponents) return true;

  return false;
}

type GuideEmbedField = { name: string; value: string; inline?: boolean };

export function planBoosterGuidePublish(input: {
  channelId: string;
  botUserId: string;
  messages: DiscordMessageLike[];
  cards?: readonly BoosterGuideCard[];
  /** When true, schedule retirement of positively identified legacy guide messages. */
  retireLegacy?: boolean;
}): GuidePublishPlan {
  const cards = input.cards ?? BOOSTER_GUIDE_CARDS;
  const errors = validateBoosterGuideCards(cards);
  const { byKey, legacy, foreignBotGuideLike } = indexCanonicalGuideMessages(input.messages, input.botUserId);

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
      if (!existing) {
        actions.push({ type: "create", cardKey: card.key });
        continue;
      }
      if (guideMessageNeedsUpdate(existing, card)) {
        actions.push({ type: "update", cardKey: card.key, messageId: existing.id });
      } else {
        actions.push({ type: "unchanged", cardKey: card.key, messageId: existing.id });
      }
    }

    if (input.retireLegacy) {
      // Only retire after every canonical card is present (create/update in this same plan).
      const missingCreates = actions.filter((a) => a.type === "create").length;
      if (missingCreates > 0 && byKey.size + (5 - missingCreates) < 5) {
        // Still fine: creates run before deletes in executeBoosterGuidePublish.
      }
      for (const message of legacy) {
        actions.push({
          type: "retire-legacy",
          messageId: message.id,
          reason: "legacy booster guide without v2 marker",
        });
      }
    }
  }

  return {
    channelId: input.channelId,
    actions: errors.length ? [] : actions,
    legacyMessageIds: legacy.map((m) => m.id),
    errors,
  };
}

export async function loadGuideScreenshot(
  screenshotsDir: string,
  fileName: string,
): Promise<Buffer> {
  return readFile(resolve(screenshotsDir, fileName));
}

export async function executeBoosterGuidePublish(input: {
  client: GuideDiscordClient;
  channelId: string;
  plan: GuidePublishPlan;
  screenshotsDir: string;
  cards?: readonly BoosterGuideCard[];
  /** dry-run: plan only, no Discord calls */
  dryRun?: boolean;
}): Promise<GuidePublishResult> {
  if (input.plan.errors.length > 0) {
    throw new Error(input.plan.errors.join("\n"));
  }
  const cards = input.cards ?? BOOSTER_GUIDE_CARDS;
  const messageIdsByCard: Record<string, string> = {};
  let unchanged = 0;
  let updated = 0;
  let created = 0;
  let retiredLegacy = 0;

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
      } else if (action.type === "retire-legacy") {
        retiredLegacy += 1;
      }
    }
    return { unchanged, updated, created, retiredLegacy, messageIdsByCard };
  }

  // Creates + updates first so retirement never leaves the channel empty mid-flight.
  for (const action of input.plan.actions) {
    if (action.type === "retire-legacy") continue;
    const card = cards.find((c) => c.key === action.cardKey);
    if (!card) throw new Error(`Missing card ${action.cardKey}`);

    const embed = buildBoosterGuideEmbed(card);
    const components = buildBoosterGuideComponents(card);
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

  for (const action of input.plan.actions) {
    if (action.type !== "retire-legacy") continue;
    await input.client.deleteMessage(input.channelId, action.messageId);
    retiredLegacy += 1;
  }

  return { unchanged, updated, created, retiredLegacy, messageIdsByCard };
}

export function defaultScreenshotsDir(root = process.cwd()): string {
  return resolve(root, "docs/guides/screenshots");
}
