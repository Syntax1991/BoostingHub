import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { NextRequest } from "next/server";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import {
  warcraftLogsApiClient,
  type WarcraftLogsReportFight,
  type WarcraftLogsReportMetadata,
} from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import { runConsumableAuditRepository } from "@/repositories/run-consumable-audit.repository";
import { runDiscordPostRepository } from "@/repositories/run-discord-post.repository";
import { runWarcraftLogsRepository } from "@/repositories/run-warcraft-logs.repository";
import { scheduledJobLockRepository } from "@/repositories/scheduled-job-lock.repository";
import { identityKey, type ConsumableAuditParticipant } from "@/domain/consumable-audit-extract";
import { CONSUMABLE_AUTO_AUDIT_POLICY, autoAuditState } from "@/domain/consumable-auto-audit-policy";
import { discordSyncService } from "@/services/discord-sync.service";
import {
  CONSUMABLE_AUTO_AUDIT_LOCK_KEY,
  runConsumableAutoAuditService,
} from "@/services/run-consumable-auto-audit.service";
import { runConsumableAuditService } from "@/services/run-consumable-audit.service";
import { runWarcraftLogsService } from "@/services/run-warcraft-logs.service";
import { POST as attachPost } from "@/app/api/bot/runs/[runId]/warcraft-logs/route";
import { POST as autoAuditPost } from "@/app/api/bot/warcraft-logs/auto-audit/route";
import { PUT as discordStatePut } from "@/app/api/bot/runs/[runId]/discord-state/route";
import { snowflakeAtTime } from "@/lib/discord-snowflake";
import { raidRepository } from "@/repositories/raid.repository";
import { attendanceService } from "@/services/attendance.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { testActor } from "@tests/fixtures/actors";
import {
  assertIsolatedTestDatabase,
  createTestCharacter,
  createTestUser,
  deleteCreatedRows,
  syntheticDiscordId,
} from "@tests/fixtures/db-fixtures";
import { freezeSystemTime, restoreSystemTime } from "@tests/fixtures/time";
import { venomousCreateInput } from "@tests/fixtures/test-run-input";
import { offerCharacter } from "@tests/helpers/signup-offers";

/**
 * Log bot → Run channel → report auto-linked → Run COMPLETED → automatic audit.
 * The suite builds its own Runs through the production lifecycle on one day:
 * RUN started 14:00 and completed 15:20 with three present Boosters (enough
 * for roster evidence, see rosterMinKnown), IN_PROGRESS_RUN with three others
 * started 16:30, OPEN_RUN still open. The wall clock (Date
 * only) stays frozen on that day, so run creation, start and completion stamp
 * exactly these instants.
 */
let RUN = "";
let IN_PROGRESS_RUN = "";
let OPEN_RUN = "";
const REPORT = "TestReportCode01";
/** A second report of the same Run (e.g. the log bot started a new one mid-run). */
const REPORT_2 = "TestReportCode04";
const TOKEN = "bot-api-test-token-wcl-0123456789";
const LOG_BOT = syntheticDiscordId();
const STRANGER = syntheticDiscordId();
const RUN_CHANNEL = syntheticDiscordId();
const IN_PROGRESS_CHANNEL = syntheticDiscordId();
const OTHER_CHANNEL = syntheticDiscordId();
const MESSAGE = syntheticDiscordId();
/** The log bot's message for REPORT_2. */
const SECOND_MESSAGE = syntheticDiscordId();
/** WCL encounter of The Venomous Abyss's first boss (Nek'zali the Soulcoiler). */
const ENCOUNTER_ID = 3470;

const at = (hhmm: string) => new Date(`2026-09-20T${hhmm}:00.000Z`);
const REPORT_START = at("14:05").getTime();

const created = { runIds: [] as string[], characterIds: [] as string[], userIds: [] as string[] };
let lead: AuthenticatedUser;
let admin: AuthenticatedUser;
let user: AuthenticatedUser;

let roster: Array<Extract<ConsumableAuditParticipant, { source: "ATTENDANCE" }>> = [];

function metadata(code: string = REPORT): WarcraftLogsReportMetadata {
  const players = roster.map((_, i) => i + 1);
  const fight = (id: number, clock: string, kill = true): WarcraftLogsReportFight => {
    const startTime = at(clock).getTime() - REPORT_START;
    return {
      id,
      encounterId: ENCOUNTER_ID,
      name: "Nek'zali the Soulcoiler",
      startTime,
      endTime: startTime + 300_000,
      kill,
      difficulty: 4,
      friendlyPlayers: players,
    };
  };
  return {
    code,
    title: "Test raid night",
    startTime: REPORT_START,
    endTime: at("15:30").getTime(),
    regionSlug: "EU",
    fights: code === REPORT_2 ? [fight(1, "14:50")] : [fight(1, "14:10", false), fight(2, "14:20")],
    actors: roster.map((p, i) => ({ id: i + 1, name: p.characterName, server: p.characterRealm, subType: "Mage" })),
    rankedCharacters: [],
  };
}

