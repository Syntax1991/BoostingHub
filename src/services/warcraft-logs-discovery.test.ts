import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { NextRequest } from "next/server";
import { orm } from "@/lib/prisma";
import {
  warcraftLogsApiClient,
  type WarcraftLogsReportFight,
  type WarcraftLogsReportMetadata,
} from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import { snowflakeAtTime } from "@/lib/discord-snowflake";
import { runConsumableAuditRepository } from "@/repositories/run-consumable-audit.repository";
import { runWarcraftLogsRepository } from "@/repositories/run-warcraft-logs.repository";
import { scheduledJobLockRepository } from "@/repositories/scheduled-job-lock.repository";
import { warcraftLogsDiscoveryRepository } from "@/repositories/warcraft-logs-discovery.repository";
import { identityKey, type ConsumableAuditParticipant } from "@/services/consumable-audit-extract";
import { discordSyncService } from "@/services/discord-sync.service";
import { runConsumableAutoAuditService } from "@/services/run-consumable-auto-audit.service";
import { fetchReport, linkDiscoveredReport } from "@/services/run-warcraft-logs.service";
import {
  WCL_DISCOVERY_LOCK_KEY,
  warcraftLogsDiscoveryService,
} from "@/services/warcraft-logs-discovery.service";
import { POST as discoveryPost } from "@/app/api/bot/warcraft-logs/discoveries/route";
import { PUT as cursorPut } from "@/app/api/bot/warcraft-logs/channels/[channelId]/cursor/route";
import { POST as tickPost } from "@/app/api/bot/warcraft-logs/auto-audit/route";
import { GET as syncGet } from "@/app/api/bot/discord/sync/route";

/**
 * Central discovery end to end: the log bot's report link in a dedicated log
 * channel → recorded → matched to the seeded COMPLETED "Settlement QA" Run
 * (window 14:00–15:20) by its fights → linked → audited by the existing
 * automatic audit. WCL is mocked; every row written here is removed again.
 */
const RUN = "r9999996-9996-4996-8996-999999999996";
const TOKEN = "bot-api-test-token-discovery-0123";
const LOG_CHANNEL = "1553838853834674226";
const LOG_BOT = "1554176548435918910";
const OTHER_CHANNEL = "555555555555555555";
const REPORT = "FtwhWRvqjTbAx4NQ";
const LATE_REPORT = "Kp3xZm9QwLr7Vt2N";
const at = (hhmm: string) => new Date(`2026-09-20T${hhmm}:00.000Z`);
const REPORT_START = at("14:05").getTime();
/** A message posted at 14:06 — its snowflake encodes that time. */
const MESSAGE = snowflakeAtTime(at("14:06"));

let roster: Array<Extract<ConsumableAuditParticipant, { source: "ATTENDANCE" }>> = [];
let createdSnapshotId: string | null = null;

function metadata(code: string): WarcraftLogsReportMetadata {
  const actorIds = roster.map((_, i) => i + 1);
  const fight = (id: number, clock: string, kill = true): WarcraftLogsReportFight => {
    const startTime = at(clock).getTime() - REPORT_START;
    return { id, encounterId: 3129, name: "Plexus Sentinel", startTime, endTime: startTime + 300_000, kill, difficulty: 4, friendlyPlayers: actorIds };
  };
  return {
    code,
    title: "Manawyrm Logging",
    startTime: REPORT_START,
    endTime: at("15:25").getTime(),
    regionSlug: "EU",
    fights: [fight(1, "14:10", false), fight(2, "14:20")],
    actors: roster.map((p, i) => ({ id: i + 1, name: p.characterName, server: p.characterRealm, subType: "Mage" })),
    rankedCharacters: [],
  };
}

