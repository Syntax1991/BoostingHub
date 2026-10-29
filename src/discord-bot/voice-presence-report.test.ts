import { describe, expect, it } from "vitest";
import { buildVoicePresenceReports, isVoiceCacheTrusted, shouldReportVoicePresence } from "@/discord-bot/voice-presence-report";
import {
  classifyVoicePresence,
  VOICE_PRESENCE_MAX_MEMBERS,
  VOICE_PRESENCE_REPORT_INTERVAL_MS,
  VOICE_PRESENCE_TTL_MS,
} from "@/lib/voice-presence";

describe("bot voice presence report", () => {
  it("reports only running Runs (RECONCILE) with a channel the gateway cache can read; ids deduplicated", () => {
    const reports = buildVoicePresenceReports({
      items: [
        { runId: "running", action: "RECONCILE" },
        { runId: "starting", action: "PROVISION" },
        { runId: "finished", action: "RETIRE_IF_EMPTY" },
        { runId: "unreadable", action: "RECONCILE" },
        { runId: "no-channel", action: "RECONCILE" },
      ],
      resolved: new Map([
        ["running", "v1"],
        ["starting", "v2"],
        ["finished", "v3"],
        ["unreadable", "v4"],
        ["no-channel", null],
      ]),
      readMemberIds: (channelId) => (channelId === "v1" ? ["a", "b", "a"] : channelId === "v4" ? null : ["x"]),
    });
    expect(reports).toEqual([{ runId: "running", channelId: "v1", discordUserIds: ["a", "b"] }]);
  });

  it("an empty channel is reported (everyone left), an unreadable one is not", () => {
    const reports = buildVoicePresenceReports({
      items: [{ runId: "r", action: "RECONCILE" }],
      resolved: new Map([["r", "v"]]),
      readMemberIds: () => [],
    });
    expect(reports).toEqual([{ runId: "r", channelId: "v", discordUserIds: [] }]);
  });

  const ids = (count: number, prefix = "m") => Array.from({ length: count }, (_, index) => `${prefix}${index}`);
  const single = (memberIds: string[] | null) =>
    buildVoicePresenceReports({
      items: [{ runId: "r", action: "RECONCILE" }],
      resolved: new Map([["r", "v"]]),
      readMemberIds: () => memberIds,
    });

  it("snapshot size: 0 → complete empty snapshot, exactly the limit → valid, one over → no snapshot (never truncated)", () => {
    expect(VOICE_PRESENCE_MAX_MEMBERS).toBe(100);
    expect(single([])).toEqual([{ runId: "r", channelId: "v", discordUserIds: [] }]);
    expect(single(ids(100))[0]!.discordUserIds).toHaveLength(100);
    expect(single(ids(101))).toEqual([]);
    // Duplicates are counted once: 100 distinct ids among 150 entries still fit.
    expect(single([...ids(100), ...ids(50)])[0]!.discordUserIds).toHaveLength(100);
  });

  it("an overfull channel does not stop the other Runs' reports", () => {
    const reports = buildVoicePresenceReports({
      items: [
        { runId: "full", action: "RECONCILE" },
        { runId: "ok", action: "RECONCILE" },
      ],
      resolved: new Map([
        ["full", "v-full"],
        ["ok", "v-ok"],
      ]),
      readMemberIds: (channelId) => (channelId === "v-full" ? ids(101) : ["a"]),
    });
    expect(reports).toEqual([{ runId: "ok", channelId: "v-ok", discordUserIds: ["a"] }]);
  });

  it("the voice cache is trusted only with a READY gateway and an available guild (else nothing is reported)", () => {
    expect(isVoiceCacheTrusted({ clientReady: true, gatewayReady: true, guildAvailable: true })).toBe(true);
    expect(isVoiceCacheTrusted({ clientReady: false, gatewayReady: true, guildAvailable: true })).toBe(false);
    expect(isVoiceCacheTrusted({ clientReady: true, gatewayReady: false, guildAvailable: true })).toBe(false);
    expect(isVoiceCacheTrusted({ clientReady: true, gatewayReady: true, guildAvailable: false })).toBe(false);
  });

  it("at most one report per interval", () => {
    expect(shouldReportVoicePresence(null, 1_000)).toBe(true);
    expect(shouldReportVoicePresence(1_000, 1_000 + VOICE_PRESENCE_REPORT_INTERVAL_MS - 1)).toBe(false);
    expect(shouldReportVoicePresence(1_000, 1_000 + VOICE_PRESENCE_REPORT_INTERVAL_MS)).toBe(true);
  });
});

describe("classifyVoicePresence", () => {
  const snapshot = { channelId: "v", discordUserIds: new Set(["a"]), observedAt: 10_000 };
  const at = (overrides: Partial<Parameters<typeof classifyVoicePresence>[0]>) =>
    classifyVoicePresence({ snapshot, runVoiceChannelId: "v", discordUserId: "a", now: 20_000, ...overrides });

  it("fresh report for the Run's channel: in / not in voice", () => {
    expect(at({})).toBe("IN_VOICE");
    expect(at({ discordUserId: "b" })).toBe("NOT_IN_VOICE");
  });

  it("after the TTL — e.g. the gateway dropped and nothing new was reported — the last snapshot reads UNKNOWN", () => {
    // Gateway down: the cache is not trusted, so the bot reports nothing new…
    expect(isVoiceCacheTrusted({ clientReady: true, gatewayReady: false, guildAvailable: true })).toBe(false);
    // …and the last good snapshot stops counting once it expires, for in- and not-in-voice alike.
    const expired = 10_000 + VOICE_PRESENCE_TTL_MS + 1;
    expect(at({ now: 10_000 + VOICE_PRESENCE_TTL_MS })).toBe("IN_VOICE");
    expect(at({ now: expired })).toBe("UNKNOWN");
    expect(at({ now: expired, discordUserId: "b" })).toBe("UNKNOWN");
  });

  it("anything unproven is UNKNOWN: no Discord id, no channel, no report, other channel, stale", () => {
    expect(at({ discordUserId: null })).toBe("UNKNOWN");
    expect(at({ runVoiceChannelId: null })).toBe("UNKNOWN");
    expect(at({ snapshot: null })).toBe("UNKNOWN");
    expect(at({ runVoiceChannelId: "other" })).toBe("UNKNOWN");
    expect(at({ now: 10_000 + VOICE_PRESENCE_TTL_MS + 1 })).toBe("UNKNOWN");
  });
});
