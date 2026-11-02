/**
 * Replace a live Discord guide with new messages instead of editing the old ones.
 *
 * Discord limits edits to messages older than one hour, so a full guide refresh
 * can stop half way. Replacing avoids that limit and works in two separate runs:
 *
 *   Phase A + B  `--replace --publish`     save the old ids and a full snapshot,
 *                                          create one new message per card, verify.
 *   Phase C      `--replace --retire-old`  verify again, then delete exactly the
 *                                          old ids saved in phase A, verify the end state.
 *
 * Old and new messages carry the same footer marker while both exist, so the normal
 * publisher refuses to touch the channel during a replacement (ambiguous duplicates).
 * This module does not relax that guard: it only ever acts on the ids in its state file.
 *
 * Every step is saved before and after its Discord call, so a second run resumes from
 * the state file and never creates a card twice. Any error stops the run and keeps
 * everything in place for the operator.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Pause between two Discord writes. No parallel writes, no bursts. */
export const GUIDE_REPLACE_WRITE_PAUSE_MS = 2_000;
/** A 429 asking for a longer wait stops the run instead of keeping the process alive. */
export const GUIDE_REPLACE_MAX_RETRY_AFTER_SECONDS = 60;
/** Discord stores the nonce with at most 25 characters. */
const DISCORD_NONCE_LENGTH = 25;
const DISCORD_UNKNOWN_MESSAGE_CODE = 10008;
const ALLOWED_ASSET_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

export type GuideReplaceMessage = {
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
  mention_everyone?: boolean;
  mentions?: unknown[];
  mention_roles?: unknown[];
};

export type GuideReplaceCard = {
  key: string;
  imageFile: string | null;
  linkButton?: { label: string; url: string };
};

/** What the replace flow needs from one guide. Booster and Raid Lead each provide one. */
export type GuideReplaceAdapter<Card extends GuideReplaceCard = GuideReplaceCard> = {
  kind: string;
  cards: readonly Card[];
  assetRevisions: Record<string, string | null>;
  cardErrors: string[];
  /** Current card key from a footer (declared renames resolved), null when unmarked. */
  cardKeyFromFooter(footer: string | null | undefined): string | null;
  needsUpdate(message: GuideReplaceMessage, card: Card, assetRevision: string | null): boolean;
  /** Rendered payload of a card. Only hashed, to notice text changes between runs. */
  render(card: Card, assetRevision: string | null): unknown;
};

export type GuideReplaceClient<Card extends GuideReplaceCard = GuideReplaceCard> = {
  listMessages(channelId: string): Promise<GuideReplaceMessage[]>;
  createCardMessage(input: {
    channelId: string;
    card: Card;
    assetRevision: string | null;
    nonce: string;
  }): Promise<{ id: string }>;
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  fetchAsset(url: string): Promise<Buffer>;
};

export type GuideReplacePhase = "creating" | "verified" | "deleting" | "done";

export type GuideReplaceState = {
  version: 1;
  kind: string;
  channelId: string;
  botUserId: string;
  runId: string;
  startedAt: string;
  desiredHash: string;
  phase: GuideReplacePhase;
  oldMessages: Array<{ id: string; cardKey: string }>;
  newByCard: Record<string, string>;
  /** Card whose create call started without a saved result. */
  pendingCardKey: string | null;
  deletedOldIds: string[];
  /** Old id whose delete call started without a saved result. */
  deletingOldId: string | null;
  snapshotPath: string;
  lastError: string | null;
  earliestResumeAt: string | null;
};

export type GuideReplaceOutcome = {
  ok: boolean;
  phase: GuideReplacePhase | "not-started";
  created: number;
  adopted: number;
  deleted: number;
  newByCard: Record<string, string>;
  remainingOldIds: string[];
  errors: string[];
  statePath: string;
  earliestResumeAt: string | null;
};

export type GuideReplaceContext<Card extends GuideReplaceCard = GuideReplaceCard> = {
  adapter: GuideReplaceAdapter<Card>;
  client: GuideReplaceClient<Card>;
  channelId: string;
  botUserId: string;
  snapshotDir: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  writePauseMs?: number;
};

