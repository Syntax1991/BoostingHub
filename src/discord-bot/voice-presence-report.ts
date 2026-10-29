import { VOICE_PRESENCE_MAX_MEMBERS, VOICE_PRESENCE_REPORT_INTERVAL_MS } from "@/lib/voice-presence";

/** One running Run's voice channel members, as the Bot API expects them. */
export type VoicePresenceReportItem = { runId: string; channelId: string; discordUserIds: string[] };

/**
 * Reports for the Runs whose voice channel this pass kept (RECONCILE = the
 * Run is IN_PROGRESS), read from the gateway voice-state cache — no extra
 * Discord request. A channel the cache cannot read is left out (the web
 * then shows UNKNOWN once the last report expires), never reported empty.
 * A channel with more distinct members than the Bot API accepts is left out
 * too: a cut list would read the missing players as "not in voice".
 */
export function buildVoicePresenceReports(input: {
  items: ReadonlyArray<{ runId: string; action: string }>;
  resolved: ReadonlyMap<string, string | null>;
  readMemberIds: (channelId: string) => string[] | null;
}): VoicePresenceReportItem[] {
  const reports: VoicePresenceReportItem[] = [];
  for (const item of input.items) {
    if (item.action !== "RECONCILE") continue;
    const channelId = input.resolved.get(item.runId);
    if (!channelId) continue;
    const memberIds = input.readMemberIds(channelId);
    if (!memberIds) continue;
    const distinct = [...new Set(memberIds)];
    // Never report a truncated snapshot as complete.
    if (distinct.length > VOICE_PRESENCE_MAX_MEMBERS) continue;
    reports.push({ runId: item.runId, channelId, discordUserIds: distinct });
  }
  return reports;
}

/**
 * The gateway voice-state cache is only trusted while the bot's gateway
 * session is READY and the guild is available: a dropped / resuming
 * connection or a guild outage can leave stale members (or none) in the
 * cache, which must never read as "everyone left". Then nothing is reported
 * and the web falls back to UNKNOWN when the last report expires.
 */
export function isVoiceCacheTrusted(input: { clientReady: boolean; gatewayReady: boolean; guildAvailable: boolean }): boolean {
  return input.clientReady && input.gatewayReady && input.guildAvailable;
}

/** At most one report per interval, however often the sync pass runs. */
export function shouldReportVoicePresence(lastReportedAt: number | null, now: number): boolean {
  return lastReportedAt == null || now - lastReportedAt >= VOICE_PRESENCE_REPORT_INTERVAL_MS;
}
