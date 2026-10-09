/**
 * Idempotent Raid Lead Guide publisher (Discord).
 *
 * Identity: bot-authored messages whose embed footer contains
 * `guide:raidlead:v2:<cardKey>[ · asset:<12hex>]`.
 *
 * Screenshot-only changes bump the `asset:` revision and force an edit.
 * Legacy retirement requires a complete known six-message set and a
 * post-upsert verification of all six canonical cards.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  RAIDLEAD_GUIDE_CARDS,
  RAIDLEAD_GUIDE_MARKER_PREFIX,
  buildRaidleadGuideComponents,
  buildRaidleadGuideEmbed,
  hashGuideAssetBytes,
  measureRaidleadGuideEmbed,
  parseRaidleadGuideAssetRevision,
  parseRaidleadGuideCardKey,
  type RaidleadGuideCard,
} from "@/guides/raidlead-guide";
import { DISCORD_EMBED_TOTAL_CHAR_LIMIT } from "@/discord-bot/embeds/signup-embed";
import { DISCORD_EMBED_FIELD_COUNT_LIMIT, DISCORD_EMBED_FIELD_VALUE_LIMIT } from "@/lib/discord-embed-field-chunking";

export const DISCORD_API = "https://discord.com/api/v10";
export const DISCORD_EMBED_TITLE_LIMIT = 256;
export const DISCORD_EMBED_DESCRIPTION_LIMIT = 4096;
export const DISCORD_EMBED_FOOTER_LIMIT = 2048;
export const EXPECTED_LEGACY_RAIDLEAD_GUIDE_COUNT = 6;
export const DEFAULT_GUIDE_SNAPSHOT_DIR = "tmp-raidlead-guide-snapshots";

export type LegacyRaidleadGuideSlot = 1 | 2 | 3 | 4 | 5 | 6;

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
  legacyMessageIds: string[];
  legacyComplete: boolean;
  legacyErrors: string[];
  errors: string[];
  assetRevisions: Record<string, string | null>;
};

export type GuidePublishResult = {
  unchanged: number;
  updated: number;
  created: number;
  retiredLegacy: number;
  messageIdsByCard: Record<string, string>;
  retirementSkippedReason?: string;
};

export type GuideDiscordClient = {
  listMessages(channelId: string): Promise<DiscordMessageLike[]>;
  createMessage(input: {
    channelId: string;
    embed: ReturnType<typeof buildRaidleadGuideEmbed>;
    components?: unknown[];
    files: Array<{ name: string; data: Buffer }>;
  }): Promise<{ id: string }>;
  editMessage(input: {
    channelId: string;
    messageId: string;
    embed: ReturnType<typeof buildRaidleadGuideEmbed>;
    components?: unknown[];
    files: Array<{ name: string; data: Buffer }>;
  }): Promise<{ id: string }>;
  deleteMessage(channelId: string, messageId: string): Promise<void>;
};

/** Known previous append-only Raid Lead Guide (six raw Markdown messages). */
export type LegacyRaidleadGuideFingerprint = {
  slot: LegacyRaidleadGuideSlot;
  /** Normalized heading that opens the old message body. */
  heading: RegExp;
  /** Expected attachment filenames when the old post had screenshots. Empty = none required. */
  expectedAttachments: readonly string[];
};

export const LEGACY_RAIDLEAD_GUIDE_FINGERPRINTS: readonly LegacyRaidleadGuideFingerprint[] = [
  {
    slot: 1,
    heading: /^##\s*📗\s*Raid Lead Guide\b/m,
    expectedAttachments: ["common-01-login.png", "rl-01-dashboard.png"],
  },
  {
    slot: 2,
    heading: /^###\s*3\.\s*Create a run\b/m,
    expectedAttachments: ["rl-04-create-run.png", "rl-03-manage-runs.png"],
  },
  {
    slot: 3,
    heading: /^###\s*5\.\s*Open the run and control signups\b/m,
    expectedAttachments: ["rl-06-run-overview.png", "rl-02-runs.png"],
  },
  {
    slot: 4,
    heading: /^###\s*6\.\s*Build and publish the roster\b/m,
    expectedAttachments: ["rl-05-roster.png"],
  },
  {
    slot: 5,
    heading: /^###\s*7\.\s*Start the run\b/m,
    expectedAttachments: ["rl-08-start-run.png", "rl-07-attendance.png"],
  },
  {
    slot: 6,
    heading: /^###\s*9\.\s*Payout \(short\)/m,
    expectedAttachments: [],
  },
];