/** Discord answered with an error status. Carries what the 429 policy needs. */
export class DiscordHttpError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: string,
    readonly retryAfterSeconds: number | null,
    readonly isGlobal: boolean,
  ) {
    super(`Discord ${status} ${method} ${path}: ${body.slice(0, 500)}`);
    this.name = "DiscordHttpError";
  }

  /** Discord's own error code from the JSON body, when there is one. */
  get discordCode(): number | null {
    try {
      const code = (JSON.parse(this.body) as { code?: unknown }).code;
      return typeof code === "number" ? code : null;
    } catch {
      return null;
    }
  }
}

/** Build the error from a failed response without reading anything but status, headers and body. */
export function discordHttpErrorFrom(
  status: number,
  method: string,
  path: string,
  body: string,
  headers: { get(name: string): string | null },
): DiscordHttpError {
  let parsed: { retry_after?: unknown; global?: unknown } = {};
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    // Non-JSON bodies still carry the Retry-After header.
  }
  const header = Number(headers.get("retry-after"));
  const retryAfter =
    headers.get("retry-after") !== null && Number.isFinite(header)
      ? header
      : typeof parsed.retry_after === "number"
        ? parsed.retry_after
        : null;
  return new DiscordHttpError(status, method, path, body, retryAfter, parsed.global === true);
}

class GuideReplaceRateLimited extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds: number | null,
  ) {
    super(message);
    this.name = "GuideReplaceRateLimited";
  }
}

/** One wait of the time Discord asks for and one more try. A second 429 or a long wait stops the run. */
async function withRateLimitPolicy<T>(
  sleep: (ms: number) => Promise<void>,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof DiscordHttpError) || error.status !== 429) throw error;
    const seconds = error.retryAfterSeconds;
    if (error.isGlobal || seconds === null || seconds > GUIDE_REPLACE_MAX_RETRY_AFTER_SECONDS) {
      throw new GuideReplaceRateLimited(error.message, seconds);
    }
    await sleep(Math.ceil((seconds + 0.5) * 1_000));
    try {
      return await call();
    } catch (retryError) {
      if (retryError instanceof DiscordHttpError && retryError.status === 429) {
        throw new GuideReplaceRateLimited(retryError.message, retryError.retryAfterSeconds);
      }
      throw retryError;
    }
  }
}

export function guideReplaceDir(snapshotDir: string, channelId: string): string {
  return resolve(snapshotDir, `replace-${channelId}`);
}

export function guideReplaceStatePath(snapshotDir: string, channelId: string): string {
  return resolve(guideReplaceDir(snapshotDir, channelId), "state.json");
}

async function loadState(path: string): Promise<GuideReplaceState | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return JSON.parse(raw) as GuideReplaceState;
}

/** Write to a temporary file first, so a crash never leaves a half-written state. */
async function saveState(path: string, state: GuideReplaceState): Promise<void> {
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2), "utf8");
  await rename(temp, path);
}

/** True while an unfinished replacement owns this channel. The normal publisher must then refuse. */
export async function hasActiveGuideReplacement(snapshotDir: string, channelId: string): Promise<boolean> {
  const state = await loadState(guideReplaceStatePath(snapshotDir, channelId));
  return state !== null && state.phase !== "done";
}

