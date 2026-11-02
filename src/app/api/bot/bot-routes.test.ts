import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { BotApiClient } from "@/discord-bot/bot-api-client";
import { anyContentRunInput } from "@/lib/test-run-input";
import { orm } from "@/lib/prisma";
import { raidRepository } from "@/repositories/raid.repository";
import { runService } from "@/services/run.service";
import { testActor } from "@/test/actors";
import { BOT_API_TEST_ORIGIN, botRequest, installBotApiToken, runRouteParams } from "@/test/bot-api";
import {
  assertIsolatedTestDatabase,
  createTestCharacter,
  createTestUser,
  deleteCreatedRows,
  syntheticDiscordId,
} from "@/test/db-fixtures";
import { CURRENT_WEEK_RUN_START, RAID_WEEK_TEST_CLOCK, freezeSystemTime, restoreSystemTime } from "@/test/time";

import { GET as syncGet } from "@/app/api/bot/discord/sync/route";
import { GET as mySignupsGet } from "@/app/api/bot/my-signups/route";
import { GET as signupOptionsGet } from "@/app/api/bot/runs/[runId]/signup-options/route";
import { PUT as signupPut } from "@/app/api/bot/runs/[runId]/signup/route";
import { POST as cancelPost } from "@/app/api/bot/runs/[runId]/signup/cancel/route";
import { POST as quickSignupPost } from "@/app/api/bot/runs/[runId]/signup/quick/route";
import { GET as rosterGet } from "@/app/api/bot/runs/[runId]/roster/route";
import { PUT as discordStatePut } from "@/app/api/bot/runs/[runId]/discord-state/route";

const TOKEN = "bot-api-test-token-0123456789";
const SYNC_PATH = "/api/bot/discord/sync";

const TARGET_DISCORD_ID = syntheticDiscordId();
const UNLINKED_DISCORD_ID = syntheticDiscordId();
const created = { runIds: [] as string[], characterIds: [] as string[], userIds: [] as string[] };

let leadId = "";
let targetId = "";
let runId = "";
let targetCharacterId = "";
let restoreToken = () => {};

function sync() {
  return syncGet(botRequest(SYNC_PATH, { token: TOKEN })).then((response) => response.json());
}

/** The target's Booster signup with their one Character as ranged DPS. */
function boosterSignupBody(characterId: string) {
  return { participationType: "BOOSTER", offers: [{ characterId, offeredRoles: ["RANGED_DPS"] }] };
}

function putTargetSignup(forRunId: string, body: unknown = boosterSignupBody(targetCharacterId)) {
  return signupPut(
    botRequest(`/api/bot/runs/${forRunId}/signup`, { method: "PUT", token: TOKEN, actingDiscordUserId: TARGET_DISCORD_ID, body }),
    runRouteParams(forRunId),
  );
}

function cancelTargetSignup() {
  return cancelPost(
    botRequest(`/api/bot/runs/${runId}/signup/cancel`, { method: "POST", token: TOKEN, actingDiscordUserId: TARGET_DISCORD_ID }),
    runRouteParams(runId),
  );
}

function quickSignup(options: { token?: string; actingDiscordUserId?: string } = { token: TOKEN, actingDiscordUserId: TARGET_DISCORD_ID }) {
  return quickSignupPost(botRequest(`/api/bot/runs/${runId}/signup/quick`, { method: "POST", ...options }), runRouteParams(runId));
}

function putDiscordState(body: unknown) {
  return discordStatePut(
    botRequest(`/api/bot/runs/${runId}/discord-state`, { method: "PUT", token: TOKEN, body }),
    runRouteParams(runId),
  );
}

async function runDiscordPost() {
  return (await orm.RunDiscordPost.where({ runId }).first()) as Record<string, unknown> | null;
}

/** An OPEN (or, with `open: false`, DRAFT) Heroic or Mythic Run led by the suite's Raid Lead. */
async function createLeadRun(options: { difficulty: "HEROIC" | "MYTHIC"; open: boolean }) {
  const lead = testActor(leadId, "RAID_LEAD");
  const run = await runService.createRun(
    lead,
    anyContentRunInput({ difficulty: options.difficulty, scheduledStartAt: CURRENT_WEEK_RUN_START }),
  );
  created.runIds.push(run.id);
  if (options.open) await runService.openRun(lead, run.id);
  return run.id;
}