function isOurBotMessage(message: DiscordMessageLike, botUserId: string): boolean {
  if (botUserId) return message.author?.id === botUserId;
  return Boolean(message.author?.bot);
}

function attachmentNames(message: DiscordMessageLike): Set<string> {
  return new Set((message.attachments ?? []).map((a) => a.filename));
}

function attachmentsMatchExpected(message: DiscordMessageLike, expected: readonly string[]): boolean {
  if (expected.length === 0) return true;
  const names = attachmentNames(message);
  return expected.every((name) => names.has(name));
}

/** Match one known old guide slot. Never matches v2 footers or non-bot authors. */
export function matchLegacyRaidleadGuideFingerprint(
  message: DiscordMessageLike,
  fingerprint: LegacyRaidleadGuideFingerprint,
  botUserId: string,
): boolean {
  if (!isOurBotMessage(message, botUserId)) return false;
  const footer = message.embeds?.[0]?.footer?.text ?? "";
  if (parseRaidleadGuideCardKey(footer)) return false;
  const content = message.content ?? "";
  if (!fingerprint.heading.test(content)) return false;
  return attachmentsMatchExpected(message, fingerprint.expectedAttachments);
}

export type KnownLegacyGuideSet = {
  complete: boolean;
  messageIds: string[];
  bySlot: Partial<Record<LegacyRaidleadGuideSlot, string>>;
  errors: string[];
};

/**
 * Deterministically identify the previous six-message Raid Lead Guide.
 * Incomplete or duplicated slots → incomplete (retirement must refuse).
 */
export function identifyKnownLegacyRaidleadGuideSet(
  messages: DiscordMessageLike[],
  botUserId: string,
): KnownLegacyGuideSet {
  const bySlot: Partial<Record<LegacyRaidleadGuideSlot, string[]>> = {};
  for (const fingerprint of LEGACY_RAIDLEAD_GUIDE_FINGERPRINTS) {
    const hits = messages.filter((m) => matchLegacyRaidleadGuideFingerprint(m, fingerprint, botUserId));
    if (hits.length > 0) bySlot[fingerprint.slot] = hits.map((h) => h.id);
  }

  const errors: string[] = [];
  const singleBySlot: Partial<Record<LegacyRaidleadGuideSlot, string>> = {};
  for (const fingerprint of LEGACY_RAIDLEAD_GUIDE_FINGERPRINTS) {
    const ids = bySlot[fingerprint.slot] ?? [];
    if (ids.length === 0) {
      errors.push(`Legacy slot ${fingerprint.slot} missing (heading ${fingerprint.heading}).`);
    } else if (ids.length > 1) {
      errors.push(`Legacy slot ${fingerprint.slot} matched ${ids.length} messages — ambiguous.`);
    } else {
      singleBySlot[fingerprint.slot] = ids[0];
    }
  }

  const messageIds = LEGACY_RAIDLEAD_GUIDE_FINGERPRINTS.map((f) => singleBySlot[f.slot]).filter(
    (id): id is string => Boolean(id),
  );
  const complete =
    errors.length === 0 && messageIds.length === EXPECTED_LEGACY_RAIDLEAD_GUIDE_COUNT;

  return { complete, messageIds, bySlot: singleBySlot, errors };
}

/** @deprecated Prefer identifyKnownLegacyRaidleadGuideSet — kept for narrow unit checks. */
export function isLegacyRaidleadGuideMessage(message: DiscordMessageLike, botUserId: string): boolean {
  return LEGACY_RAIDLEAD_GUIDE_FINGERPRINTS.some((fp) =>
    matchLegacyRaidleadGuideFingerprint(message, fp, botUserId),
  );
}

