/**
 * Testable core of Discord Run-channel lifecycle reconciliation, kept
 * independent of discord.js's concrete channel types so it can be unit
 * tested without a live bot/token. `sync-loop.ts` supplies thin discord.js
 * adapters that resolve real channels into the narrow shapes this module
 * actually needs.
 *
 * Scope: reconciling an EXISTING per-Run channel's name, parent category,
 * and — for CURRENT/NEXT — its ordering position within that one shared
 * category. This module never provisions a Run's first channel — that stays
 * exclusively gated behind the signup path's `isSignupWindowOpen` +
 * week-bucket rule in discord-sync.service.ts, and never reproduces that
 * weekly calendar logic itself: `item.targetBucket` arrives already decided
 * by the Service. See docs/features/discord-bot.md § weekly raid-ID
 * sections for the full architecture.
 *
 * Discord channels cannot contain child channels, so there is only ONE
 * active Run category (`DISCORD_RUN_CATEGORY_ID`) — CURRENT and NEXT share
 * it. The two weeks are visually separated by two manually-managed marker
 * text channels (`#current-id`, `#next-id`) and by ordering the Run channels
 * around them, not by separate parent categories.
 */

export type ReconcilableChannel = {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  setName(name: string): Promise<unknown>;
  setParent(categoryId: string, options?: { lockPermissions?: boolean }): Promise<unknown>;
};

/** Resolves a channel id to a reconcilable channel, or null if it can't be resolved (deleted, inaccessible, or an incompatible channel type). */
export type ChannelFetcher = (channelId: string) => Promise<ReconcilableChannel | null>;

export type ChannelReconciliationEnv = {
  discordRunCategoryId: string | null;
  discordRunArchiveCategoryId: string | null;
};

export type ChannelReconciliationItem = {
  runId: string;
  existingRunChannelId: string;
  desiredChannelName: string;
  targetBucket: "CURRENT" | "NEXT" | "ARCHIVE";
};

export type ChannelReconciliationResult =
  | { status: "ok"; channelId: string }
  | { status: "missing" }
  | { status: "error"; error: unknown };

/**
 * Reconciles one already-existing Run channel: renames it in place if its
 * name has drifted, then independently moves it to the correct parent —
 * CURRENT and NEXT both resolve to the single `discordRunCategoryId`; only
 * ARCHIVE resolves to a different, real category. Both steps are idempotent
 * no-ops when the channel is already correct, and neither ever deletes,
 * recreates, or clones the channel — the same Discord channel identity
 * survives every Archive/Restore/rename/weekly rollover. Ordering WITHIN the
 * active category (which section a CURRENT/NEXT channel visually sits in) is
 * a separate concern — see `reconcileWeekSectionPositions` below.
 */
export async function reconcileExistingRunChannel(
  fetchChannel: ChannelFetcher,
  env: ChannelReconciliationEnv,
  item: ChannelReconciliationItem,
): Promise<ChannelReconciliationResult> {
  let channel: ReconcilableChannel | null;
  try {
    channel = await fetchChannel(item.existingRunChannelId);
  } catch (error) {
    return { status: "error", error };
  }

  if (!channel) {
    console.warn(
      `[discord-bot] run ${item.runId}'s channel ${item.existingRunChannelId} could not be resolved (deleted or inaccessible) — skipping reconciliation`,
    );
    return { status: "missing" };
  }

  if (channel.name !== item.desiredChannelName) {
    try {
      await channel.setName(item.desiredChannelName);
    } catch (error) {
      console.error(`[discord-bot] failed to rename channel for run ${item.runId}`, error);
    }
  }

  const desiredParentId = item.targetBucket === "ARCHIVE" ? env.discordRunArchiveCategoryId : env.discordRunCategoryId;
  if (!desiredParentId) {
    const missingVar = item.targetBucket === "ARCHIVE" ? "DISCORD_RUN_ARCHIVE_CATEGORY_ID" : "DISCORD_RUN_CATEGORY_ID";
    console.warn(
      `[discord-bot] run ${item.runId} needs its ${item.targetBucket} category but ${missingVar} is unset — leaving its channel where it is`,
    );
    return { status: "ok", channelId: channel.id };
  }

  if (channel.parentId !== desiredParentId) {
    try {
      // lockPermissions: false — a plain move, not a permission resync.
      // Syncing permissions from the destination category needs Manage
      // Roles as well as Manage Channels, and would silently overwrite this
      // channel's own overwrites; Archive/Restore only ever intends to
      // relocate the channel.
      await channel.setParent(desiredParentId, { lockPermissions: false });
    } catch (error) {
      console.error(`[discord-bot] failed to move channel for run ${item.runId} to category ${desiredParentId}`, error);
    }
  }

  return { status: "ok", channelId: channel.id };
}