function req(url: string, init: { token?: string | null; body?: unknown } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (init.token !== null) headers.authorization = `Bearer ${init.token ?? TOKEN}`;
  return new NextRequest(new URL(url, "http://bot-api.test"), {
    method: "POST",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}
const params = (runId: string) => ({ params: Promise.resolve({ runId }) });
const body = (overrides: Record<string, unknown> = {}) => ({
  reportCode: REPORT,
  channelId: RUN_CHANNEL,
  messageId: MESSAGE,
  authorId: LOG_BOT,
  ...overrides,
});

let metadataSpy: MockInstance<typeof warcraftLogsApiClient.fetchReportMetadata>;
let eventsSpy: MockInstance<typeof warcraftLogsApiClient.fetchReportConsumableEvents>;

async function clear() {
  await orm.RunConsumableAudit.where((row) => row.runId.in([RUN, IN_PROGRESS_RUN])).deleteAndCount();
  await orm.RunWarcraftLogsReport.where((row) => row.runId.in([RUN, IN_PROGRESS_RUN])).deleteAndCount();
  await orm.WarcraftLogsReport.where((row) => row.code.in([REPORT, REPORT_2])).deleteAndCount();
}

async function createUser(name: string, accountRole: AuthenticatedUser["accountRole"], isBooster = false) {
  const id = await createTestUser({ name, accountRole, isBooster });
  created.userIds.push(id);
  return testActor(id, accountRole);
}

/** An open Venomous Run at `startClock` whose roster of `boosterNames` (one Frost Mage each) is published. */
async function publishedRun(startClock: string, boosterNames: string[]) {
  const run = await runService.createRun(
    lead,
    venomousCreateInput({ scheduledStartAt: at(startClock).toISOString(), desiredTankCount: 0, desiredHealerCount: 0, desiredDpsCount: boosterNames.length }),
  );
  created.runIds.push(run.id);
  await runService.openRun(lead, run.id);
  const signupIds: string[] = [];
  for (const name of boosterNames) {
    const booster = await createUser(`${name} Player`, "USER", true);
    const characterId = await createTestCharacter({
      userId: booster.id,
      name,
      realm: "Wcl Auto",
      wowClass: "MAGE",
      specialization: "Frost",
      primaryRole: "RANGED_DPS",
    });
    created.characterIds.push(characterId);
    signupIds.push(await offerCharacter(booster, run.id, characterId, "RANGED_DPS"));
  }
  const draft = await rosterService.getRosterManagementView(lead, run.id);
  await rosterService.saveDraftSelection(lead, {
    runId: run.id,
    version: draft.roster.version,
    selections: signupIds.map((signupId) => ({ signupId, selectedRole: "RANGED_DPS" as const })),
  });
  const ready = await rosterService.getRosterManagementView(lead, run.id);
  await rosterService.publishRoster(lead, { runId: run.id, version: ready.roster.version, acknowledgeWarnings: true });
  return run.id;
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  await raidRepository.ensureReferenceRaids();
  freezeSystemTime(at("10:00"), { advance: true });
  lead = await createUser("Wcl Auto Lead", "RAID_LEAD");
  admin = await createUser("Wcl Auto Admin", "ADMIN");
  user = await createUser("Wcl Auto User", "USER");

  RUN = await publishedRun("14:00", ["Wclfrosta", "Wclfrostb", "Wclfrostc"]);
  IN_PROGRESS_RUN = await publishedRun("16:00", ["Wclfrostd", "Wclfroste", "Wclfrostf"]);
  const open = await runService.createRun(lead, venomousCreateInput({ scheduledStartAt: at("20:00").toISOString() }));
  created.runIds.push(open.id);
  await runService.openRun(lead, open.id);
  OPEN_RUN = open.id;

  // Exact, non-advancing instants while stamping: start and completion are asserted to the millisecond.
  // Re-freezing alone would keep the previous advancing clock running.
  const stampAt = (clock: string) => {
    restoreSystemTime();
    freezeSystemTime(at(clock));
  };
  stampAt("14:00");
  await runService.startRun(lead, { runId: RUN });
  await attendanceService.markAllUnmarkedPresent(lead, RUN);
  stampAt("15:20");
  await runService.completeRun(lead, RUN);
  stampAt("16:30");
  await runService.startRun(lead, { runId: IN_PROGRESS_RUN });
  // From here on "now" is after both starts and RUN's completion.
  restoreSystemTime();
  freezeSystemTime(at("16:40"), { advance: true });

  roster = (await runConsumableAuditRepository.listParticipants(RUN)).filter(
    (row): row is Extract<ConsumableAuditParticipant, { source: "ATTENDANCE" }> => row.source === "ATTENDANCE",
  );
  // Unique actors per character identity.
  const seen = new Set<string>();
  roster = roster.filter((p) => {
    const key = identityKey(p.characterName, p.characterRealm);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  for (const [runId, channelId] of [
    [RUN, RUN_CHANNEL],
    [IN_PROGRESS_RUN, IN_PROGRESS_CHANNEL],
  ] as const) {
    await runDiscordPostRepository.recordRunChannel({ runId, channelId });
  }
}, 120_000);

// Runs cascade their Discord posts, start snapshots, attendance, report links, fights and audits.
afterAll(async () => {
  restoreSystemTime();
  await clear();
  await deleteCreatedRows(created);
}, 60_000);

beforeEach(async () => {
  await clear();
  vi.stubEnv("BOOSTINGHUB_BOT_API_TOKEN", TOKEN);
  vi.stubEnv("DISCORD_WCL_REPORT_AUTHOR_IDS", `${LOG_BOT}, not-a-snowflake`);
  vi.spyOn(warcraftLogsApiClient, "isConfigured").mockReturnValue(true);
  metadataSpy = vi
    .spyOn(warcraftLogsApiClient, "fetchReportMetadata")
    .mockImplementation(async (code) => ({ status: "SUCCESS", report: metadata(code) }));
  eventsSpy = vi.spyOn(warcraftLogsApiClient, "fetchReportConsumableEvents").mockImplementation(async (input) => ({
    status: "SUCCESS",
    events: {
      casts: [],
      deaths: [],
      combatants: input.fightIds.flatMap((fight) =>
        roster.map((_, i) => ({
          fight,
          timestamp: 0,
          sourceId: i + 1,
          auraIds: [1235108, 1285644],
          auraNames: { 1285644: "Hearty Well Fed" },
          // Enchanted head with an empty bonus socket; main hand with enchant + oil.
          gear: [
            { slot: 0, itemId: 271492, permanentEnchantId: 8017, temporaryEnchantId: null, gemIds: [], bonusIds: [13695] },
            { slot: 15, itemId: 265337, permanentEnchantId: 8039, temporaryEnchantId: 8052, gemIds: [], bonusIds: [] },
          ],
        })),
      ),
    },
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Bot API: log-bot report link in a Run channel", () => {
  it("requires the bot service token", async () => {
    const response = await attachPost(req(`/api/bot/runs/${RUN}/warcraft-logs`, { token: null, body: body() }), params(RUN));
    expect(response.status).toBe(401);
    expect(metadataSpy).not.toHaveBeenCalled();
  });

  it("ignores links from anyone but a configured log bot", async () => {
    const response = await attachPost(
      req(`/api/bot/runs/${RUN}/warcraft-logs`, { body: body({ authorId: STRANGER }) }),
      params(RUN),
    );
    expect(response.status).toBe(403);
    expect(metadataSpy).not.toHaveBeenCalled();
  });

  it("is off entirely when no log bot is configured", async () => {
    vi.stubEnv("DISCORD_WCL_REPORT_AUTHOR_IDS", "");
    const response = await attachPost(req(`/api/bot/runs/${RUN}/warcraft-logs`, { body: body() }), params(RUN));
    expect(response.status).toBe(403);
  });

  it("only accepts a link posted in this Run's own channel", async () => {
    const response = await attachPost(
      req(`/api/bot/runs/${RUN}/warcraft-logs`, { body: body({ channelId: OTHER_CHANNEL }) }),
      params(RUN),
    );
    expect(response.status).toBe(403);
    // Another Run's channel does not count either.
    const crossRun = await attachPost(
      req(`/api/bot/runs/${RUN}/warcraft-logs`, { body: body({ channelId: IN_PROGRESS_CHANNEL }) }),
      params(RUN),
    );
    expect(crossRun.status).toBe(403);
    expect(metadataSpy).not.toHaveBeenCalled();
  });

  it("links the report to a running Run without scanning fights, idempotently", async () => {
    const first = await attachPost(
      req(`/api/bot/runs/${IN_PROGRESS_RUN}/warcraft-logs`, { body: body({ channelId: IN_PROGRESS_CHANNEL }) }),
      params(IN_PROGRESS_RUN),
    );
    expect(await first.json()).toEqual({ ok: true, data: { status: "ATTACHED" } });
    const again = await attachPost(
      req(`/api/bot/runs/${IN_PROGRESS_RUN}/warcraft-logs`, { body: body({ channelId: IN_PROGRESS_CHANNEL }) }),
      params(IN_PROGRESS_RUN),
    );
    expect(await again.json()).toEqual({ ok: true, data: { status: "ALREADY_ATTACHED" } });
    expect(metadataSpy).toHaveBeenCalledTimes(1);

    const [association] = await runWarcraftLogsRepository.listAssociations(IN_PROGRESS_RUN);
    expect(association).toMatchObject({
      source: "DISCORD_BOT",
      discordMessageId: MESSAGE,
      createdByName: null,
      lastScannedAt: null,
    });
    expect(await runWarcraftLogsRepository.listRunFights(IN_PROGRESS_RUN)).toEqual([]);
  });

  it("refuses Runs that are not running or completed", async () => {
    await runDiscordPostRepository.recordRunChannel({ runId: OPEN_RUN, channelId: OTHER_CHANNEL });
    try {
      const response = await attachPost(
        req(`/api/bot/runs/${OPEN_RUN}/warcraft-logs`, { body: body({ channelId: OTHER_CHANNEL }) }),
        params(OPEN_RUN),
      );
      expect(response.status).toBe(409);
    } finally {
      await runDiscordPostRepository.clearRunChannel(OPEN_RUN);
    }
  });
});

describe("sync work tells the bot what to scan", () => {
  it("flags running/completed Run channels and lists trusted authors only when configured", async () => {
    const work = await discordSyncService.listSyncWork();
    expect(work.warcraftLogsReportAuthorIds).toEqual([LOG_BOT]);
    const item = work.channels.find((row) => row.runId === IN_PROGRESS_RUN);
    expect(item?.scanWarcraftLogs).toBe(true);

    vi.stubEnv("DISCORD_WCL_REPORT_AUTHOR_IDS", "");
    const off = await discordSyncService.listSyncWork();
    expect(off.warcraftLogsReportAuthorIds).toEqual([]);
    expect(off.channels.find((row) => row.runId === IN_PROGRESS_RUN)?.scanWarcraftLogs).toBe(false);
  });
});

describe("automatic Consumables Audit after completion", () => {
  async function botAttach() {
    await runWarcraftLogsService.attachFromDiscord(
      { runId: RUN, reportCode: REPORT, channelId: RUN_CHANNEL, messageId: MESSAGE, authorId: LOG_BOT },
      at("14:06"),
    );
  }

  it("waits for the delay, then scans and analyzes as a system action — once", async () => {
    await botAttach();
    const before = await runConsumableAutoAuditService.runDuePass(at("15:30"));
    expect(before).toEqual({ status: "COMPLETED", due: 0, runs: [] });

    const view = await runConsumableAuditService.getAuditView(
      admin,
      RUN,
    );
    expect(view.autoAudit).toEqual({ state: "SCHEDULED", dueAt: at("15:35").toISOString(), reason: "FIRST" });

    const pass = await runConsumableAutoAuditService.runDuePass(at("15:36"));
    expect(pass).toEqual({ status: "COMPLETED", due: 1, runs: [{ runId: RUN, status: "ANALYZED", fights: 2 }] });
    const audit = (await runConsumableAuditRepository.findByRunId(RUN))!;
    expect(audit).toMatchObject({ autoAnalyzed: true, analyzedByName: null, autoAttempts: 1, lastFailure: null });
    const fights = await runWarcraftLogsRepository.listRunFights(RUN);
    expect(fights.map((row) => [row.wclFightId, row.status, row.kill])).toEqual([
      [1, "ASSIGNED", false],
      [2, "ASSIGNED", true],
    ]);

    // Food and gear facts survive the database round trip.
    const analyzed = await runConsumableAuditService.getAuditView(
      admin,
      RUN,
    );
    const first = analyzed.snapshot!.players.find((row) => row.hasLogData)!;
    expect(first.food.status).toBe("PASS");
    expect(first.weaponEnhancement).toMatchObject({ status: "PASS", labels: ["Oil"], fightsChecked: 2 });
    expect(first.gear.enchants).toMatchObject({ status: "PASS", enchanted: 2, required: 2 });
    expect(first.gear.gems).toMatchObject({ status: "WARNING", filled: 0, sockets: 1, empty: [{ slotLabel: "Head" }] });

    // Already analyzed: never picked up again.
    expect(await runConsumableAutoAuditService.runDuePass(at("16:30"))).toEqual({ status: "COMPLETED", due: 0, runs: [] });
    expect(eventsSpy).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure every 15 min, then gives up (no endless WCL traffic)", async () => {
    await botAttach();
    metadataSpy.mockClear(); // the attach itself fetched the metadata once
    metadataSpy.mockImplementation(async () => ({ status: "TEMPORARY_FAILURE", message: "down" }));

    const first = await runConsumableAutoAuditService.runDuePass(at("15:36"));
    expect(first).toMatchObject({ runs: [{ runId: RUN, status: "FAILED", failure: "WCL_UNAVAILABLE", retryable: true }] });
    // Retry only after the retry delay.
    expect(await runConsumableAutoAuditService.runDuePass(at("15:40"))).toEqual({ status: "COMPLETED", due: 0, runs: [] });
    for (const clock of ["15:52", "16:08", "16:24"]) {
      expect(await runConsumableAutoAuditService.runDuePass(at(clock))).toMatchObject({
        runs: [{ runId: RUN, status: "FAILED", failure: "WCL_UNAVAILABLE" }],
      });
    }
    expect(await runConsumableAutoAuditService.runDuePass(at("17:30"))).toEqual({ status: "COMPLETED", due: 0, runs: [] });
    expect(metadataSpy).toHaveBeenCalledTimes(CONSUMABLE_AUTO_AUDIT_POLICY.maxAttempts);

    const audit = (await runConsumableAuditRepository.findByRunId(RUN))!;
    expect(audit).toMatchObject({ autoAttempts: CONSUMABLE_AUTO_AUDIT_POLICY.maxAttempts, analyzedAt: null });
    expect(
      autoAuditState({
        status: "COMPLETED",
        completedAt: at("15:20").toISOString(),
        latestReportAttachedAt: at("14:06").toISOString(),
        audit,
      }),
    ).toEqual({ state: "GAVE_UP", attempts: CONSUMABLE_AUTO_AUDIT_POLICY.maxAttempts, failure: "WCL_UNAVAILABLE" });
  });

  it("stops right away on a permanent failure (private or unknown report)", async () => {
    await botAttach();
    metadataSpy.mockClear(); // the attach itself fetched the metadata once
    metadataSpy.mockImplementation(async () => ({ status: "NOT_FOUND" }));
    expect(await runConsumableAutoAuditService.runDuePass(at("15:36"))).toMatchObject({
      runs: [{ runId: RUN, status: "FAILED", failure: "REPORT_NOT_FOUND", retryable: false }],
    });
    expect(await runConsumableAutoAuditService.runDuePass(at("16:30"))).toEqual({ status: "COMPLETED", due: 0, runs: [] });
    expect(metadataSpy).toHaveBeenCalledTimes(1);
  });

  it("waits while no report is linked, and audits a report that arrives after completion", async () => {
    // 15:20 COMPLETED, 15:35 due, but nothing linked yet: nothing happens and no attempt is spent.
    expect(await runConsumableAutoAuditService.runDuePass(at("15:36"))).toEqual({ status: "COMPLETED", due: 0, runs: [] });
    expect(await runConsumableAuditRepository.findByRunId(RUN)).toBeNull();

    // 15:45 the log bot's link is found (e.g. by the final pre-archive scan).
    const attached = await runWarcraftLogsService.attachFromDiscord(
      { runId: RUN, reportCode: REPORT, channelId: RUN_CHANNEL, messageId: MESSAGE, authorId: LOG_BOT },
      at("15:45"),
    );
    expect(attached).toEqual({ status: "ATTACHED" });
    expect(await runConsumableAutoAuditService.runDuePass(at("15:46"))).toEqual({
      status: "COMPLETED",
      due: 1,
      runs: [{ runId: RUN, status: "ANALYZED", fights: 2 }],
    });
  });

  it("re-audits when another report is linked after the analysis; the same report again is a no-op", async () => {
    await botAttach();
    await runConsumableAutoAuditService.runDuePass(at("15:36"));
    expect(eventsSpy).toHaveBeenCalledTimes(1);

    // Linking the same report again changes nothing.
    await botAttach();
    expect(await runConsumableAutoAuditService.runDuePass(at("15:59"))).toEqual({ status: "COMPLETED", due: 0, runs: [] });

    // 16:00 a second report appears, after the 15:36 analysis.
    await runWarcraftLogsService.attachFromDiscord(
      { runId: RUN, reportCode: REPORT_2, channelId: RUN_CHANNEL, messageId: SECOND_MESSAGE, authorId: LOG_BOT },
      at("16:00"),
    );
    const scheduled = autoAuditState({
      status: "COMPLETED",
      completedAt: at("15:20").toISOString(),
      latestReportAttachedAt: at("16:00").toISOString(),
      audit: (await runConsumableAuditRepository.findByRunId(RUN))!,
    });
    expect(scheduled).toEqual({ state: "SCHEDULED", dueAt: at("15:51").toISOString(), reason: "NEW_REPORT" });

    const pass = await runConsumableAutoAuditService.runDuePass(at("16:01"));
    expect(pass).toEqual({ status: "COMPLETED", due: 1, runs: [{ runId: RUN, status: "ANALYZED", fights: 3 }] });
    const audit = (await runConsumableAuditRepository.findByRunId(RUN))!;
    expect(audit).toMatchObject({ autoAnalyzed: true, autoAttempts: 1, lastFailure: null });
    const view = await runConsumableAuditService.getAuditView(admin, RUN);
    expect(view.stale).toBe(false);
    expect(view.snapshot?.fights.map((fight) => fight.reportCode).sort()).toEqual([REPORT, REPORT, REPORT_2].sort());
    expect(await runConsumableAutoAuditService.runDuePass(at("17:00"))).toEqual({ status: "COMPLETED", due: 0, runs: [] });
  });

  it("never runs two passes at once", async () => {
    const handle = await scheduledJobLockRepository.tryAcquireLock(
      CONSUMABLE_AUTO_AUDIT_LOCK_KEY.classId,
      CONSUMABLE_AUTO_AUDIT_LOCK_KEY.objectId,
    );
    try {
      expect(await runConsumableAutoAuditService.runDuePass(at("15:36"))).toEqual({ status: "SKIPPED_ALREADY_RUNNING" });
    } finally {
      await scheduledJobLockRepository.releaseLock(handle!);
    }
  });

  it("is reachable only with the bot token", async () => {
    const denied = await autoAuditPost(req("/api/bot/warcraft-logs/auto-audit", { token: "wrong" }));
    expect(denied.status).toBe(401);
    const ok = await autoAuditPost(req("/api/bot/warcraft-logs/auto-audit"));
    expect(ok.status).toBe(200);
  });
});

describe("autoAuditState", () => {
  const base = {
    status: "COMPLETED",
    completedAt: at("15:20").toISOString(),
    latestReportAttachedAt: at("14:06").toISOString(),
    audit: null,
  };
  type Failure = "WCL_UNAVAILABLE" | "REPORT_NOT_FOUND" | "NO_RELEVANT_FIGHTS" | null;
  const audit = (
    overrides: Partial<{ analyzedAt: string | null; autoAttempts: number; lastAttemptAt: string; lastFailure: Failure }> = {},
  ) => ({
    analyzedAt: null,
    autoAttempts: 1,
    lastAttemptAt: at("15:36").toISOString(),
    lastFailure: null,
    ...overrides,
  });

  it("applies only to completed Runs with a report, a completion time and no covering analysis", () => {
    expect(autoAuditState(base)).toEqual({ state: "SCHEDULED", dueAt: at("15:35").toISOString(), reason: "FIRST" });
    expect(autoAuditState({ ...base, status: "IN_PROGRESS" })).toBeNull();
    expect(autoAuditState({ ...base, completedAt: null })).toBeNull();
    expect(autoAuditState({ ...base, latestReportAttachedAt: null })).toBeNull();
    expect(autoAuditState({ ...base, audit: audit({ analyzedAt: at("15:36").toISOString() }) })).toBeNull();
    // Beyond the lookback window nothing is scheduled any more.
    expect(autoAuditState({ ...base, now: new Date(at("15:20").getTime() + 4 * 86_400_000) })).toBeNull();
  });

  it("a report linked after the analysis schedules a re-analysis, spaced from the last attempt", () => {
    expect(
      autoAuditState({
        ...base,
        latestReportAttachedAt: at("15:40").toISOString(),
        audit: audit({ analyzedAt: at("15:36").toISOString(), autoAttempts: 0 }),
      }),
    ).toEqual({ state: "SCHEDULED", dueAt: at("15:51").toISOString(), reason: "NEW_REPORT" });
  });

  it("retries transient failures up to the attempt budget; permanent ones stop at once", () => {
    expect(
      autoAuditState({ ...base, audit: audit({ lastFailure: "NO_RELEVANT_FIGHTS", autoAttempts: 3 }) }),
    ).toMatchObject({ state: "SCHEDULED" });
    expect(autoAuditState({ ...base, audit: audit({ lastFailure: "WCL_UNAVAILABLE", autoAttempts: 4 }) })).toEqual({
      state: "GAVE_UP",
      attempts: 4,
      failure: "WCL_UNAVAILABLE",
    });
    expect(autoAuditState({ ...base, audit: audit({ lastFailure: "REPORT_NOT_FOUND", autoAttempts: 1 }) })).toEqual({
      state: "GAVE_UP",
      attempts: 1,
      failure: "REPORT_NOT_FOUND",
    });
    // A manager's own failed attempt (no automatic attempt yet) never blocks the first automatic one.
    expect(
      autoAuditState({ ...base, audit: audit({ lastFailure: "REPORT_NOT_FOUND", autoAttempts: 0 }) }),
    ).toMatchObject({ state: "SCHEDULED" });
  });
});

describe("durable scan cursor", () => {
  it("is seeded from the Run start, then only moves forward and only for the Run's own channel", async () => {
    const work = await discordSyncService.listSyncWork();
    const item = work.channels.find((row) => row.runId === RUN)!;
    // No stored cursor yet: a snowflake at Run start (14:00) minus 10 minutes.
    expect(item.warcraftLogsScanCursor).toBe(snowflakeAtTime(at("13:50")));

    const put = (messageId: string, channelId = RUN_CHANNEL) =>
      discordStatePut(
        new NextRequest(new URL(`/api/bot/runs/${RUN}/discord-state`, "http://bot-api.test"), {
          method: "PUT",
          headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
          body: JSON.stringify({ kind: "wcl-scan-cursor", channelId, messageId }),
        }),
        params(RUN),
      );
    try {
      expect((await put("1300000000000000000")).status).toBe(200);
      expect((await runDiscordPostRepository.findByRunId(RUN))?.warcraftLogsScanCursor).toBe("1300000000000000000");
      await put("999999999999999999"); // older (shorter) id: ignored, never moves back
      await put("1400000000000000000", OTHER_CHANNEL); // not this Run's channel: ignored
      expect((await runDiscordPostRepository.findByRunId(RUN))?.warcraftLogsScanCursor).toBe("1300000000000000000");
      const next = (await discordSyncService.listSyncWork()).channels.find((row) => row.runId === RUN)!;
      expect(next.warcraftLogsScanCursor).toBe("1300000000000000000");
    } finally {
      await orm.RunDiscordPost.where({ runId: RUN }).update({ warcraftLogsScanCursor: null });
    }
  });
});

describe("attach metadata and retry semantics", () => {
  it("records the trusted author and message; tells the bot which failures to retry", async () => {
    const input = { runId: RUN, reportCode: REPORT, channelId: RUN_CHANNEL, messageId: MESSAGE, authorId: LOG_BOT };
    expect(await runWarcraftLogsService.attachFromDiscord(input, at("14:06"))).toEqual({ status: "ATTACHED" });
    expect((await runWarcraftLogsRepository.listAssociations(RUN))[0]).toMatchObject({
      source: "DISCORD_BOT",
      discordMessageId: MESSAGE,
      discordAuthorId: LOG_BOT,
    });
    await clear();

    metadataSpy.mockResolvedValueOnce({ status: "TEMPORARY_FAILURE", message: "down" });
    await expect(runWarcraftLogsService.attachFromDiscord(input, at("14:07"))).resolves.toEqual({
      status: "FAILED",
      failure: "WCL_UNAVAILABLE",
      retryable: true,
    });
    metadataSpy.mockResolvedValueOnce({ status: "NOT_FOUND" });
    await expect(runWarcraftLogsService.attachFromDiscord(input, at("14:08"))).resolves.toEqual({
      status: "FAILED",
      failure: "REPORT_NOT_FOUND",
      retryable: false,
    });
    expect(await runWarcraftLogsRepository.listAssociations(RUN)).toEqual([]);
  });
});

describe("automatic audit failure safety", () => {
  const botAttach = () =>
    runWarcraftLogsService.attachFromDiscord(
      { runId: RUN, reportCode: REPORT, channelId: RUN_CHANNEL, messageId: MESSAGE, authorId: LOG_BOT },
      at("14:06"),
    );

  it("a failed report refresh or analysis keeps the association and fight assignment", async () => {
    await botAttach();
    eventsSpy.mockResolvedValue({ status: "TEMPORARY_FAILURE", message: "down" });
    const pass = await runConsumableAutoAuditService.runDuePass(at("15:36"));
    expect(pass).toMatchObject({ runs: [{ runId: RUN, status: "FAILED", failure: "WCL_UNAVAILABLE" }] });
    const fightsAfterAnalysisFailure = await runWarcraftLogsRepository.listRunFights(RUN);
    expect(fightsAfterAnalysisFailure.filter((row) => row.status === "ASSIGNED")).toHaveLength(2);

    metadataSpy.mockResolvedValue({ status: "TEMPORARY_FAILURE", message: "down" });
    await runConsumableAutoAuditService.runDuePass(at("15:52"));
    expect(await runWarcraftLogsRepository.listAssociations(RUN)).toHaveLength(1);
    expect(await runWarcraftLogsRepository.listRunFights(RUN)).toEqual(fightsAfterAnalysisFailure);
    expect(await runConsumableAuditRepository.findByRunId(RUN)).toMatchObject({
      analyzedAt: null,
      autoAttempts: 2,
      lastFailure: "WCL_UNAVAILABLE",
    });
  });

  it("ambiguous fights stay NEEDS_REVIEW and are excluded from the automatic audit", async () => {
    // Another started Run with the same content overlaps the second fight: IN_PROGRESS_RUN, moved to a 14:15 start.
    const snapshot = (await orm.RunStartSnapshot.where({ runId: IN_PROGRESS_RUN }).first()) as { id: string; startedAt: string };
    await orm.RunStartSnapshot.where({ id: snapshot.id }).update({ startedAt: at("14:15").toISOString() });
    // Unknown participants on the overlapping fight: roster evidence cannot decide.
    metadataSpy.mockImplementation(async () => {
      const report = metadata();
      report.fights[1] = { ...report.fights[1]!, friendlyPlayers: null };
      return { status: "SUCCESS", report };
    });
    try {
      await botAttach();
      const pass = await runConsumableAutoAuditService.runDuePass(at("15:36"));
      expect(pass).toMatchObject({ runs: [{ runId: RUN, status: "ANALYZED", fights: 1 }] });
      const fights = await runWarcraftLogsRepository.listRunFights(RUN);
      expect(fights.map((row) => [row.wclFightId, row.status])).toEqual([
        [1, "ASSIGNED"],
        [2, "NEEDS_REVIEW"],
      ]);
      expect(eventsSpy.mock.calls.at(-1)![0].fightIds).toEqual([1]);
    } finally {
      await orm.RunStartSnapshot.where({ id: snapshot.id }).update({ startedAt: snapshot.startedAt });
    }
  });

  it("ignores Runs completed outside the 3-day window", async () => {
    await botAttach();
    const fourDaysLater = new Date(at("15:20").getTime() + 4 * 24 * 3_600_000);
    expect(await runConsumableAutoAuditService.runDuePass(fourDaysLater)).toEqual({ status: "COMPLETED", due: 0, runs: [] });
    expect(metadataSpy).toHaveBeenCalledTimes(1); // only the attach
  });
});

describe("manual fallback converges with the Discord path", () => {
  it("a manager can link the same report manually; both paths share one report, association and audit", async () => {
    await runWarcraftLogsService.attachFromDiscord(
      { runId: RUN, reportCode: REPORT, channelId: RUN_CHANNEL, messageId: MESSAGE, authorId: LOG_BOT },
      at("14:06"),
    );
    const manual = await runWarcraftLogsService.attachReport(admin, { runId: RUN, reportCode: REPORT }, at("15:40"));
    expect(manual).toEqual({ status: "ATTACHED", summary: { assigned: 2, needsReview: 0, ignored: 0 } });
    const associations = await runWarcraftLogsRepository.listAssociations(RUN);
    expect(associations).toHaveLength(1);
    expect(associations[0]!.source).toBe("DISCORD_BOT"); // first link wins; never duplicated
    expect(await orm.WarcraftLogsReport.where({ code: REPORT }).all()).toHaveLength(1);

    await runConsumableAuditService.analyze(admin, { runId: RUN }, () => at("15:41"), { skipCooldown: true });
    // Manually analyzed: the automatic audit leaves it alone.
    expect(await runConsumableAutoAuditService.runDuePass(at("15:50"))).toEqual({ status: "COMPLETED", due: 0, runs: [] });
  });

  it("never replaces a manually linked report: the same link is a no-op, another one is added alongside", async () => {
    await runWarcraftLogsService.attachReport(admin, { runId: RUN, reportCode: REPORT }, at("15:40"));
    await runConsumableAuditService.analyze(admin, { runId: RUN }, () => at("15:41"), { skipCooldown: true });
    const analyzed = (await runConsumableAuditRepository.findByRunId(RUN))!;

    // The log bot posts the report the manager already linked.
    const same = await runWarcraftLogsService.attachFromDiscord(
      { runId: RUN, reportCode: REPORT, channelId: RUN_CHANNEL, messageId: MESSAGE, authorId: LOG_BOT },
      at("15:45"),
    );
    expect(same).toEqual({ status: "ALREADY_ATTACHED" });
    expect((await runWarcraftLogsRepository.listAssociations(RUN)).map((row) => [row.report.code, row.source])).toEqual([
      [REPORT, "MANUAL"],
    ]);
    expect(await runConsumableAuditRepository.findByRunId(RUN)).toEqual(analyzed);

    // A different report is added next to it; the manual one and its fight assignment stay untouched.
    const other = await runWarcraftLogsService.attachFromDiscord(
      { runId: RUN, reportCode: REPORT_2, channelId: RUN_CHANNEL, messageId: SECOND_MESSAGE, authorId: LOG_BOT },
      at("15:46"),
    );
    expect(other).toEqual({ status: "ATTACHED" });
    const associations = await runWarcraftLogsRepository.listAssociations(RUN);
    expect(associations.map((row) => [row.report.code, row.source]).sort()).toEqual(
      [
        [REPORT, "MANUAL"],
        [REPORT_2, "DISCORD_BOT"],
      ].sort(),
    );
    const fights = await runWarcraftLogsRepository.listRunFights(RUN);
    expect(fights.filter((row) => row.status === "ASSIGNED").map((row) => row.reportCode)).toEqual([REPORT, REPORT]);
  });

  it("works without the bot at all, and a USER can use none of it", async () => {
    await expect(
      runWarcraftLogsService.attachReport(admin, { runId: RUN, reportCode: REPORT }, at("15:40")),
    ).resolves.toMatchObject({ status: "ATTACHED" });
    for (const call of [
      () => runWarcraftLogsService.attachReport(user, { runId: RUN, reportCode: REPORT }, at("15:45")),
      () => runWarcraftLogsService.rescan(user, { runId: RUN }, at("15:45")),
      () => runConsumableAuditService.getAuditView(user, RUN),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    }
  });
});
