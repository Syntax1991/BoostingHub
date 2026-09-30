import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BotApiClient } from "@/discord-bot/bot-api-client";
import { NextRequest } from "next/server";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { raidRepository } from "@/repositories/raid.repository";
import { runService } from "@/services/run.service";
import { venomousCreateInput } from "@/lib/test-run-input";
import type { AuthenticatedUser } from "@/auth/authorization";

import { GET as syncGet } from "@/app/api/bot/discord/sync/route";
import { GET as mySignupsGet } from "@/app/api/bot/my-signups/route";
import { GET as signupOptionsGet } from "@/app/api/bot/runs/[runId]/signup-options/route";
import { PUT as signupPut } from "@/app/api/bot/runs/[runId]/signup/route";
import { POST as cancelPost } from "@/app/api/bot/runs/[runId]/signup/cancel/route";
import { POST as quickSignupPost } from "@/app/api/bot/runs/[runId]/signup/quick/route";
import { GET as rosterGet } from "@/app/api/bot/runs/[runId]/roster/route";
import { PUT as discordStatePut } from "@/app/api/bot/runs/[runId]/discord-state/route";

const TOKEN = "bot-api-test-token-0123456789";
const ids = {
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-ba0000000001",
  target: "aaaaaaaa-aaaa-4aaa-8aaa-ba0000000002",
};
const createdUserIds = Object.values(ids);
const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];
const TARGET_DISCORD_ID = "999888777666555444";

