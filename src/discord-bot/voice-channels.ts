/**
 * Temporary per-Run GuildVoice channel lifecycle ("Raid with <Raid Lead>").
 * Kept independent of discord.js concrete types so it is unit-testable;
 * `sync-loop.ts` supplies thin adapters.
 *
 * Rules (see docs/features/discord-bot.md § Temporary Run voice channels):
 * - PROVISION: create one GuildVoice channel in the dedicated voice category.
 * - RECONCILE (Run IN_PROGRESS): keep the channel even when nobody is in it;
 *   if Discord confirms it is gone (Unknown Channel), clear and recreate once.
 * - RETIRE_IF_EMPTY (COMPLETED / CANCELLED / app-archived): keep while anyone
 *   is connected; delete only when empty, and clear the id only after a
 *   successful delete (or when Discord confirms it is already gone).
 * Never touches the text Run channel or its CURRENT/NEXT ordering. Failures
 * are logged and retried next poll — they never affect the Run itself.
 * Only first creation needs the voice category; existing channels are
 * managed (kept, renamed, cleaned up) even when creation is unavailable.
 * A created channel is exposed only after its id is persisted; if recording
 * fails it is deleted again (best effort) so no untracked duplicate remains.
 */
import { isDiscordUnknownChannelError } from "@/discord-bot/discord-api-errors";

export type RunVoiceChannelWorkItem = {
  runId: string;
  existingVoiceChannelId: string | null;
  desiredVoiceChannelName: string;
  action: "PROVISION" | "RECONCILE" | "RETIRE_IF_EMPTY";
};

export type VoiceChannelView =
  | {
      kind: "voice";
      name: string;
      /** Members currently connected (requires the GuildVoiceStates intent). */
      memberCount: number;
      setName(name: string): Promise<unknown>;
      delete(reason: string): Promise<unknown>;
    }
  | { kind: "other" }
  /** Fetch resolved to nothing without a confirmed Unknown Channel error — not proof of deletion. */
  | { kind: "unresolved" };

/** A voice channel just created in Discord, with a handle to undo it if it cannot be recorded. */
export type CreatedVoiceChannel = {
  id: string;
  delete(reason: string): Promise<unknown>;
};

export type RunVoiceChannelAdapters = {
  /** Throws Discord API errors as-is (Unknown Channel 10003, Missing Access, network…). */
  fetchChannel(channelId: string): Promise<VoiceChannelView>;
  /**
   * Creates a GuildVoice channel in the voice category. Null when creation is
   * not possible this pass (category unset, unusable, or not needed) — existing
   * channels are still managed without it.
   */
  createVoiceChannel: ((name: string) => Promise<CreatedVoiceChannel>) | null;
  recordVoiceChannel(runId: string, channelId: string): Promise<void>;
  clearVoiceChannel(runId: string, channelId: string): Promise<void>;
};

/** runId → current voice channel id this pass (null = confirmed gone / deleted this pass). */
export type ResolvedVoiceChannels = Map<string, string | null>;

/**
 * The voice channel a message rendered in this pass should link. This pass's
 * outcome wins, even when it is null (just created → link it; deleted/gone
 * this pass → omit it); a Run absent from the pass falls back to the
 * projection taken before it. Never provisions or looks anything up.
 */
export function effectiveVoiceChannelId(
  resolved: ResolvedVoiceChannels,
  runId: string,
  persistedVoiceChannelId: string | null | undefined,
): string | null {
  return resolved.has(runId) ? (resolved.get(runId) ?? null) : (persistedVoiceChannelId ?? null);
}

async function provision(
  adapters: RunVoiceChannelAdapters,
  item: RunVoiceChannelWorkItem,
  resolved: ResolvedVoiceChannels,
): Promise<void> {
  if (!adapters.createVoiceChannel) return;
  let created: CreatedVoiceChannel;
  try {
    created = await adapters.createVoiceChannel(item.desiredVoiceChannelName);
  } catch (error) {
    console.error(`[discord-bot] failed to create voice channel for run ${item.runId} — will retry next poll`, error);
    return;
  }

  // A new channel only counts once its identity is persisted. Otherwise the
  // next poll would still see PROVISION and create a second channel, and a
  // Raid Invite could link a channel nothing tracks.
  try {
    await adapters.recordVoiceChannel(item.runId, created.id);
  } catch (recordError) {
    console.error(
      `[discord-bot] created voice channel ${created.id} for run ${item.runId} but could not record it — deleting it so the next poll can retry cleanly`,
      recordError,
    );
    try {
      await created.delete(`BoostingHub could not record this voice channel for run ${item.runId}`);
    } catch (deleteError) {
      if (!isDiscordUnknownChannelError(deleteError)) {
        console.error(
          `[discord-bot] ORPHANED VOICE CHANNEL: run ${item.runId} channel ${created.id} was created but neither recorded nor deleted — delete it manually in Discord`,
          deleteError,
        );
      }
    }
    return;
  }
  resolved.set(item.runId, created.id);
}