export function indexCanonicalGuideMessages(
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
    const key = parseRaidleadGuideCardKey(footer);
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

export function validateRaidleadGuideCards(cards: readonly RaidleadGuideCard[] = RAIDLEAD_GUIDE_CARDS): string[] {
  const errors: string[] = [];
  if (cards.length !== 6) {
    errors.push(`Expected exactly 6 canonical cards, got ${cards.length}`);
  }
  const keys = new Set<string>();
  for (const card of cards) {
    if (keys.has(card.key)) errors.push(`Duplicate card key: ${card.key}`);
    keys.add(card.key);
    const size = measureRaidleadGuideEmbed(card);
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
    const footer = buildRaidleadGuideEmbed(card, {
      assetRevision: card.imageFile ? "a".repeat(12) : null,
    }).footer.text;
    if (!footer.includes(`${RAIDLEAD_GUIDE_MARKER_PREFIX}${card.key}`)) {
      errors.push(`${card.key}: footer marker missing`);
    }
    if (parseRaidleadGuideCardKey(footer) !== card.key) {
      errors.push(`${card.key}: footer key does not round-trip`);
    }
  }

  const createCard = cards.find((c) => c.key === "create-run");
  if (createCard && !/Community/i.test(JSON.stringify(createCard))) {
    errors.push("create-run card must document Community run type");
  }
  const rosterCard = cards.find((c) => c.key === "build-roster");
  if (rosterCard && !/Publish Roster/i.test(JSON.stringify(rosterCard))) {
    errors.push("build-roster card must mention Publish Roster");
  }
  // BoostingHub has no financial workflow: no card may describe payouts or settlements.
  if (cards.some((c) => /payout|settlement|mark paid/i.test(JSON.stringify(c)))) {
    errors.push("guide cards must not describe payouts or settlements");
  }

  return errors;
}

export async function resolveGuideAssetRevisions(
  screenshotsDir: string,
  cards: readonly RaidleadGuideCard[] = RAIDLEAD_GUIDE_CARDS,
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

/** Compare rendered embed + asset revision to decide whether an edit is needed. */
export function guideMessageNeedsUpdate(
  existing: DiscordMessageLike,
  card: RaidleadGuideCard,
  assetRevision: string | null,
): boolean {
  const desired = buildRaidleadGuideEmbed(card, { assetRevision });
  const embed = existing.embeds?.[0];
  if (!embed) return true;
  if ((embed.title ?? "") !== desired.title) return true;
  if ((embed.description ?? "") !== desired.description) return true;
  if ((embed.footer?.text ?? "") !== desired.footer.text) return true;

  const existingFields = embed.fields ?? [];
  const desiredFields = desired.fields ?? [];
  if (JSON.stringify(existingFields) !== JSON.stringify(desiredFields)) return true;

  const existingNames = attachmentNames(existing);
  const hasEmbedImage = Boolean(embed.image?.url);
  if (card.imageFile) {
    // Discord may keep the file only as a CDN embed.image after upload.
    const hasNamedAttachment = existingNames.has(card.imageFile);
    if (!hasNamedAttachment && !hasEmbedImage) return true;
  } else if ((existing.attachments?.length ?? 0) > 0 || hasEmbedImage) {
    // Text-only cards must drop both the attachment and any leftover embed.image.
    return true;
  }

  const existingAsset = parseRaidleadGuideAssetRevision(embed.footer?.text);
  if ((assetRevision ?? null) !== (existingAsset ?? null)) return true;

  const wantLink = Boolean(card.linkButton);
  const hasComponents = (existing.components?.length ?? 0) > 0;
  if (wantLink !== hasComponents) return true;

  return false;
}

export function verifyCanonicalRaidleadGuideState(input: {
  messages: DiscordMessageLike[];
  botUserId: string;
  cards?: readonly RaidleadGuideCard[];
  assetRevisions: Record<string, string | null>;
}): { ok: boolean; errors: string[]; byKey: Map<string, DiscordMessageLike> } {
  const cards = input.cards ?? RAIDLEAD_GUIDE_CARDS;
  const { byKey, foreignBotGuideLike } = indexCanonicalGuideMessages(input.messages, input.botUserId);
  const errors: string[] = [];
  if (foreignBotGuideLike.length > 0) {
    errors.push(`Found ${foreignBotGuideLike.length} foreign guide-marked message(s).`);
  }
  const singles = new Map<string, DiscordMessageLike>();
  for (const card of cards) {
    const list = byKey.get(card.key) ?? [];
    if (list.length !== 1) {
      errors.push(`Canonical card "${card.key}" expected exactly 1 message, found ${list.length}.`);
      continue;
    }
    const message = list[0]!;
    if (!isOurBotMessage(message, input.botUserId)) {
      errors.push(`Canonical card "${card.key}" is not bot-authored.`);
      continue;
    }
    if (guideMessageNeedsUpdate(message, card, input.assetRevisions[card.key] ?? null)) {
      errors.push(`Canonical card "${card.key}" does not match desired content/asset revision.`);
      continue;
    }
    singles.set(card.key, message);
  }
  return { ok: errors.length === 0, errors, byKey: singles };
}

export function planRaidleadGuidePublish(input: {
  channelId: string;
  botUserId: string;
  messages: DiscordMessageLike[];
  cards?: readonly RaidleadGuideCard[];
  assetRevisions: Record<string, string | null>;
  /** When true, validate that a complete known legacy set exists (retirement planned separately after verify). */
  retireLegacy?: boolean;
}): GuidePublishPlan {
  const cards = input.cards ?? RAIDLEAD_GUIDE_CARDS;
  const errors = validateRaidleadGuideCards(cards);
  const { byKey, foreignBotGuideLike } = indexCanonicalGuideMessages(input.messages, input.botUserId);
  const legacySet = identifyKnownLegacyRaidleadGuideSet(input.messages, input.botUserId);

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

  const legacyErrors = [...legacySet.errors];
  if (input.retireLegacy && !legacySet.complete) {
    errors.push(
      `Cannot --retire-legacy: known legacy Raid Lead Guide set is incomplete/ambiguous (${legacySet.messageIds.length}/${EXPECTED_LEGACY_RAIDLEAD_GUIDE_COUNT}). ${legacyErrors.join(" ")}`,
    );
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
      if (guideMessageNeedsUpdate(existing, card, revision)) {
        actions.push({ type: "update", cardKey: card.key, messageId: existing.id });
      } else {
        actions.push({ type: "unchanged", cardKey: card.key, messageId: existing.id });
      }
    }
  }

  return {
    channelId: input.channelId,
    actions: errors.length ? [] : actions,
    legacyMessageIds: legacySet.messageIds,
    legacyComplete: legacySet.complete,
    legacyErrors,
    errors,
    assetRevisions: input.assetRevisions,
  };
}

export async function loadGuideScreenshot(screenshotsDir: string, fileName: string): Promise<Buffer> {
  return readFile(resolve(screenshotsDir, fileName));
}

export async function executeRaidleadGuidePublish(input: {
  client: GuideDiscordClient;
  channelId: string;
  plan: GuidePublishPlan;
  screenshotsDir: string;
  botUserId: string;
  cards?: readonly RaidleadGuideCard[];
  /** After upsert, re-read + verify five cards, then delete the complete known legacy set. */
  retireLegacy?: boolean;
  dryRun?: boolean;
}): Promise<GuidePublishResult> {
  if (input.plan.errors.length > 0) {
    throw new Error(input.plan.errors.join("\n"));
  }
  const cards = input.cards ?? RAIDLEAD_GUIDE_CARDS;
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
      }
    }
    return {
      unchanged,
      updated,
      created,
      retiredLegacy: input.retireLegacy && input.plan.legacyComplete ? input.plan.legacyMessageIds.length : 0,
      messageIdsByCard,
      retirementSkippedReason:
        input.retireLegacy && !input.plan.legacyComplete
          ? "legacy set incomplete/ambiguous"
          : undefined,
    };
  }

  for (const action of input.plan.actions) {
    const card = cards.find((c) => c.key === action.cardKey);
    if (!card) throw new Error(`Missing card ${action.cardKey}`);
    const assetRevision = input.plan.assetRevisions[card.key] ?? null;
    const embed = buildRaidleadGuideEmbed(card, { assetRevision });
    const components = buildRaidleadGuideComponents(card);
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

  if (!input.retireLegacy) {
    return { unchanged, updated, created, retiredLegacy, messageIdsByCard };
  }

  // Product-level transaction: upsert first, re-read, verify five cards, then retire complete set only.
  const after = await input.client.listMessages(input.channelId);
  const verified = verifyCanonicalRaidleadGuideState({
    messages: after,
    botUserId: input.botUserId,
    cards,
    assetRevisions: input.plan.assetRevisions,
  });
  if (!verified.ok) {
    return {
      unchanged,
      updated,
      created,
      retiredLegacy: 0,
      messageIdsByCard,
      retirementSkippedReason: `canonical verification failed: ${verified.errors.join("; ")}`,
    };
  }

  const legacyAfter = identifyKnownLegacyRaidleadGuideSet(after, input.botUserId);
  if (!legacyAfter.complete) {
    return {
      unchanged,
      updated,
      created,
      retiredLegacy: 0,
      messageIdsByCard,
      retirementSkippedReason: `legacy set incomplete after upsert: ${legacyAfter.errors.join("; ")}`,
    };
  }

  for (const messageId of legacyAfter.messageIds) {
    await input.client.deleteMessage(input.channelId, messageId);
    retiredLegacy += 1;
  }

  return { unchanged, updated, created, retiredLegacy, messageIdsByCard };
}

export function defaultScreenshotsDir(root = process.cwd()): string {
  return resolve(root, "docs/guides/screenshots");
}

export function defaultGuideSnapshotDir(root = process.cwd()): string {
  return resolve(root, DEFAULT_GUIDE_SNAPSHOT_DIR);
}
