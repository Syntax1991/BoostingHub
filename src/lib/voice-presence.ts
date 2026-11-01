/**
 * Discord voice presence hint for Attendance — information only, never an
 * attendance status. The bot reports who is connected to a running Run's
 * assigned voice channel; the web keeps the last report in memory for a short
 * TTL. Anything not backed by a fresh report for exactly that channel is
 * UNKNOWN — a timestamp alone never proves someone is still connected.
 */

export type VoicePresence = "IN_VOICE" | "NOT_IN_VOICE" | "UNKNOWN";

/** A report older than this no longer says anything (bot down, restarting, lost connection). */
export const VOICE_PRESENCE_TTL_MS = 3 * 60_000;

/** How often the bot reports at most (its sync pass runs every few seconds). */
export const VOICE_PRESENCE_REPORT_INTERVAL_MS = 60_000;

/** Upper bound of ids accepted per channel report (a raid voice channel is far smaller). */
export const VOICE_PRESENCE_MAX_MEMBERS = 100;

export type VoicePresenceSnapshot = {
  /** The voice channel the bot read. */
  channelId: string;
  /** Discord user ids connected at `observedAt` (bots excluded). */
  discordUserIds: ReadonlySet<string>;
  observedAt: number;
};

export const VOICE_PRESENCE_LABELS: Record<VoicePresence, string> = {
  IN_VOICE: "In voice",
  NOT_IN_VOICE: "Not in voice",
  UNKNOWN: "Voice unknown",
};

/**
 * One participant's hint. UNKNOWN without a linked Discord account, without a
 * report, for a report of another channel than the Run's current one, or for
 * a report older than the TTL.
 */
export function classifyVoicePresence(input: {
  snapshot: VoicePresenceSnapshot | null;
  runVoiceChannelId: string | null;
  discordUserId: string | null;
  now: number;
  ttlMs?: number;
}): VoicePresence {
  const { snapshot } = input;
  if (!input.discordUserId || !input.runVoiceChannelId || !snapshot) return "UNKNOWN";
  if (snapshot.channelId !== input.runVoiceChannelId) return "UNKNOWN";
  if (input.now - snapshot.observedAt > (input.ttlMs ?? VOICE_PRESENCE_TTL_MS)) return "UNKNOWN";
  return snapshot.discordUserIds.has(input.discordUserId) ? "IN_VOICE" : "NOT_IN_VOICE";
}