/**
 * Reconciles every channel work item, isolating one item's failure from the
 * rest — a deleted/inaccessible channel must not stop other Runs' channels
 * from reconciling, and must never crash the bot process. Returns a
 * runId -> channelId map for the signup/roster message paths to reuse
 * within the same sync pass, instead of re-resolving (and potentially
 * re-renaming/re-moving) the same channel a second time.
 */
export async function reconcileChannels(
  fetchChannel: ChannelFetcher,
  env: ChannelReconciliationEnv,
  items: ChannelReconciliationItem[],
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  for (const item of items) {
    try {
      const result = await reconcileExistingRunChannel(fetchChannel, env, item);
      if (result.status === "ok") {
        resolved.set(item.runId, result.channelId);
      }
    } catch (error) {
      console.error(`[discord-bot] channel reconciliation crashed for run ${item.runId}`, error);
    }
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Week-section ordering (CURRENT / NEXT position reconciliation)
// ---------------------------------------------------------------------------

/** A child channel of the active Run category, as needed to compute ordering. */
export type CategoryChild = {
  readonly id: string;
  readonly position: number;
};

/** Lists the current children of a category (Run channels, the two markers, and any unmanaged channels), or null if the category itself can't be resolved. */
export type CategoryChannelLister = (categoryId: string) => Promise<CategoryChild[] | null>;

/** Applies a full desired ordering in one batched call (discord.js: `guild.channels.setPositions`) — never includes a marker channel id. */
export type PositionSetter = (moves: ReadonlyArray<{ channelId: string; position: number }>) => Promise<unknown>;

export type WeekSectionEnv = {
  discordRunCategoryId: string | null;
  discordRunCurrentMarkerChannelId: string | null;
  discordRunNextMarkerChannelId: string | null;
};

export type WeekSectionItem = {
  runId: string;
  existingRunChannelId: string;
  targetBucket: "CURRENT" | "NEXT" | "ARCHIVE";
  scheduledStartAt: string;
};

export type WeekSectionResult =
  | { status: "ok"; moved: number }
  | { status: "skipped"; reason: string };

function sortByScheduleThenRunId(items: WeekSectionItem[]): WeekSectionItem[] {
  return [...items].sort((a, b) => {
    const delta = new Date(a.scheduledStartAt).getTime() - new Date(b.scheduledStartAt).getTime();
    return delta !== 0 ? delta : a.runId.localeCompare(b.runId);
  });
}

/**
 * Orders CURRENT/NEXT Run channels within the ONE active category around the
 * two manually-managed marker channels, so the category reads (top to
 * bottom): `[unrelated channels above #current-id]`, `#current-id`, CURRENT
 * Run channels (chronological), `[unrelated channels between the markers]`,
 * `#next-id`, NEXT Run channels (chronological), `[unrelated channels below]`.
 *
 * The markers themselves are NEVER included in the emitted `moves` — never
 * renamed, never reparented, never repositioned by this function. They are
 * read-only anchors; their live `position` is what the CURRENT/NEXT blocks
 * are computed relative to. A channel not owned by BoostingHub (not one of
 * the two markers and not a `runId`'s `existingRunChannelId` in `items`) is
 * left at its own untouched position — this function only ever proposes new
 * positions for BoostingHub-owned CURRENT/NEXT Run channels.
 *
 * New positions for the CURRENT block are assigned as consecutive integers
 * immediately after the current marker's own (unchanged) position; the NEXT
 * block similarly right after the next marker's position, clamped below the
 * current marker's position on the rare chance the CURRENT block would
 * otherwise number far enough to reach it. This deliberately never touches
 * the markers' own values, so it never needs "free integer slots" between
 * two fixed numbers — Discord tolerates the resulting ties gracefully, and
 * an already-correctly-ordered category produces zero position writes.
 */
export async function reconcileWeekSectionPositions(
  listCategoryChildren: CategoryChannelLister,
  setPositions: PositionSetter,
  env: WeekSectionEnv,
  items: WeekSectionItem[],
): Promise<WeekSectionResult> {
  if (!env.discordRunCategoryId) {
    return { status: "skipped", reason: "DISCORD_RUN_CATEGORY_ID is unset" };
  }
  if (!env.discordRunCurrentMarkerChannelId) {
    console.warn("[discord-bot] DISCORD_RUN_CURRENT_MARKER_CHANNEL_ID is unset — skipping CURRENT/NEXT section reconciliation");
    return { status: "skipped", reason: "DISCORD_RUN_CURRENT_MARKER_CHANNEL_ID is unset" };
  }
  if (!env.discordRunNextMarkerChannelId) {
    console.warn("[discord-bot] DISCORD_RUN_NEXT_MARKER_CHANNEL_ID is unset — skipping CURRENT/NEXT section reconciliation");
    return { status: "skipped", reason: "DISCORD_RUN_NEXT_MARKER_CHANNEL_ID is unset" };
  }

  const children = await listCategoryChildren(env.discordRunCategoryId);
  if (!children) {
    console.warn("[discord-bot] DISCORD_RUN_CATEGORY_ID does not resolve — skipping CURRENT/NEXT section reconciliation");
    return { status: "skipped", reason: "category not found" };
  }

  const currentMarker = children.find((c) => c.id === env.discordRunCurrentMarkerChannelId);
  const nextMarker = children.find((c) => c.id === env.discordRunNextMarkerChannelId);
  if (!currentMarker) {
    console.warn("[discord-bot] #current-id marker is not a child of DISCORD_RUN_CATEGORY_ID — skipping CURRENT/NEXT section reconciliation");
    return { status: "skipped", reason: "current marker not in category" };
  }
  if (!nextMarker) {
    console.warn("[discord-bot] #next-id marker is not a child of DISCORD_RUN_CATEGORY_ID — skipping CURRENT/NEXT section reconciliation");
    return { status: "skipped", reason: "next marker not in category" };
  }
  if (currentMarker.position >= nextMarker.position) {
    console.warn("[discord-bot] #current-id must sit above #next-id — skipping CURRENT/NEXT section reconciliation until reordered manually");
    return { status: "skipped", reason: "marker order reversed" };
  }

  const currentManaged = sortByScheduleThenRunId(items.filter((item) => item.targetBucket === "CURRENT"));
  const nextManaged = sortByScheduleThenRunId(items.filter((item) => item.targetBucket === "NEXT"));

  const childById = new Map(children.map((child) => [child.id, child]));
  const moves: Array<{ channelId: string; position: number }> = [];

  let cursor = currentMarker.position + 1;
  for (const item of currentManaged) {
    const child = childById.get(item.existingRunChannelId);
    if (!child) continue; // Not currently a child of this category — nothing to position yet.
    const desired = Math.min(cursor, nextMarker.position - 1);
    if (child.position !== desired) {
      moves.push({ channelId: child.id, position: desired });
    }
    cursor += 1;
  }

  cursor = nextMarker.position + 1;
  for (const item of nextManaged) {
    const child = childById.get(item.existingRunChannelId);
    if (!child) continue;
    if (child.position !== cursor) {
      moves.push({ channelId: child.id, position: cursor });
    }
    cursor += 1;
  }

  // Defensive — the markers are read-only anchors and must never appear in
  // the payload we send Discord, even if some computation above went wrong.
  const safeMoves = moves.filter(
    (move) => move.channelId !== env.discordRunCurrentMarkerChannelId && move.channelId !== env.discordRunNextMarkerChannelId,
  );

  if (safeMoves.length === 0) {
    return { status: "ok", moved: 0 };
  }

  try {
    await setPositions(safeMoves);
  } catch (error) {
    console.error("[discord-bot] failed to reconcile CURRENT/NEXT section positions", error);
    return { status: "skipped", reason: "setPositions failed" };
  }

  return { status: "ok", moved: safeMoves.length };
}