const bot = (url: string, method: string, body?: unknown, token: string | null = TOKEN) =>
  new NextRequest(new URL(url, "http://bot-api.test"), {
    method,
    headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const record = (overrides: Record<string, string> = {}) =>
  discoveryPost(bot("/api/bot/warcraft-logs/discoveries", "POST", { channelId: LOG_CHANNEL, messageId: MESSAGE, authorId: LOG_BOT, reportCode: REPORT, ...overrides }));

let metadataSpy: MockInstance<typeof warcraftLogsApiClient.fetchReportMetadata>;

async function clear() {
  await orm.WarcraftLogsReportDiscovery.where((row) => row.channelId.in([LOG_CHANNEL, OTHER_CHANNEL])).deleteAndCount();
  await orm.DiscordChannelScanCursor.where((row) => row.channelId.in([LOG_CHANNEL, OTHER_CHANNEL])).deleteAndCount();
  await orm.RunConsumableAudit.where({ runId: RUN }).deleteAndCount();
  await orm.RunWarcraftLogsReport.where({ runId: RUN }).deleteAndCount();
  await orm.WarcraftLogsReport.where((row) => row.code.in([REPORT, LATE_REPORT])).deleteAndCount();
}

beforeAll(async () => {
  const seen = new Set<string>();
  roster = (await runConsumableAuditRepository.listParticipants(RUN))
    .filter((row): row is Extract<ConsumableAuditParticipant, { source: "ATTENDANCE" }> => row.source === "ATTENDANCE")
    .filter((p) => {
      const key = identityKey(p.characterName, p.characterRealm);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (!(await orm.RunStartSnapshot.where({ runId: RUN }).first())) {
    createdSnapshotId = crypto.randomUUID();
    const now = new Date().toISOString();
    await orm.RunStartSnapshot.create({ id: createdSnapshotId, runId: RUN, startedAt: at("14:00").toISOString(), startedById: "33333333-3333-4333-8333-333333333333", createdAt: now, updatedAt: now });
  }
  await orm.Run.where({ id: RUN }).update({ completedAt: at("15:20").toISOString() });
});
afterAll(async () => {
  await clear();
  if (createdSnapshotId) await orm.RunStartSnapshot.where({ id: createdSnapshotId }).deleteAndCount();
  await orm.Run.where({ id: RUN }).update({ completedAt: null });
});
beforeEach(async () => {
  await clear();
  vi.stubEnv("BOOSTINGHUB_BOT_API_TOKEN", TOKEN);
  vi.stubEnv("DISCORD_WCL_REPORT_AUTHOR_IDS", LOG_BOT);
  vi.stubEnv("DISCORD_WCL_REPORT_CHANNEL_IDS", `${LOG_CHANNEL}, not-a-channel`);
  vi.spyOn(warcraftLogsApiClient, "isConfigured").mockReturnValue(true);
  metadataSpy = vi.spyOn(warcraftLogsApiClient, "fetchReportMetadata").mockImplementation(async (code) => ({ status: "SUCCESS", report: metadata(code) }));
  vi.spyOn(warcraftLogsApiClient, "fetchReportConsumableEvents").mockImplementation(async (input) => ({
    status: "SUCCESS",
    events: { casts: [], deaths: [], combatants: input.fightIds.flatMap((fight) => roster.map((_, i) => ({ fight, timestamp: 0, sourceId: i + 1, auraIds: [1235108] }))) },
  }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const discovery = () => warcraftLogsDiscoveryRepository.findByKey({ channelId: LOG_CHANNEL, messageId: MESSAGE, reportCode: REPORT });
const associations = () => runWarcraftLogsRepository.listAssociations(RUN);

describe("POST /api/bot/warcraft-logs/discoveries — the server re-checks the source", () => {
  it("records a trusted link from a configured log channel once, with the message time from its snowflake", async () => {
    expect((await record()).status).toBe(200);
    expect(await (await record()).json()).toMatchObject({ ok: true, data: { status: "ALREADY_RECORDED" } });
    expect(await discovery()).toMatchObject({ status: "PENDING", postedAt: at("14:06").toISOString(), attempts: 0, authorId: LOG_BOT });
    expect(metadataSpy).not.toHaveBeenCalled(); // matching happens on the server's pass, not in the bot's request
  });

  it("refuses an unconfigured channel, an untrusted author, a bad token and a malformed report code", async () => {
    expect((await record({ channelId: OTHER_CHANNEL })).status).toBe(403);
    expect((await record({ authorId: "222222222222222222" })).status).toBe(403);
    expect((await discoveryPost(bot("/api/bot/warcraft-logs/discoveries", "POST", {}, "wrong"))).status).toBe(401);
    expect((await record({ reportCode: "not-a-code" })).status).toBe(400);
    expect(await orm.WarcraftLogsReportDiscovery.where({ channelId: OTHER_CHANNEL }).all()).toHaveLength(0);
  });
});

describe("log channel cursor", () => {
  it("is handed to the bot (seeded 3 days back before the first read), and only moves forward", async () => {
    const seeded = (await discordSyncService.listSyncWork(at("16:00"))).warcraftLogsReportChannels;
    expect(seeded).toEqual([{ channelId: LOG_CHANNEL, cursor: snowflakeAtTime(at("16:00").getTime() - 3 * 86_400_000) }]);
    const put = (messageId: string, channelId = LOG_CHANNEL) =>
      cursorPut(bot(`/api/bot/warcraft-logs/channels/${channelId}/cursor`, "PUT", { messageId }), { params: Promise.resolve({ channelId }) });
    expect((await put("1554200000000000000")).status).toBe(200);
    expect((await put("1554100000000000000")).status).toBe(200); // older: ignored
    expect((await put("1554300000000000000", OTHER_CHANNEL)).status).toBe(403);
    const sync = await syncGet(bot("/api/bot/discord/sync", "GET")).then((r) => r.json());
    expect(sync.data.warcraftLogsReportChannels).toEqual([{ channelId: LOG_CHANNEL, cursor: "1554200000000000000" }]);
    expect(sync.data.warcraftLogsReportAuthorIds).toEqual([LOG_BOT]);
  });

  it("no trusted author or no channel configured → no log channel is read", async () => {
    vi.stubEnv("DISCORD_WCL_REPORT_CHANNEL_IDS", "");
    expect((await discordSyncService.listSyncWork(at("16:00"))).warcraftLogsReportChannels).toEqual([]);
    vi.stubEnv("DISCORD_WCL_REPORT_CHANNEL_IDS", LOG_CHANNEL);
    vi.stubEnv("DISCORD_WCL_REPORT_AUTHOR_IDS", "");
    expect((await discordSyncService.listSyncWork(at("16:00"))).warcraftLogsReportChannels).toEqual([]);
  });
});

describe("discovery pass — matching a centrally posted report to its Run", () => {
  it("matches the report to the completed Run by its fights, links it, and the automatic audit analyzes it", async () => {
    await record();
    const pass = await warcraftLogsDiscoveryService.runDuePass(at("16:00"));
    expect(pass).toEqual({ status: "COMPLETED", evaluated: [{ reportCode: REPORT, status: "MATCHED", outcome: "LINKED", linkedRuns: 1 }] });
    expect((await associations()).map((a) => [a.report.code, a.source, a.discordMessageId, a.discordAuthorId])).toEqual([
      [REPORT, "DISCORD_BOT", MESSAGE, LOG_BOT],
    ]);
    // Still re-checked while the report is fresh (a later Run in the same report must be found).
    expect(await discovery()).toMatchObject({ status: "MATCHED", linkedRunIds: [RUN], attempts: 1, nextAttemptAt: at("16:15").toISOString() });

    const audit = await runConsumableAutoAuditService.runDuePass(at("16:01"));
    expect(audit).toMatchObject({ status: "COMPLETED", runs: [{ runId: RUN, status: "ANALYZED", fights: 2 }] });
  });

  it("the 5-minute tick route runs discovery before the audit, so a report found now is audited in the same tick", async () => {
    await record();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at("16:00"));
    try {
      const res = await tickPost(bot("/api/bot/warcraft-logs/auto-audit", "POST"));
      const body = await res.json();
      expect(body.data.discovery).toMatchObject({ status: "COMPLETED", evaluated: [{ status: "MATCHED" }] });
      expect(body.data.audit).toMatchObject({ status: "COMPLETED", runs: [{ runId: RUN, status: "ANALYZED" }] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("no completed Run yet → PENDING, nothing linked; a later pass after completion matches it", async () => {
    await orm.Run.where({ id: RUN }).update({ completedAt: null }); // still open
    await record();
    const first = await warcraftLogsDiscoveryService.runDuePass(at("14:40"));
    expect(first).toMatchObject({ evaluated: [{ status: "PENDING", outcome: "RUN_IN_PROGRESS", linkedRuns: 0 }] });
    expect(await associations()).toHaveLength(0);
    expect(await warcraftLogsDiscoveryService.runDuePass(at("14:50"))).toEqual({ status: "COMPLETED", evaluated: [] }); // not due yet

    await orm.Run.where({ id: RUN }).update({ completedAt: at("15:20").toISOString() });
    const later = await warcraftLogsDiscoveryService.runDuePass(at("15:30"));
    expect(later).toMatchObject({ evaluated: [{ status: "MATCHED", linkedRuns: 1 }] });
    expect(await associations()).toHaveLength(1);
  });

  it("re-evaluating never duplicates the link or re-triggers an analyzed audit", async () => {
    await record();
    await warcraftLogsDiscoveryService.runDuePass(at("16:00"));
    await runConsumableAutoAuditService.runDuePass(at("16:01"));
    await warcraftLogsDiscoveryService.runDuePass(at("16:20"));
    expect(await associations()).toHaveLength(1);
    expect(await runConsumableAutoAuditService.runDuePass(at("16:30"))).toEqual({ status: "COMPLETED", due: 0, runs: [] });
  });

  it("a report WCL does not show (missing, private or not visible yet) is retried with backoff and only IGNORED after 3 days", async () => {
    metadataSpy.mockImplementation(async () => ({ status: "NOT_FOUND" }));
    await record();
    expect(await warcraftLogsDiscoveryService.runDuePass(at("16:00"))).toMatchObject({ evaluated: [{ status: "PENDING", outcome: "REPORT_NOT_FOUND" }] });
    expect(await discovery()).toMatchObject({ status: "PENDING", nextAttemptAt: at("16:15").toISOString() });
    // Visible a little later (e.g. WCL indexing): found and linked after all.
    metadataSpy.mockImplementation(async (code) => ({ status: "SUCCESS", report: metadata(code) }));
    expect(await warcraftLogsDiscoveryService.runDuePass(at("16:15"))).toMatchObject({ evaluated: [{ status: "MATCHED", linkedRuns: 1 }] });

    await clear();
    metadataSpy.mockImplementation(async () => ({ status: "NOT_FOUND" }));
    await record();
    await warcraftLogsDiscoveryService.runDuePass(at("16:00"));
    const afterHorizon = new Date("2026-09-23T15:00:00.000Z"); // posted 09-20 14:06 + 3 days
    expect(await warcraftLogsDiscoveryService.runDuePass(afterHorizon)).toMatchObject({ evaluated: [{ status: "IGNORED", outcome: "EXPIRED_REPORT_NOT_FOUND" }] });
    expect(await discovery()).toMatchObject({ status: "IGNORED", nextAttemptAt: null });

    await clear();
    metadataSpy.mockImplementation(async () => ({ status: "TEMPORARY_FAILURE", message: "down" }));
    await record();
    expect(await warcraftLogsDiscoveryService.runDuePass(at("16:00"))).toMatchObject({ evaluated: [{ status: "PENDING", outcome: "WCL_UNAVAILABLE" }] });
    expect(await discovery()).toMatchObject({ nextAttemptAt: at("16:15").toISOString() });
  });

  it("a report already linked (manually or from the Run channel) is MATCHED without a second link or an attempt reset", async () => {
    const fetched = await fetchReport(REPORT, { reuseCached: false, now: at("15:30") });
    if (!("report" in fetched)) throw new Error("report not stored");
    await runWarcraftLogsRepository.attachWithoutScan({ runId: RUN, reportId: fetched.report.id, createdById: null, source: "MANUAL", discordMessageId: null, discordAuthorId: null, now: at("15:30").toISOString() });
    // The Run channel's own scan uses the same link path: still one association.
    expect(await linkDiscoveredReport({ runId: RUN, reportId: fetched.report.id, discordMessageId: MESSAGE, discordAuthorId: LOG_BOT, now: at("15:31") })).toEqual({ created: false });
    await runConsumableAuditRepository.incrementAutoAttempts(RUN, at("15:40").toISOString());
    await runConsumableAuditRepository.incrementAutoAttempts(RUN, at("15:55").toISOString());

    await record();
    expect(await warcraftLogsDiscoveryService.runDuePass(at("16:00"))).toMatchObject({ evaluated: [{ status: "MATCHED", outcome: "LINKED", linkedRuns: 1 }] });
    expect((await associations()).map((a) => a.source)).toEqual(["MANUAL"]);
    const audit = await orm.RunConsumableAudit.where({ runId: RUN }).first();
    expect(audit).toMatchObject({ autoAttempts: 2 });
  });

  it("a new link does not bring the audit forward: not before completedAt + 15 min, then in the next tick", async () => {
    await record();
    // Run completed 15:20; discovery links at 15:25 — the audit still waits.
    expect(await warcraftLogsDiscoveryService.runDuePass(at("15:25"))).toMatchObject({ evaluated: [{ status: "MATCHED" }] });
    expect(await runConsumableAutoAuditService.runDuePass(at("15:25"))).toEqual({ status: "COMPLETED", due: 0, runs: [] });
    expect(await runConsumableAutoAuditService.runDuePass(at("15:36"))).toMatchObject({ runs: [{ runId: RUN, status: "ANALYZED" }] });
  });

  it("the same report in a second message links nothing twice", async () => {
    await record();
    await record({ messageId: snowflakeAtTime(at("14:30")) });
    await warcraftLogsDiscoveryService.runDuePass(at("16:00"));
    expect(await associations()).toHaveLength(1);
  });

  it("never runs two passes at once", async () => {
    const handle = await scheduledJobLockRepository.tryAcquireLock(WCL_DISCOVERY_LOCK_KEY.classId, WCL_DISCOVERY_LOCK_KEY.objectId);
    try {
      expect(await warcraftLogsDiscoveryService.runDuePass(at("16:00"))).toEqual({ status: "SKIPPED_ALREADY_RUNNING" });
    } finally {
      await scheduledJobLockRepository.releaseLock(handle!);
    }
  });
});