async function withLock<T>(dir: string, work: () => Promise<T>): Promise<T> {
  await mkdir(dir, { recursive: true });
  const lock = resolve(dir, "lock");
  try {
    await writeFile(lock, String(process.pid), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Another replace run holds ${lock}. Remove it only if no such process is running.`);
    }
    throw error;
  }
  try {
    return await work();
  } finally {
    await rm(lock, { force: true });
  }
}

function desiredHash<Card extends GuideReplaceCard>(adapter: GuideReplaceAdapter<Card>): string {
  const rendered = adapter.cards.map((card) => adapter.render(card, adapter.assetRevisions[card.key] ?? null));
  return createHash("sha256").update(JSON.stringify(rendered)).digest("hex");
}

function nonceFor(runId: string, cardKey: string): string {
  return createHash("sha256").update(`${runId}:${cardKey}`).digest("hex").slice(0, DISCORD_NONCE_LENGTH);
}

function footerOf(message: GuideReplaceMessage): string | null {
  return message.embeds?.[0]?.footer?.text ?? null;
}

/** Sort key of a Discord id: ids grow with creation time. */
function idOrder(id: string): bigint {
  return /^\d+$/.test(id) ? BigInt(id) : BigInt(0);
}

/**
 * Sort the channel into own guide messages per known card and everything else.
 * Everything else is a reason to stop, because the end state must be exactly the guide.
 */
function classifyChannel<Card extends GuideReplaceCard>(
  adapter: GuideReplaceAdapter<Card>,
  botUserId: string,
  messages: readonly GuideReplaceMessage[],
): { byKey: Map<string, GuideReplaceMessage[]>; problems: string[] } {
  const known = new Set(adapter.cards.map((card) => card.key));
  const byKey = new Map<string, GuideReplaceMessage[]>();
  const problems: string[] = [];
  for (const message of messages) {
    const key = adapter.cardKeyFromFooter(footerOf(message));
    if (message.author?.id !== botUserId) {
      problems.push(
        key
          ? `Message ${message.id} carries guide marker "${key}" from another author.`
          : `Message ${message.id} is from another author.`,
      );
      continue;
    }
    if (!key) {
      problems.push(`Own message ${message.id} has no guide marker.`);
      continue;
    }
    if (!known.has(key)) {
      problems.push(`Own message ${message.id} has unknown guide marker "${key}".`);
      continue;
    }
    byKey.set(key, [...(byKey.get(key) ?? []), message]);
  }
  return { byKey, problems };
}

/** Read-only check of the channel before a replacement starts. */
export function planGuideReplacement<Card extends GuideReplaceCard>(
  adapter: GuideReplaceAdapter<Card>,
  botUserId: string,
  messages: readonly GuideReplaceMessage[],
): { errors: string[]; oldMessages: Array<{ id: string; cardKey: string }>; cardsToCreate: string[] } {
  const { byKey, problems } = classifyChannel(adapter, botUserId, messages);
  const errors = [...adapter.cardErrors, ...problems];
  const oldMessages: Array<{ id: string; cardKey: string }> = [];
  for (const [key, list] of byKey) {
    if (list.length > 1) {
      errors.push(`Card "${key}" appears on ${list.length} messages. Refusing without a saved replacement.`);
    }
    for (const message of list) oldMessages.push({ id: message.id, cardKey: key });
  }
  // Discord lists newest first. Oldest first keeps the saved order readable and stable.
  oldMessages.sort((a, b) => (idOrder(a.id) < idOrder(b.id) ? -1 : 1));
  return { errors, oldMessages, cardsToCreate: adapter.cards.map((card) => card.key) };
}

/** Save the complete old messages and their image bytes: deleted attachments cannot be fetched later. */
async function writeReplaceSnapshot<Card extends GuideReplaceCard>(
  ctx: GuideReplaceContext<Card>,
  dir: string,
  runId: string,
  messages: readonly GuideReplaceMessage[],
): Promise<string> {
  const mediaDir = resolve(dir, `media-${runId}`);
  await mkdir(mediaDir, { recursive: true });
  for (const message of messages) {
    const urls = new Set<string>();
    for (const attachment of message.attachments ?? []) urls.add(attachment.url);
    for (const embed of message.embeds ?? []) {
      if (embed.image?.url) urls.add(embed.image.url);
    }
    let index = 0;
    for (const url of urls) {
      await writeFile(resolve(mediaDir, `${message.id}-${index}.bin`), await ctx.client.fetchAsset(url));
      index += 1;
    }
  }
  const path = resolve(dir, `snapshot-${runId}.json`);
  await writeFile(
    path,
    JSON.stringify({ channelId: ctx.channelId, savedAt: (ctx.now?.() ?? new Date()).toISOString(), messages }, null, 2),
    "utf8",
  );
  return path;
}

function buttonMatches(message: GuideReplaceMessage, card: GuideReplaceCard): boolean {
  const row = message.components?.[0] as { components?: Array<{ label?: string; url?: string }> } | undefined;
  const button = row?.components?.[0];
  if (!card.linkButton) return (message.components?.length ?? 0) === 0;
  return button?.label === card.linkButton.label && button?.url === card.linkButton.url;
}

/**
 * Full check of the channel against the saved state: only saved ids present, every new
 * card correct (text, footer, button, image bytes, no mentions) and in card order below the old ones.
 */
export async function verifyGuideReplacement<Card extends GuideReplaceCard>(
  ctx: GuideReplaceContext<Card>,
  state: GuideReplaceState,
  messages: readonly GuideReplaceMessage[],
): Promise<string[]> {
  const { adapter, botUserId } = ctx;
  const errors: string[] = [];
  const byId = new Map(messages.map((message) => [message.id, message]));
  const newIds = new Set(Object.values(state.newByCard));
  const deleted = new Set(state.deletedOldIds);
  const remainingOld = state.oldMessages.filter((old) => !deleted.has(old.id));

  for (const message of messages) {
    if (!newIds.has(message.id) && !remainingOld.some((old) => old.id === message.id)) {
      errors.push(`Unexpected message ${message.id} in the channel.`);
    }
  }

  for (const old of remainingOld) {
    const message = byId.get(old.id);
    if (!message) {
      if (old.id !== state.deletingOldId) errors.push(`Saved old message ${old.id} is gone.`);
      continue;
    }
    if (message.author?.id !== botUserId) errors.push(`Saved old message ${old.id} is not ours.`);
    if (adapter.cardKeyFromFooter(footerOf(message)) !== old.cardKey) {
      errors.push(`Saved old message ${old.id} no longer carries marker "${old.cardKey}".`);
    }
  }

  const newOrder: bigint[] = [];
  for (const card of adapter.cards) {
    const id = state.newByCard[card.key];
    const message = id ? byId.get(id) : undefined;
    if (!id || !message) {
      errors.push(`New message for card "${card.key}" is missing.`);
      continue;
    }
    newOrder.push(idOrder(id));
    const revision = adapter.assetRevisions[card.key] ?? null;
    if (message.author?.id !== botUserId) errors.push(`New message ${id} is not ours.`);
    if (adapter.cardKeyFromFooter(footerOf(message)) !== card.key) {
      errors.push(`New message ${id} does not carry marker "${card.key}".`);
    }
    if ((message.content ?? "") !== "") errors.push(`New message ${id} has unexpected plain text.`);
    if (adapter.needsUpdate(message, card, revision)) {
      errors.push(`New message ${id} does not match card "${card.key}".`);
    }
    if (!buttonMatches(message, card)) errors.push(`New message ${id} has the wrong link button.`);
    if (message.mention_everyone || (message.mentions?.length ?? 0) > 0 || (message.mention_roles?.length ?? 0) > 0) {
      errors.push(`New message ${id} mentions someone.`);
    }
    if (revision) {
      const url = message.embeds?.[0]?.image?.url;
      if (!url) {
        errors.push(`New message ${id} has no image.`);
      } else {
        try {
          const bytes = await ctx.client.fetchAsset(url);
          const actual = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
          if (actual !== revision) errors.push(`New message ${id} shows the wrong image.`);
        } catch (error) {
          errors.push(`New message ${id}: image could not be read (${(error as Error).message}).`);
        }
      }
    }
  }

  for (let i = 1; i < newOrder.length; i += 1) {
    if (newOrder[i]! <= newOrder[i - 1]!) errors.push("New messages are not in card order.");
  }
  const remainingOldPresent = remainingOld.filter((old) => byId.has(old.id));
  if (newOrder.length > 0 && remainingOldPresent.some((old) => idOrder(old.id) >= newOrder[0]!)) {
    errors.push("A saved old message is newer than the first new message.");
  }
  return errors;
}

function outcomeOf(
  statePath: string,
  state: GuideReplaceState | null,
  errors: string[],
  counts: { created?: number; adopted?: number; deleted?: number } = {},
): GuideReplaceOutcome {
  const deleted = new Set(state?.deletedOldIds ?? []);
  return {
    ok: errors.length === 0,
    phase: state?.phase ?? "not-started",
    created: counts.created ?? 0,
    adopted: counts.adopted ?? 0,
    deleted: counts.deleted ?? 0,
    newByCard: { ...(state?.newByCard ?? {}) },
    remainingOldIds: (state?.oldMessages ?? []).map((old) => old.id).filter((id) => !deleted.has(id)),
    errors,
    statePath,
    earliestResumeAt: state?.earliestResumeAt ?? null,
  };
}

/** Save what stopped the run. For a 429, also when a second run makes sense at the earliest. */
async function recordStop(
  now: Date,
  path: string,
  state: GuideReplaceState,
  error: unknown,
): Promise<string> {
  const message = error instanceof Error ? error.message : String(error);
  state.lastError = message;
  state.earliestResumeAt =
    error instanceof GuideReplaceRateLimited && error.retryAfterSeconds !== null
      ? new Date(now.getTime() + error.retryAfterSeconds * 1_000).toISOString()
      : null;
  await saveState(path, state);
  return message;
}

function stateMismatch<Card extends GuideReplaceCard>(ctx: GuideReplaceContext<Card>, state: GuideReplaceState): string | null {
  if (state.kind !== ctx.adapter.kind || state.channelId !== ctx.channelId || state.botUserId !== ctx.botUserId) {
    return "The saved replacement belongs to another guide, channel or bot.";
  }
  if (state.desiredHash !== desiredHash(ctx.adapter)) {
    return "Guide text or screenshots changed since this replacement started. Refusing to mix two versions.";
  }
  return null;
}

/**
 * Phase A + B. Creates missing cards in order and verifies them. Never deletes anything.
 * A second run continues from the saved ids and creates nothing that already exists.
 */
export async function publishGuideReplacement<Card extends GuideReplaceCard>(
  ctx: GuideReplaceContext<Card>,
): Promise<GuideReplaceOutcome> {
  const dir = guideReplaceDir(ctx.snapshotDir, ctx.channelId);
  const statePath = guideReplaceStatePath(ctx.snapshotDir, ctx.channelId);
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const pause = ctx.writePauseMs ?? GUIDE_REPLACE_WRITE_PAUSE_MS;

  return withLock(dir, async () => {
    if (ctx.adapter.cardErrors.length > 0) return outcomeOf(statePath, null, ctx.adapter.cardErrors);
    let state = await loadState(statePath);
    let messages = await ctx.client.listMessages(ctx.channelId);

    if (state) {
      const mismatch = stateMismatch(ctx, state);
      if (mismatch) return outcomeOf(statePath, state, [mismatch]);
      if (state.phase === "verified" || state.phase === "deleting" || state.phase === "done") {
        // Nothing to create. A finished or verified replacement stays a no-op.
        return outcomeOf(statePath, state, []);
      }
    } else {
      const plan = planGuideReplacement(ctx.adapter, ctx.botUserId, messages);
      if (plan.errors.length > 0) return outcomeOf(statePath, null, plan.errors);
      const runId = (ctx.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
      let snapshotPath: string;
      try {
        snapshotPath = await writeReplaceSnapshot(ctx, dir, runId, messages);
      } catch (error) {
        return outcomeOf(statePath, null, [`Snapshot failed, nothing was written to Discord: ${(error as Error).message}`]);
      }
      state = {
        version: 1,
        kind: ctx.adapter.kind,
        channelId: ctx.channelId,
        botUserId: ctx.botUserId,
        runId,
        startedAt: (ctx.now?.() ?? new Date()).toISOString(),
        desiredHash: desiredHash(ctx.adapter),
        phase: "creating",
        oldMessages: plan.oldMessages,
        newByCard: {},
        pendingCardKey: null,
        deletedOldIds: [],
        deletingOldId: null,
        snapshotPath,
        lastError: null,
        earliestResumeAt: null,
      };
      await saveState(statePath, state);
    }

    const oldIds = new Set(state.oldMessages.map((old) => old.id));
    const { byKey, problems } = classifyChannel(ctx.adapter, ctx.botUserId, messages);
    if (problems.length > 0) {
      const message = problems.join(" ");
      state.lastError = message;
      await saveState(statePath, state);
      return outcomeOf(statePath, state, problems);
    }

    let created = 0;
    let adopted = 0;
    try {
      for (const card of ctx.adapter.cards) {
        const savedId = state.newByCard[card.key];
        const fresh = (byKey.get(card.key) ?? []).filter((m) => !oldIds.has(m.id));
        if (savedId) {
          if (!fresh.some((m) => m.id === savedId)) {
            throw new Error(`Saved new message ${savedId} for card "${card.key}" is gone. Not creating it again.`);
          }
          if (fresh.length > 1) throw new Error(`Card "${card.key}" has more new messages than saved.`);
          continue;
        }
        if (fresh.length > 1) {
          throw new Error(`Card "${card.key}" has ${fresh.length} unsaved new messages. Refusing to guess.`);
        }
        if (fresh.length === 1) {
          // The create call worked but its result was never saved (crash or lost answer).
          state.newByCard[card.key] = fresh[0]!.id;
          state.pendingCardKey = null;
          adopted += 1;
          await saveState(statePath, state);
          continue;
        }
        state.pendingCardKey = card.key;
        await saveState(statePath, state);
        const runId = state.runId;
        const result = await withRateLimitPolicy(sleep, () =>
          ctx.client.createCardMessage({
            channelId: ctx.channelId,
            card,
            assetRevision: ctx.adapter.assetRevisions[card.key] ?? null,
            nonce: nonceFor(runId, card.key),
          }),
        );
        state.newByCard[card.key] = result.id;
        state.pendingCardKey = null;
        created += 1;
        await saveState(statePath, state);
        await sleep(pause);
      }

      messages = await ctx.client.listMessages(ctx.channelId);
      const errors = await verifyGuideReplacement(ctx, state, messages);
      if (errors.length > 0) {
        state.lastError = errors.join(" ");
        await saveState(statePath, state);
        return outcomeOf(statePath, state, errors, { created, adopted });
      }
      state.phase = "verified";
      state.lastError = null;
      state.earliestResumeAt = null;
      await saveState(statePath, state);
      return outcomeOf(statePath, state, [], { created, adopted });
    } catch (error) {
      const message = await recordStop(ctx.now?.() ?? new Date(), statePath, state, error);
      return outcomeOf(statePath, state, [message], { created, adopted });
    }
  });
}

/**
 * Phase C. Verifies the new cards once more, then deletes only the saved old ids, one by one.
 * Any error stops immediately; the outcome names the ids still left.
 */
export async function retireOldGuideMessages<Card extends GuideReplaceCard>(
  ctx: GuideReplaceContext<Card>,
): Promise<GuideReplaceOutcome> {
  const dir = guideReplaceDir(ctx.snapshotDir, ctx.channelId);
  const statePath = guideReplaceStatePath(ctx.snapshotDir, ctx.channelId);
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const pause = ctx.writePauseMs ?? GUIDE_REPLACE_WRITE_PAUSE_MS;

  return withLock(dir, async () => {
    const state = await loadState(statePath);
    if (!state) return outcomeOf(statePath, null, ["No saved replacement. Run --replace --publish first."]);
    const mismatch = stateMismatch(ctx, state);
    if (mismatch) return outcomeOf(statePath, state, [mismatch]);
    if (state.phase === "done") return outcomeOf(statePath, state, []);
    if (state.phase === "creating") {
      return outcomeOf(statePath, state, ["New messages are not verified yet. Nothing was deleted."]);
    }

    const before = await ctx.client.listMessages(ctx.channelId);
    const errors = await verifyGuideReplacement(ctx, state, before);
    if (errors.length > 0) {
      state.lastError = errors.join(" ");
      await saveState(statePath, state);
      return outcomeOf(statePath, state, errors);
    }

    const newIds = new Set(Object.values(state.newByCard));
    let deleted = 0;
    state.phase = "deleting";
    await saveState(statePath, state);
    try {
      for (const old of state.oldMessages) {
        if (state.deletedOldIds.includes(old.id)) continue;
        if (newIds.has(old.id)) throw new Error(`Refusing to delete new message ${old.id}.`);
        const present = before.some((message) => message.id === old.id);
        if (present) {
          state.deletingOldId = old.id;
          await saveState(statePath, state);
          await withRateLimitPolicy(sleep, async () => {
            try {
              await ctx.client.deleteMessage(ctx.channelId, old.id);
            } catch (error) {
              // Already gone: the goal of this step is reached.
              if (!(error instanceof DiscordHttpError) || error.discordCode !== DISCORD_UNKNOWN_MESSAGE_CODE) throw error;
            }
          });
          deleted += 1;
          await sleep(pause);
        }
        state.deletedOldIds.push(old.id);
        state.deletingOldId = null;
        await saveState(statePath, state);
      }

      const after = await ctx.client.listMessages(ctx.channelId);
      const finalErrors = await verifyGuideReplacement(ctx, state, after);
      if (finalErrors.length > 0) {
        state.lastError = finalErrors.join(" ");
        await saveState(statePath, state);
        return outcomeOf(statePath, state, finalErrors, { deleted });
      }
      state.phase = "done";
      state.lastError = null;
      state.earliestResumeAt = null;
      await saveState(statePath, state);
      return outcomeOf(statePath, state, [], { deleted });
    } catch (error) {
      const message = await recordStop(ctx.now?.() ?? new Date(), statePath, state, error);
      return outcomeOf(statePath, state, [message], { deleted });
    }
  });
}

/** Read an image from Discord's CDN. No token is sent, and no other host is accepted. */
export async function fetchDiscordAsset(url: string): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !ALLOWED_ASSET_HOSTS.has(parsed.hostname)) {
    throw new Error(`Refusing to read an asset from ${parsed.hostname}`);
  }
  const res = await fetch(parsed);
  if (!res.ok) throw new Error(`Asset download failed with status ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Shared command line of both publish scripts: `--replace` plus one mode flag. */
export async function runGuideReplaceCli<Card extends GuideReplaceCard>(
  ctx: GuideReplaceContext<Card>,
  mode: "plan" | "publish" | "retire",
): Promise<boolean> {
  const statePath = guideReplaceStatePath(ctx.snapshotDir, ctx.channelId);
  if (mode === "plan") {
    const messages = await ctx.client.listMessages(ctx.channelId);
    const state = await loadState(statePath);
    console.log(`Replace plan for ${ctx.adapter.kind} guide. Read-only, nothing was written.`);
    console.log(`  channel=${ctx.channelId} messages=${messages.length} state=${state?.phase ?? "none"}`);
    if (state) {
      console.log(`  saved old ids: ${state.oldMessages.map((old) => old.id).join(", ") || "-"}`);
      console.log(`  saved new ids: ${Object.values(state.newByCard).join(", ") || "-"}`);
      console.log(`  deleted old ids: ${state.deletedOldIds.join(", ") || "-"}`);
      if (state.lastError) console.log(`  last error: ${state.lastError}`);
      return true;
    }
    const plan = planGuideReplacement(ctx.adapter, ctx.botUserId, messages);
    for (const old of plan.oldMessages) console.log(`  would later delete ${old.id} (${old.cardKey})`);
    for (const key of plan.cardsToCreate) console.log(`  would create ${key}`);
    for (const error of plan.errors) console.error(`  refused: ${error}`);
    return plan.errors.length === 0;
  }

  const outcome = mode === "publish" ? await publishGuideReplacement(ctx) : await retireOldGuideMessages(ctx);
  console.log(`Phase: ${outcome.phase}. created=${outcome.created} adopted=${outcome.adopted} deleted=${outcome.deleted}`);
  console.log(`State file: ${outcome.statePath}`);
  for (const [key, id] of Object.entries(outcome.newByCard)) console.log(`  new ${key} = ${id}`);
  console.log(`  old ids still in the channel: ${outcome.remainingOldIds.join(", ") || "-"}`);
  if (outcome.earliestResumeAt) console.log(`  earliest next try: ${outcome.earliestResumeAt}`);
  if (!outcome.ok) {
    console.error("STOPPED. Nothing further was changed:");
    for (const error of outcome.errors) console.error(`  - ${error}`);
  }
  return outcome.ok;
}