async function reconcile(
  adapters: RunVoiceChannelAdapters,
  item: RunVoiceChannelWorkItem & { existingVoiceChannelId: string },
  resolved: ResolvedVoiceChannels,
): Promise<void> {
  let channel: VoiceChannelView;
  try {
    channel = await adapters.fetchChannel(item.existingVoiceChannelId);
  } catch (error) {
    if (!isDiscordUnknownChannelError(error)) {
      console.warn(`[discord-bot] voice channel ${item.existingVoiceChannelId} for run ${item.runId} is temporarily inaccessible — keeping it`, error);
      return;
    }
    // Confirmed deleted while the Run is still running: clear, then recreate once.
    await adapters.clearVoiceChannel(item.runId, item.existingVoiceChannelId);
    resolved.set(item.runId, null);
    await provision(adapters, item, resolved);
    return;
  }

  if (channel.kind === "unresolved") {
    console.warn(`[discord-bot] voice channel ${item.existingVoiceChannelId} for run ${item.runId} did not resolve — keeping it`);
    return;
  }
  if (channel.kind !== "voice") {
    console.error(
      `[discord-bot] run ${item.runId}'s voice channel ${item.existingVoiceChannelId} is not a GuildVoice channel — leaving it untouched`,
    );
    return;
  }
  resolved.set(item.runId, item.existingVoiceChannelId);
  if (channel.name !== item.desiredVoiceChannelName) {
    try {
      await channel.setName(item.desiredVoiceChannelName);
    } catch (error) {
      console.warn(`[discord-bot] failed to rename voice channel for run ${item.runId}`, error);
    }
  }
}

async function retireIfEmpty(
  adapters: RunVoiceChannelAdapters,
  item: RunVoiceChannelWorkItem & { existingVoiceChannelId: string },
  resolved: ResolvedVoiceChannels,
): Promise<void> {
  const channelId = item.existingVoiceChannelId;
  let channel: VoiceChannelView;
  try {
    channel = await adapters.fetchChannel(channelId);
  } catch (error) {
    if (isDiscordUnknownChannelError(error)) {
      await adapters.clearVoiceChannel(item.runId, channelId);
      resolved.set(item.runId, null);
      return;
    }
    console.warn(`[discord-bot] cannot inspect voice channel ${channelId} for run ${item.runId} — retrying cleanup next poll`, error);
    return;
  }

  if (channel.kind !== "voice") {
    if (channel.kind === "other") {
      console.error(`[discord-bot] run ${item.runId}'s voice channel ${channelId} is not a GuildVoice channel — not deleting it`);
    }
    return;
  }
  // Players may stay in voice after the Run ends; delete only once empty.
  if (channel.memberCount > 0) return;

  try {
    await channel.delete(`BoostingHub run ${item.runId} ended and its voice channel is empty`);
  } catch (error) {
    if (!isDiscordUnknownChannelError(error)) {
      console.warn(`[discord-bot] failed to delete empty voice channel ${channelId} for run ${item.runId} — retrying next poll`, error);
      return;
    }
  }
  await adapters.clearVoiceChannel(item.runId, channelId);
  resolved.set(item.runId, null);
}

/**
 * Applies every voice work item, isolating failures per Run. Returns the
 * same-pass resolution map so Raid Invite DMs sent later in this pass link a
 * just-created channel (or omit one deleted/confirmed gone this pass).
 */
export async function reconcileRunVoiceChannels(
  adapters: RunVoiceChannelAdapters,
  items: ReadonlyArray<RunVoiceChannelWorkItem>,
): Promise<ResolvedVoiceChannels> {
  const resolved: ResolvedVoiceChannels = new Map();
  for (const item of items) {
    try {
      if (item.action === "PROVISION") {
        if (!item.existingVoiceChannelId) await provision(adapters, item, resolved);
      } else if (item.existingVoiceChannelId) {
        const withId = { ...item, existingVoiceChannelId: item.existingVoiceChannelId };
        if (item.action === "RECONCILE") await reconcile(adapters, withId, resolved);
        else await retireIfEmpty(adapters, withId, resolved);
      }
    } catch (error) {
      console.error(`[discord-bot] voice channel sync failed for run ${item.runId}`, error);
    }
  }
  return resolved;
}