async function setTargetBooster(isBooster: boolean) {
  await orm.User.where({ id: targetId }).update({ isBooster });
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  freezeSystemTime(RAID_WEEK_TEST_CLOCK, { advance: true });
  restoreToken = installBotApiToken(TOKEN);
  await raidRepository.ensureReferenceRaids();

  leadId = await createTestUser({ name: "Bot Api Lead", accountRole: "RAID_LEAD" });
  targetId = await createTestUser({ name: "Bot Api Target", discordUserId: TARGET_DISCORD_ID, isBooster: true });
  created.userIds.push(leadId, targetId);
  targetCharacterId = await createTestCharacter({
    userId: targetId,
    name: "Botapichar",
    realm: "Bot Api Lab",
    wowClass: "HUNTER",
    specialization: "Beast Mastery",
    primaryRole: "RANGED_DPS",
  });
  created.characterIds.push(targetCharacterId);

  runId = await createLeadRun({ difficulty: "HEROIC", open: true });
}, 60_000);

afterAll(async () => {
  try {
    await deleteCreatedRows(created);
  } finally {
    restoreToken();
    restoreSystemTime();
  }
}, 60_000);

describe("bot API authentication", () => {
  it("rejects a missing bot token", async () => {
    const res = await syncGet(botRequest(SYNC_PATH));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("rejects an invalid bot token", async () => {
    const res = await syncGet(botRequest(SYNC_PATH, { token: "wrong-token" }));
    expect(res.status).toBe(401);
  });

  it("accepts a valid bot token", async () => {
    const res = await syncGet(botRequest(SYNC_PATH, { token: TOKEN }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

/*
 * The exact key lists below are the wire contract with the Discord bot, a
 * separately deployed process that reads these items through the types in
 * src/discord-bot/bot-api-client.ts. A new or renamed field must be a
 * deliberate change on both sides.
 */
describe("GET /api/bot/discord/sync — channel reconciliation contract", () => {
  it("exposes a channels array alongside signups/roster/start, with exactly the fields the bot needs", async () => {
    const channelId = syntheticDiscordId();
    expect((await putDiscordState({ kind: "channel", channelId })).status).toBe(200);

    const work = await sync();
    expect(Array.isArray(work.data.channels)).toBe(true);
    expect(Array.isArray(work.data.start)).toBe(true);
    expect(Array.isArray(work.data.raidInvites)).toBe(true);
    expect(Array.isArray(work.data.notificationDms)).toBe(true);
    expect(Array.isArray(work.data.runAnnouncements)).toBe(true);
    const item = work.data.channels.find((entry: { runId: string }) => entry.runId === runId);
    expect(item).toMatchObject({
      existingRunChannelId: channelId,
      targetBucket: "CURRENT",
      desiredChannelName: expect.any(String),
    });
    // Sent as the database's timestamp text; the bot parses it with Date.
    expect(Date.parse(item.scheduledStartAt)).toBe(Date.parse(CURRENT_WEEK_RUN_START));
    expect(Object.keys(item).sort()).toEqual(
      [
        "archiveArtifactsNeeded",
        "archiveCloseMessageId",
        "archiveTranscriptMessageId",
        "desiredChannelName",
        "existingRunChannelId",
        "panelName",
        "pendingLifecycleAnnouncements",
        "raidLeadDiscordUserId",
        "raidLeadName",
        "retireChannel",
        "runId",
        "scanWarcraftLogs",
        "scheduledStartAt",
        "targetBucket",
        "warcraftLogsScanCursor",
      ].sort(),
    );
  });
});

describe("GET /api/bot/discord/sync — Schedule lane projection", () => {
  it("exposes exactly CURRENT + NEXT schedule work items on the wire", async () => {
    const work = await sync();
    expect(work.data.schedules.map((row: { bucket: string }) => row.bucket).sort()).toEqual(["CURRENT", "NEXT"]);
    for (const item of work.data.schedules) {
      expect(typeof item.desiredSignature).toBe("string");
      expect(typeof item.needsUpdate).toBe("boolean");
      expect(item.embed).toMatchObject({
        title: expect.any(String),
        description: expect.any(String),
        color: expect.any(Number),
      });
      expect(Object.keys(item).sort()).toEqual(
        [
          "bucket",
          "desiredSignature",
          "embed",
          "existingChannelId",
          "existingMessageId",
          "lastSignature",
          "needsUpdate",
        ].sort(),
      );
    }
  });
});

describe("GET /api/bot/discord/sync — Warcraft Logs configuration reaches the bot", () => {
  const LOG_AUTHOR_ID = syntheticDiscordId();
  const LOG_CHANNEL_ID = syntheticDiscordId();

  /** The bot's real API client, with fetch routed straight into the route handler. */
  function botClientAgainstRoute() {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) =>
      syncGet(new NextRequest(new URL(url), { method: init.method ?? "GET", headers: init.headers as HeadersInit })),
    );
    return new BotApiClient({ apiBaseUrl: BOT_API_TEST_ORIGIN, botApiToken: TOKEN });
  }
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("serializes the trusted author ids (deduplicated, malformed dropped) all the way into the bot's work", async () => {
    vi.stubEnv("DISCORD_WCL_REPORT_AUTHOR_IDS", `${LOG_AUTHOR_ID}, not-a-snowflake, ${LOG_AUTHOR_ID} 12`);
    const route = await sync();
    expect(route.data.warcraftLogsReportAuthorIds).toEqual([LOG_AUTHOR_ID]);
    const work = await botClientAgainstRoute().listSyncWork();
    expect(work.warcraftLogsReportAuthorIds).toEqual([LOG_AUTHOR_ID]);
  });

  it("an empty configuration disables it with an empty list", async () => {
    vi.stubEnv("DISCORD_WCL_REPORT_AUTHOR_IDS", "");
    vi.stubEnv("DISCORD_WCL_REPORT_CHANNEL_IDS", LOG_CHANNEL_ID);
    const work = await botClientAgainstRoute().listSyncWork();
    expect(work.warcraftLogsReportAuthorIds).toEqual([]);
    // No trusted author: no log channel is read either.
    expect(work.warcraftLogsReportChannels).toEqual([]);
  });

  it("serializes the dedicated log channels (malformed dropped) with their read position into the bot's work", async () => {
    vi.stubEnv("DISCORD_WCL_REPORT_AUTHOR_IDS", LOG_AUTHOR_ID);
    vi.stubEnv("DISCORD_WCL_REPORT_CHANNEL_IDS", `${LOG_CHANNEL_ID}, oops,${LOG_CHANNEL_ID}`);
    const work = await botClientAgainstRoute().listSyncWork();
    expect(work.warcraftLogsReportChannels).toHaveLength(1);
    expect(work.warcraftLogsReportChannels![0]).toMatchObject({ channelId: LOG_CHANNEL_ID });
    expect(work.warcraftLogsReportChannels![0]!.cursor).toMatch(/^\d{15,25}$/);
  });
});

describe("bot API acting-user resolution", () => {
  const signupOptions = (actingDiscordUserId?: string) =>
    signupOptionsGet(
      botRequest(`/api/bot/runs/${runId}/signup-options`, { token: TOKEN, actingDiscordUserId }),
      runRouteParams(runId),
    );

  it("rejects a request with no Discord user header", async () => {
    expect((await signupOptions()).status).toBe(401);
  });

  it("rejects an unknown Discord user id with a log-in-on-the-website hint", async () => {
    const res = await signupOptions(UNLINKED_DISCORD_ID);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("DISCORD_ACCOUNT_NOT_LINKED");
    expect(body.message).toMatch(/haven't logged in/);
    expect(body.message).toMatch(/\/dashboard and log in with Discord/);
  });

  it("resolves a known Discord user and returns their signup options", async () => {
    const res = await signupOptions(TARGET_DISCORD_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.booster.eligible.some((option: { characterId: string }) => option.characterId === targetCharacterId)).toBe(true);
  });

  it("ignores any userId supplied in the request body and always acts as the resolved Discord user", async () => {
    const spoofedUserId = crypto.randomUUID();
    const res = await putTargetSignup(runId, { userId: spoofedUserId, ...boosterSignupBody(targetCharacterId) });
    expect(res.status).toBe(200);

    const stored = (await orm.RunSignup.where({ runId, characterId: targetCharacterId }).first()) as { userId: string } | null;
    expect(stored?.userId).toBe(targetId);
    expect(await orm.RunSignup.where({ runId, userId: spoofedUserId }).first()).toBeNull();
  });
});

describe("bot API domain reuse", () => {
  afterEach(async () => {
    // Leaves the shared Run without an active signup; a 4xx when there is none is expected.
    await cancelTargetSignup();
  });

  it("preserves Character ownership: a request cannot offer another User's Character", async () => {
    const foreignCharacterId = await createTestCharacter({
      userId: leadId,
      name: "Botapiforeign",
      realm: "Bot Api Lab",
      wowClass: "HUNTER",
      specialization: "Beast Mastery",
      primaryRole: "RANGED_DPS",
    });
    created.characterIds.push(foreignCharacterId);

    const res = await putTargetSignup(runId, boosterSignupBody(foreignCharacterId));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("CHARACTER_NOT_OWNED");
    expect(await orm.RunSignup.where({ runId, characterId: foreignCharacterId }).first()).toBeNull();
  });

  it("enforces the account-level Booster role: accepted on any difficulty, refused once revoked", async () => {
    const mythicRunId = await createLeadRun({ difficulty: "MYTHIC", open: true });

    // The target's Booster role is not scoped by difficulty — a Mythic Run accepts it.
    expect((await putTargetSignup(mythicRunId)).status).toBe(200);

    await setTargetBooster(false);
    try {
      const refused = await putTargetSignup(mythicRunId);
      expect(refused.status).toBe(400);
      const body = await refused.json();
      expect(body.code).toBe("BOOSTER_ACCESS_REQUIRED");
    } finally {
      await setTargetBooster(true);
    }
  });

  it("preserves the signup window check", async () => {
    const draftRunId = await createLeadRun({ difficulty: "HEROIC", open: false });

    const res = await putTargetSignup(draftRunId);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("SIGNUP_CLOSED");
    expect(await orm.RunSignup.where({ runId: draftRunId }).first()).toBeNull();
  });

  it("rejects malformed input with a validation error", async () => {
    const res = await putTargetSignup(runId, { participationType: "NOT_A_TYPE", offers: "not-an-array" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("cancels an active signup and reflects it in /my-signups", async () => {
    expect((await putTargetSignup(runId)).status).toBe(200);
    expect((await cancelTargetSignup()).status).toBe(200);

    const mineRes = await mySignupsGet(botRequest("/api/bot/my-signups", { token: TOKEN, actingDiscordUserId: TARGET_DISCORD_ID }));
    const mine = await mineRes.json();
    expect(mine.data.withdrawn.some((item: { runId: string }) => item.runId === runId)).toBe(true);
  });
});

describe("POST /api/bot/runs/:runId/signup/quick", () => {
  afterEach(async () => {
    await cancelTargetSignup();
  });

  it("requires bot service auth and an acting Discord User", async () => {
    expect((await quickSignup({})).status).toBe(401);
    expect((await quickSignup({ token: TOKEN })).status).toBe(401);
    expect(await orm.RunSignup.where({ runId, userId: targetId, status: "PENDING" }).first()).toBeNull();
  });

  it("signs up the URL run and returns the result DTO", async () => {
    const res = await quickSignup();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // The target has one eligible Character, so nothing is skipped.
    expect(body.data).toMatchObject({
      runId,
      added: 1,
      alreadySigned: 0,
      skippedNoDefaultRole: 0,
      skippedIneligible: 0,
      skippedUnavailable: 0,
      skippedReservationConflict: 0,
      skippedInactive: 0,
    });

    const secondBody = await (await quickSignup()).json();
    expect(secondBody.data.added).toBe(0);
    expect(secondBody.data.alreadySigned).toBe(1);
  });

  it("refuses without the Booster role", async () => {
    await setTargetBooster(false);
    try {
      const res = await quickSignup();
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("BOOSTER_ACCESS_REQUIRED");
    } finally {
      await setTargetBooster(true);
    }
  });
});

describe("bot API roster and discord-state endpoints", () => {
  it("returns draft roster embed data when the roster is unpublished", async () => {
    const res = await rosterGet(botRequest(`/api/bot/runs/${runId}/roster`, { token: TOKEN }), runRouteParams(runId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.runId).toBe(runId);
    expect(body.data.publishedAt).toBeNull();
  });

  it("records discord-state and reflects it in the next sync pass", async () => {
    expect((await putTargetSignup(runId)).status).toBe(200);
    const hasSignupWork = (work: { data: { signups: Array<{ runId: string }> } }) =>
      work.data.signups.some((item) => item.runId === runId);

    expect(hasSignupWork(await sync())).toBe(true);
    const recorded = await putDiscordState({ kind: "signup", channelId: syntheticDiscordId(), messageId: syntheticDiscordId() });
    expect(recorded.status).toBe(200);
    expect(hasSignupWork(await sync())).toBe(false);
  });

  it("channel-gone clears only identity stored in that exact channel and requires a channelId", async () => {
    const signupChannelId = syntheticDiscordId();
    const signupMessageId = syntheticDiscordId();
    const signupIdentity = async () => {
      const row = await runDiscordPost();
      return { channelId: row?.signupChannelId ?? null, messageId: row?.signupMessageId ?? null };
    };

    expect((await putDiscordState({ kind: "signup", channelId: signupChannelId, messageId: signupMessageId })).status).toBe(200);

    expect((await putDiscordState({ kind: "channel-gone" })).status).toBe(400);
    expect((await putDiscordState({ kind: "channel-gone", channelId: syntheticDiscordId() })).status).toBe(200);
    expect(await signupIdentity()).toEqual({ channelId: signupChannelId, messageId: signupMessageId });

    expect((await putDiscordState({ kind: "channel-gone", channelId: signupChannelId })).status).toBe(200);
    expect(await signupIdentity()).toEqual({ channelId: null, messageId: null });
  });

  it("voice-channel records and clear-voice-channel exact-match clears the Run voice channel", async () => {
    const voiceChannelId = syntheticDiscordId();
    const voice = async () => (await runDiscordPost())?.voiceChannelId ?? null;

    expect((await putDiscordState({ kind: "voice-channel" })).status).toBe(400);
    expect((await putDiscordState({ kind: "voice-channel", channelId: voiceChannelId })).status).toBe(200);
    expect(await voice()).toBe(voiceChannelId);
    expect((await putDiscordState({ kind: "clear-voice-channel", channelId: syntheticDiscordId() })).status).toBe(200);
    expect(await voice()).toBe(voiceChannelId);
    expect((await putDiscordState({ kind: "clear-voice-channel", channelId: voiceChannelId })).status).toBe(200);
    expect(await voice()).toBeNull();
  });

  it("start records the Voice channel the Final Setup rendered (absent/null → none)", async () => {
    const start = { kind: "start", channelId: syntheticDiscordId(), messageId: syntheticDiscordId() };
    const voiceChannelId = syntheticDiscordId();
    const rendered = async () => (await runDiscordPost())?.lastStartVoiceChannelId ?? null;

    expect((await putDiscordState({ ...start, voiceChannelId })).status).toBe(200);
    expect(await rendered()).toBe(voiceChannelId);
    expect((await putDiscordState({ ...start, voiceChannelId: null })).status).toBe(200);
    expect(await rendered()).toBeNull();
    expect((await putDiscordState({ ...start, voiceChannelId })).status).toBe(200);
    // Older bots omit the field: their posts have no Voice line.
    expect((await putDiscordState(start)).status).toBe(200);
    expect(await rendered()).toBeNull();
    expect((await putDiscordState({ ...start, voiceChannelId: "" })).status).toBe(400);
  });
});
