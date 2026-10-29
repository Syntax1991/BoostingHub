import {
  classifyVoicePresence,
  VOICE_PRESENCE_TTL_MS,
  type VoicePresence,
  type VoicePresenceSnapshot,
} from "@/lib/voice-presence";
import { runDiscordPostRepository } from "@/repositories/run-discord-post.repository";
import { runRepository } from "@/repositories/run.repository";

/**
 * Ephemeral voice presence per Run (lib/voice-presence): the bot's latest
 * report lives only in this process's memory — no table, no history. A web
 * restart, a bot outage or a stale report simply reads as UNKNOWN. Kept on
 * globalThis so a dev hot reload of this module does not split the store.
 * (Production runs one `next start` process; more instances would each see
 * only their own reports — then UNKNOWN, never a wrong IN_VOICE.)
 */
const STORE_KEY = Symbol.for("boostinghub.voicePresence");
type Store = Map<string, VoicePresenceSnapshot>;

function store(): Store {
  const holder = globalThis as unknown as Record<symbol, Store | undefined>;
  holder[STORE_KEY] ??= new Map();
  return holder[STORE_KEY]!;
}

function prune(now: number): void {
  for (const [runId, snapshot] of store()) {
    if (now - snapshot.observedAt > VOICE_PRESENCE_TTL_MS) store().delete(runId);
  }
}

export type VoicePresenceReport = { runId: string; channelId: string; discordUserIds: string[] };

export const voicePresenceService = {
  /**
   * Bot report (Bot API, already authenticated): accepted only for a Run that
   * is IN_PROGRESS, not archived, and whose CURRENT assigned voice channel is
   * the reported one — a report for another channel or Run is ignored.
   */
  async record(reports: readonly VoicePresenceReport[], now: number = Date.now()): Promise<{ accepted: number; ignored: number }> {
    prune(now);
    let accepted = 0;
    for (const report of reports) {
      const run = await runRepository.findById(report.runId);
      const post = run ? await runDiscordPostRepository.findByRunId(run.id) : null;
      if (!run || run.archivedAt || run.status !== "IN_PROGRESS" || !post?.voiceChannelId || post.voiceChannelId !== report.channelId) {
        continue;
      }
      store().set(run.id, { channelId: report.channelId, discordUserIds: new Set(report.discordUserIds), observedAt: now });
      accepted += 1;
    }
    return { accepted, ignored: reports.length - accepted };
  },

  /** Hints for a running Run's participants, by Discord user id (null id → UNKNOWN). */
  presenceFor(
    input: { runId: string; runVoiceChannelId: string | null; discordUserIds: ReadonlyArray<string | null> },
    now: number = Date.now(),
  ): Map<string | null, VoicePresence> {
    const snapshot = store().get(input.runId) ?? null;
    return new Map(
      input.discordUserIds.map((discordUserId) => [
        discordUserId,
        classifyVoicePresence({ snapshot, runVoiceChannelId: input.runVoiceChannelId, discordUserId, now }),
      ]),
    );
  },

  /** Test helper: forget every report. */
  resetForTests(): void {
    store().clear();
  },
};