function req(url: string, init?: { method?: string; headers?: Record<string, string>; body?: unknown }): NextRequest {
  return new NextRequest(new URL(url, "http://bot-api.test"), {
    method: init?.method ?? "GET",
    headers: init?.headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

function params(runId: string) {
  return { params: Promise.resolve({ runId }) };
}

async function createTestUser(id: string, name: string, discordUserId: string | null, accountRole: AuthenticatedUser["accountRole"]) {
  await orm.User.create({
    id,
    name,
    email: `${id}@botapi.boostting.local`,
    emailVerified: true,
    discordUserId,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function deleteIfPresent(table: string, id: string) {
  try {
    if (table === "User") await orm.User.where({ id }).delete();
    else if (table === "Character") await orm.Character.where({ id }).delete();
    else if (table === "RunSignup") await orm.RunSignup.where({ id }).delete();
    else if (table === "Run") await orm.Run.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

// Small default offset: guaranteed to classify CURRENT or NEXT regardless of
// where "now" falls in the current raid-ID week (see wow-run-week.ts — the
// minimum reach into NEXT from any point in CURRENT is always > 7 days), so
// these fixtures stay eligible for first-channel provisioning no matter when
// the suite actually runs.
function futureIso(days = 2) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function cleanupRun(runId: string) {
  await orm.RunDiscordPost.where({ runId }).delete().catch(() => {});
  const roster = await orm.RunRoster.where({ runId }).first();
  if (roster) {
    const rosterId = (roster as { id: string }).id;
    const entries = await orm.RunRosterEntry.where({ rosterId }).all();
    for (const entry of entries) {
      await orm.RunRosterEntry.where({ id: (entry as { id: string }).id }).delete();
    }
    await orm.RunRoster.where({ id: rosterId }).delete();
  }
  const signups = await orm.RunSignup.where({ runId }).select("id").all();
  for (const row of signups) {
    await deleteIfPresent("RunSignup", (row as { id: string }).id);
  }
  await deleteIfPresent("Run", runId);
}

let runId = "";
let targetCharacterId = "";
let originalToken: string | undefined;

beforeAll(async () => {
  originalToken = process.env.BOOSTINGHUB_BOT_API_TOKEN;
  process.env.BOOSTINGHUB_BOT_API_TOKEN = TOKEN;

  await raidRepository.ensureReferenceRaids();
  for (const userId of createdUserIds) {
    const runs = await orm.Run.where({ raidLeadId: userId }).select("id").all();
    for (const row of runs) {
      await cleanupRun((row as { id: string }).id);
    }
    const chars = await orm.Character.where({ userId }).select("id").all();
    for (const row of chars) {
      await deleteIfPresent("Character", (row as { id: string }).id);
    }
    await deleteIfPresent("User", userId);
  }

  await createTestUser(ids.lead, "Bot Api Lead", null, "RAID_LEAD");
  await createTestUser(ids.target, "Bot Api Target", TARGET_DISCORD_ID, "USER");

  targetCharacterId = crypto.randomUUID();
  createdCharacterIds.push(targetCharacterId);
  await orm.Character.create({
    id: targetCharacterId,
    userId: ids.target,
    name: "Botapichar",
    realm: "Bot Api Lab",
    normalizedName: normalizeCharacterIdentity("Botapichar"),
    normalizedRealm: normalizeCharacterIdentity("Bot Api Lab"),
    region: "EU",
    wowClass: "HUNTER",
    specialization: "Beast Mastery",
    primaryRole: "DPS",
    itemLevel: 700,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await orm.User.where({ id: ids.target }).update({ isBooster: true });

  const lead: AuthenticatedUser = {
    id: ids.lead,
    name: "Bot Api Lead",
    email: null,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole: "RAID_LEAD",
    accountStatus: "ACTIVE",
  };
  runId = await runService
    .createRun(lead, venomousCreateInput({ difficulty: "HEROIC", lootType: "UNSAVED", venomousPlannedBossCount: 8, scheduledStartAt: futureIso(), desiredTankCount: 1, desiredHealerCount: 1, desiredDpsCount: 2 }))
    .then((run) => run.id);
  createdRunIds.push(runId);
  await runService.openRun(lead, runId);
}, 60_000);

afterAll(async () => {
  for (const id of createdRunIds) {
    await cleanupRun(id);
  }
  for (const id of createdCharacterIds) {
    await deleteIfPresent("Character", id);
  }
  for (const id of createdUserIds) {
    await deleteIfPresent("User", id);
  }
  if (originalToken === undefined) {
    delete process.env.BOOSTINGHUB_BOT_API_TOKEN;
  } else {
    process.env.BOOSTINGHUB_BOT_API_TOKEN = originalToken;
  }
}, 60_000);

describe("bot API authentication", () => {
  it("rejects a missing bot token", async () => {
    const res = await syncGet(req("/api/bot/discord/sync"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("rejects an invalid bot token", async () => {
    const res = await syncGet(req("/api/bot/discord/sync", { headers: { authorization: "Bearer wrong-token" } }));
    expect(res.status).toBe(401);
  });

  it("accepts a valid bot token", async () => {
    const res = await syncGet(req("/api/bot/discord/sync", { headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe("GET /api/bot/discord/sync — channel reconciliation contract", () => {
  it("exposes a channels array alongside signups/roster/start, with exactly the fields the bot needs", async () => {
    const record = await discordStatePut(
      req(`/api/bot/runs/${runId}/discord-state`, {
        method: "PUT",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: { kind: "channel", channelId: "contract-chan-1" },
      }),
      params(runId),
    );
    expect(record.status).toBe(200);

    const sync = await syncGet(req("/api/bot/discord/sync", { headers: { authorization: `Bearer ${TOKEN}` } })).then((r) =>
      r.json(),
    );
    expect(Array.isArray(sync.data.channels)).toBe(true);
    expect(Array.isArray(sync.data.start)).toBe(true);
    expect(Array.isArray(sync.data.raidInvites)).toBe(true);
    expect(Array.isArray(sync.data.notificationDms)).toBe(true);
    expect(Array.isArray(sync.data.runAnnouncements)).toBe(true);
    const item = sync.data.channels.find((entry: { runId: string }) => entry.runId === runId);
    expect(item).toBeTruthy();
    expect(item.existingRunChannelId).toBe("contract-chan-1");
    expect(typeof item.desiredChannelName).toBe("string");
    expect(["CURRENT", "NEXT", "ARCHIVE"]).toContain(item.targetBucket);
    expect(typeof item.scheduledStartAt).toBe("string");
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
    const sync = await syncGet(req("/api/bot/discord/sync", { headers: { authorization: `Bearer ${TOKEN}` } })).then((r) =>
      r.json(),
    );
    expect(Array.isArray(sync.data.schedules)).toBe(true);
    expect(sync.data.schedules).toHaveLength(2);
    expect(sync.data.schedules.map((row: { bucket: string }) => row.bucket).sort()).toEqual(["CURRENT", "NEXT"]);
    for (const item of sync.data.schedules) {
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
  const LOG_AUTHOR = "1554176548435918910";
  /** The bot's real API client, with fetch routed straight into the route handler. */
  function botClientAgainstRoute() {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) =>
      syncGet(new NextRequest(new URL(url), { method: init.method ?? "GET", headers: init.headers as HeadersInit })),
    );
    return new BotApiClient({ apiBaseUrl: "http://bot-api.test", botApiToken: TOKEN });
  }
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("serializes the trusted author ids (deduplicated, malformed dropped) all the way into the bot's work", async () => {
    vi.stubEnv("DISCORD_WCL_REPORT_AUTHOR_IDS", `${LOG_AUTHOR}, not-a-snowflake, ${LOG_AUTHOR} 12`);
    const route = await syncGet(req("/api/bot/discord/sync", { headers: { authorization: `Bearer ${TOKEN}` } })).then((r) =>
      r.json(),
    );
    expect(route.data.warcraftLogsReportAuthorIds).toEqual([LOG_AUTHOR]);
    const work = await botClientAgainstRoute().listSyncWork();
    expect(work.warcraftLogsReportAuthorIds).toEqual([LOG_AUTHOR]);
  });

  it("an empty configuration disables it with an empty list", async () => {
    vi.stubEnv("DISCORD_WCL_REPORT_AUTHOR_IDS", "");
    vi.stubEnv("DISCORD_WCL_REPORT_CHANNEL_IDS", "1553838853834674226");
    const work = await botClientAgainstRoute().listSyncWork();
    expect(work.warcraftLogsReportAuthorIds).toEqual([]);
    // No trusted author: no log channel is read either.
    expect(work.warcraftLogsReportChannels).toEqual([]);
  });

  it("serializes the dedicated log channels (malformed dropped) with their read position into the bot's work", async () => {
    vi.stubEnv("DISCORD_WCL_REPORT_AUTHOR_IDS", LOG_AUTHOR);
    vi.stubEnv("DISCORD_WCL_REPORT_CHANNEL_IDS", "1553838853834674226, oops,1553838853834674226");
    const work = await botClientAgainstRoute().listSyncWork();
    expect(work.warcraftLogsReportChannels).toHaveLength(1);
    expect(work.warcraftLogsReportChannels![0]).toMatchObject({ channelId: "1553838853834674226" });
    expect(work.warcraftLogsReportChannels![0]!.cursor).toMatch(/^\d{15,25}$/);
  });
});

describe("bot API acting-user resolution", () => {
  it("rejects a request with no Discord user header", async () => {
    const res = await signupOptionsGet(
      req(`/api/bot/runs/${runId}/signup-options`, { headers: { authorization: `Bearer ${TOKEN}` } }),
      params(runId),
    );
    expect(res.status).toBe(401);
  });

  it("rejects an unknown Discord user id", async () => {
    const res = await signupOptionsGet(
      req(`/api/bot/runs/${runId}/signup-options`, {
        headers: { authorization: `Bearer ${TOKEN}`, "x-discord-user-id": "0000000000000000000" },
      }),
      params(runId),
    );
    expect(res.status).toBe(404);
  });

  it("resolves a known Discord user and returns their signup options", async () => {
    const res = await signupOptionsGet(
      req(`/api/bot/runs/${runId}/signup-options`, {
        headers: { authorization: `Bearer ${TOKEN}`, "x-discord-user-id": TARGET_DISCORD_ID },
      }),
      params(runId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.booster.eligible.some((option: { characterId: string }) => option.characterId === targetCharacterId)).toBe(true);
  });

  it("ignores any userId supplied in the request body and always acts as the resolved Discord user", async () => {
    const res = await signupPut(
      req(`/api/bot/runs/${runId}/signup`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "x-discord-user-id": TARGET_DISCORD_ID,
          "content-type": "application/json",
        },
        body: {
          userId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000099",
          participationType: "BOOSTER",
          offers: [{ characterId: targetCharacterId, offeredRoles: ["DPS"] }],
        },
      }),
      params(runId),
    );
    expect(res.status).toBe(200);

    const stored = await orm.RunSignup.where({ runId, characterId: targetCharacterId }).first();
    expect((stored as { userId: string } | null)?.userId).toBe(ids.target);
  });
});

describe("bot API domain reuse", () => {
  afterEach(async () => {
    await cancelPost(
      req(`/api/bot/runs/${runId}/signup/cancel`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "x-discord-user-id": TARGET_DISCORD_ID },
      }),
      params(runId),
    ).catch(() => {});
  });

  it("preserves Character ownership: a request cannot offer another User's Character", async () => {
    const foreignCharacterId = crypto.randomUUID();
    createdCharacterIds.push(foreignCharacterId);
    await orm.Character.create({
      id: foreignCharacterId,
      userId: ids.lead,
      name: "Botapiforeign",
      realm: "Bot Api Lab",
      normalizedName: normalizeCharacterIdentity("Botapiforeign"),
      normalizedRealm: normalizeCharacterIdentity("Bot Api Lab"),
      region: "EU",
      wowClass: "HUNTER",
      specialization: "Beast Mastery",
      primaryRole: "DPS",
      itemLevel: 700,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const res = await signupPut(
      req(`/api/bot/runs/${runId}/signup`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "x-discord-user-id": TARGET_DISCORD_ID,
          "content-type": "application/json",
        },
        body: { participationType: "BOOSTER", offers: [{ characterId: foreignCharacterId, offeredRoles: ["DPS"] }] },
      }),
      params(runId),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("CHARACTER_NOT_OWNED");
  });

  it("enforces the account-level Booster role: accepted on any difficulty, refused once revoked", async () => {
    const mythicLead: AuthenticatedUser = {
      id: ids.lead,
      name: "Bot Api Lead",
      email: null,
      image: null,
      discordUserId: null,
      discordUsername: null,
      accountRole: "RAID_LEAD",
      accountStatus: "ACTIVE",
    };
    const mythicRun = await runService.createRun(mythicLead, venomousCreateInput({ difficulty: "MYTHIC", lootType: "UNSAVED", venomousPlannedBossCount: 8, scheduledStartAt: futureIso(), desiredTankCount: 1, desiredHealerCount: 1, desiredDpsCount: 2 }));
    createdRunIds.push(mythicRun.id);
    await runService.openRun(mythicLead, mythicRun.id);

    const put = () =>
      signupPut(
        req(`/api/bot/runs/${mythicRun.id}/signup`, {
          method: "PUT",
          headers: {
            authorization: `Bearer ${TOKEN}`,
            "x-discord-user-id": TARGET_DISCORD_ID,
            "content-type": "application/json",
          },
          body: { participationType: "BOOSTER", offers: [{ characterId: targetCharacterId, offeredRoles: ["DPS"] }] },
        }),
        params(mythicRun.id),
      );

    // The target's Booster role is not scoped by difficulty — a Mythic Run accepts it.
    const accepted = await put();
    expect(accepted.status).toBe(200);

    await orm.User.where({ id: ids.target }).update({ isBooster: false });
    try {
      const refused = await put();
      expect(refused.status).toBe(400);
      const body = await refused.json();
      expect(body.code).toBe("BOOSTER_ACCESS_REQUIRED");
    } finally {
      await orm.User.where({ id: ids.target }).update({ isBooster: true });
    }
  });

  it("preserves the signup window check", async () => {
    const closedLead: AuthenticatedUser = {
      id: ids.lead,
      name: "Bot Api Lead",
      email: null,
      image: null,
      discordUserId: null,
      discordUsername: null,
      accountRole: "RAID_LEAD",
      accountStatus: "ACTIVE",
    };
    const draftRun = await runService.createRun(closedLead, venomousCreateInput({ difficulty: "HEROIC", lootType: "UNSAVED", venomousPlannedBossCount: 8, scheduledStartAt: futureIso(), desiredTankCount: 1, desiredHealerCount: 1, desiredDpsCount: 2 }));
    createdRunIds.push(draftRun.id);

    const res = await signupPut(
      req(`/api/bot/runs/${draftRun.id}/signup`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "x-discord-user-id": TARGET_DISCORD_ID,
          "content-type": "application/json",
        },
        body: { participationType: "BOOSTER", offers: [{ characterId: targetCharacterId, offeredRoles: ["DPS"] }] },
      }),
      params(draftRun.id),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("SIGNUP_CLOSED");
  });

  it("rejects malformed input with a validation error", async () => {
    const res = await signupPut(
      req(`/api/bot/runs/${runId}/signup`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "x-discord-user-id": TARGET_DISCORD_ID,
          "content-type": "application/json",
        },
        body: { participationType: "NOT_A_TYPE", offers: "not-an-array" },
      }),
      params(runId),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("cancels an active signup and reflects it in /my-signups", async () => {
    await signupPut(
      req(`/api/bot/runs/${runId}/signup`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "x-discord-user-id": TARGET_DISCORD_ID,
          "content-type": "application/json",
        },
        body: { participationType: "BOOSTER", offers: [{ characterId: targetCharacterId, offeredRoles: ["DPS"] }] },
      }),
      params(runId),
    );

    const cancelRes = await cancelPost(
      req(`/api/bot/runs/${runId}/signup/cancel`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "x-discord-user-id": TARGET_DISCORD_ID },
      }),
      params(runId),
    );
    expect(cancelRes.status).toBe(200);

    const mineRes = await mySignupsGet(
      req("/api/bot/my-signups", { headers: { authorization: `Bearer ${TOKEN}`, "x-discord-user-id": TARGET_DISCORD_ID } }),
    );
    const mine = await mineRes.json();
    expect(mine.data.withdrawn.some((item: { runId: string }) => item.runId === runId)).toBe(true);
  });
});

describe("POST /api/bot/runs/:runId/signup/quick", () => {
  afterEach(async () => {
    await cancelPost(
      req(`/api/bot/runs/${runId}/signup/cancel`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "x-discord-user-id": TARGET_DISCORD_ID },
      }),
      params(runId),
    ).catch(() => {});
  });

  it("requires bot service auth and an acting Discord User", async () => {
    const noToken = await quickSignupPost(req(`/api/bot/runs/${runId}/signup/quick`, { method: "POST" }), params(runId));
    expect(noToken.status).toBe(401);

    const noUser = await quickSignupPost(
      req(`/api/bot/runs/${runId}/signup/quick`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      params(runId),
    );
    expect(noUser.status).toBe(401);
  });

  it("calls signupService.quickSignupBoosters for the URL runId and returns the result DTO", async () => {
    const res = await quickSignupPost(
      req(`/api/bot/runs/${runId}/signup/quick`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "x-discord-user-id": TARGET_DISCORD_ID },
      }),
      params(runId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({
      runId,
      added: 1,
      alreadySigned: 0,
      skippedNoDefaultRole: 0,
    });
    expect(typeof body.data.skippedIneligible).toBe("number");
    expect(typeof body.data.skippedUnavailable).toBe("number");
    expect(typeof body.data.skippedReservationConflict).toBe("number");
    expect(typeof body.data.skippedInactive).toBe("number");

    const second = await quickSignupPost(
      req(`/api/bot/runs/${runId}/signup/quick`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "x-discord-user-id": TARGET_DISCORD_ID },
      }),
      params(runId),
    );
    const secondBody = await second.json();
    expect(secondBody.data.added).toBe(0);
    expect(secondBody.data.alreadySigned).toBe(1);
  });

  it("refuses without the Booster role", async () => {
    await orm.User.where({ id: ids.target }).update({ isBooster: false });
    try {
      const res = await quickSignupPost(
        req(`/api/bot/runs/${runId}/signup/quick`, {
          method: "POST",
          headers: { authorization: `Bearer ${TOKEN}`, "x-discord-user-id": TARGET_DISCORD_ID },
        }),
        params(runId),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("BOOSTER_ACCESS_REQUIRED");
    } finally {
      await orm.User.where({ id: ids.target }).update({ isBooster: true });
    }
  });
});

describe("bot API roster and discord-state endpoints", () => {
  it("returns NOT_FOUND for an unpublished roster", async () => {
    const res = await rosterGet(
      req(`/api/bot/runs/${runId}/roster`, { headers: { authorization: `Bearer ${TOKEN}` } }),
      params(runId),
    );
    expect(res.status).toBe(404);
  });

  it("records discord-state and reflects it in the next sync pass", async () => {
    await signupPut(
      req(`/api/bot/runs/${runId}/signup`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "x-discord-user-id": TARGET_DISCORD_ID,
          "content-type": "application/json",
        },
        body: { participationType: "BOOSTER", offers: [{ characterId: targetCharacterId, offeredRoles: ["DPS"] }] },
      }),
      params(runId),
    );

    let sync = await syncGet(req("/api/bot/discord/sync", { headers: { authorization: `Bearer ${TOKEN}` } })).then((r) => r.json());
    expect(sync.data.signups.some((item: { runId: string }) => item.runId === runId)).toBe(true);

    const record = await discordStatePut(
      req(`/api/bot/runs/${runId}/discord-state`, {
        method: "PUT",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: { kind: "signup", channelId: "chan-x", messageId: "msg-x" },
      }),
      params(runId),
    );
    expect(record.status).toBe(200);

    sync = await syncGet(req("/api/bot/discord/sync", { headers: { authorization: `Bearer ${TOKEN}` } })).then((r) => r.json());
    expect(sync.data.signups.some((item: { runId: string }) => item.runId === runId)).toBe(false);
  });

  it("channel-gone clears only identity stored in that exact channel and requires a channelId", async () => {
    const put = (body: unknown) =>
      discordStatePut(
        req(`/api/bot/runs/${runId}/discord-state`, {
          method: "PUT",
          headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
          body,
        }),
        params(runId),
      );
    const signupIdentity = async () => {
      const row = (await orm.RunDiscordPost.where({ runId }).first()) as Record<string, unknown> | null;
      return { channelId: row?.signupChannelId ?? null, messageId: row?.signupMessageId ?? null };
    };

    expect((await put({ kind: "signup", channelId: "chan-gone-x", messageId: "msg-gone-x" })).status).toBe(200);

    expect((await put({ kind: "channel-gone" })).status).toBe(400);
    expect((await put({ kind: "channel-gone", channelId: "some-other-chan" })).status).toBe(200);
    expect(await signupIdentity()).toEqual({ channelId: "chan-gone-x", messageId: "msg-gone-x" });

    expect((await put({ kind: "channel-gone", channelId: "chan-gone-x" })).status).toBe(200);
    expect(await signupIdentity()).toEqual({ channelId: null, messageId: null });
  });

  it("voice-channel records and clear-voice-channel exact-match clears the Run voice channel", async () => {
    const put = (body: unknown) =>
      discordStatePut(
        req(`/api/bot/runs/${runId}/discord-state`, {
          method: "PUT",
          headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
          body,
        }),
        params(runId),
      );
    const voice = async () => ((await orm.RunDiscordPost.where({ runId }).first()) as Record<string, unknown> | null)?.voiceChannelId ?? null;

    expect((await put({ kind: "voice-channel" })).status).toBe(400);
    expect((await put({ kind: "voice-channel", channelId: "voice-222" })).status).toBe(200);
    expect(await voice()).toBe("voice-222");
    expect((await put({ kind: "clear-voice-channel", channelId: "voice-other" })).status).toBe(200);
    expect(await voice()).toBe("voice-222");
    expect((await put({ kind: "clear-voice-channel", channelId: "voice-222" })).status).toBe(200);
    expect(await voice()).toBeNull();
  });

  it("start records the Voice channel the Final Setup rendered (absent/null → none)", async () => {
    const put = (body: unknown) =>
      discordStatePut(
        req(`/api/bot/runs/${runId}/discord-state`, {
          method: "PUT",
          headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
          body,
        }),
        params(runId),
      );
    const rendered = async () =>
      ((await orm.RunDiscordPost.where({ runId }).first()) as Record<string, unknown> | null)?.lastStartVoiceChannelId ?? null;

    expect((await put({ kind: "start", channelId: "chan-s", messageId: "msg-s", voiceChannelId: "voice-9" })).status).toBe(200);
    expect(await rendered()).toBe("voice-9");
    expect((await put({ kind: "start", channelId: "chan-s", messageId: "msg-s", voiceChannelId: null })).status).toBe(200);
    expect(await rendered()).toBeNull();
    expect((await put({ kind: "start", channelId: "chan-s", messageId: "msg-s", voiceChannelId: "voice-9" })).status).toBe(200);
    // Older bots omit the field: their posts have no Voice line.
    expect((await put({ kind: "start", channelId: "chan-s", messageId: "msg-s" })).status).toBe(200);
    expect(await rendered()).toBeNull();
    expect((await put({ kind: "start", channelId: "chan-s", messageId: "msg-s", voiceChannelId: "" })).status).toBe(400);
  });
});
