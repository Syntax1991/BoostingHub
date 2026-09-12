/**
 * Testable core of Discord Run-channel lifecycle reconciliation, kept
 * independent of discord.js's concrete channel types so it can be unit
 * tested without a live bot/token. `sync-loop.ts` supplies a thin discord.js
 * adapter (a `ChannelFetcher`) that resolves a real channel into the narrow
 * `ReconcilableChannel` shape this module actually needs.
 *
 * Scope: reconciling an EXISTING per-Run channel's name and CURRENT/NEXT/
 * ARCHIVE category. This module never provisions a Run's first channel —
 * that stays exclusively gated behind the signup path's `isSignupWindowOpen`
 * + week-bucket rule in discord-sync.service.ts, and never reproduces that
 * weekly calendar logic itself: `item.targetBucket` arrives already decided
 * by the Service. See docs/features/discord-bot.md § weekly raid-ID
 * categories for the full architecture.
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
  discordRunCurrentCategoryId: string | null;
  discordRunNextCategoryId: string | null;
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
 * name has drifted, then independently moves it to whichever category
 * (CURRENT/NEXT/ARCHIVE) `item.targetBucket` calls for. Both steps are
 * idempotent no-ops when the channel is already correct, and neither ever
 * deletes, recreates, or clones the channel — the same Discord channel
 * identity survives every Archive/Restore/rename/weekly rollover.
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

  const desiredParentId =
    item.targetBucket === "ARCHIVE"
      ? env.discordRunArchiveCategoryId
      : item.targetBucket === "NEXT"
        ? env.discordRunNextCategoryId
        : env.discordRunCurrentCategoryId;
  if (!desiredParentId) {
    const missingVar =
      item.targetBucket === "ARCHIVE"
        ? "DISCORD_RUN_ARCHIVE_CATEGORY_ID"
        : item.targetBucket === "NEXT"
          ? "DISCORD_RUN_NEXT_CATEGORY_ID"
          : "DISCORD_RUN_CURRENT_CATEGORY_ID";
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
