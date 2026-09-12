import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { runService } from "@/services/run.service";
import type { AuthenticatedUser } from "@/auth/authorization";

import { GET as syncGet } from "@/app/api/bot/discord/sync/route";
import { GET as mySignupsGet } from "@/app/api/bot/my-signups/route";
import { GET as signupOptionsGet } from "@/app/api/bot/runs/[runId]/signup-options/route";
import { PUT as signupPut } from "@/app/api/bot/runs/[runId]/signup/route";
import { POST as cancelPost } from "@/app/api/bot/runs/[runId]/signup/cancel/route";
import { GET as rosterGet } from "@/app/api/bot/runs/[runId]/roster/route";
import { PUT as discordStatePut } from "@/app/api/bot/runs/[runId]/discord-state/route";

const TOKEN = "bot-api-test-token-0123456789";
const raidId = VENOMOUS_ABYSS_RAID_ID;
const ids = {
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-ba0000000001",
  target: "aaaaaaaa-aaaa-4aaa-8aaa-ba0000000002",
};
const createdUserIds = Object.values(ids);
const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdQualificationIds: string[] = [];
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
    else if (table === "BoosterQualification") await orm.BoosterQualification.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

function futureIso(days = 10) {
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

  const qualId = crypto.randomUUID();
  createdQualificationIds.push(qualId);
  await orm.BoosterQualification.create({
    id: qualId,
    userId: ids.target,
    difficulty: "HEROIC",
    status: "APPROVED",
    notes: null,
    grantedAt: new Date().toISOString(),
    grantedById: null,
    revokedAt: null,
    revokedById: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

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
    .createRun(lead, {
      raidId,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt: futureIso(),
      desiredTankCount: 1,
      desiredHealerCount: 1,
      desiredDpsCount: 2,
    })
    .then((run) => run.id);
  createdRunIds.push(runId);
  await runService.openRun(lead, runId);
}, 60_000);

afterAll(async () => {
  for (const id of createdRunIds) {
    await cleanupRun(id);
  }
  for (const id of createdQualificationIds) {
    await orm.BoosterQualification.where({ id }).delete().catch(() => {});
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
          offers: [{ characterId: targetCharacterId, role: "DPS" }],
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
        body: { participationType: "BOOSTER", offers: [{ characterId: foreignCharacterId, role: "DPS" }] },
      }),
      params(runId),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("CHARACTER_NOT_OWNED");
  });

  it("preserves BoosterQualification enforcement (exact difficulty)", async () => {
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
    const mythicRun = await runService.createRun(mythicLead, {
      raidId,
      difficulty: "MYTHIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt: futureIso(),
      desiredTankCount: 1,
      desiredHealerCount: 1,
      desiredDpsCount: 2,
    });
    createdRunIds.push(mythicRun.id);
    await runService.openRun(mythicLead, mythicRun.id);

    const res = await signupPut(
      req(`/api/bot/runs/${mythicRun.id}/signup`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "x-discord-user-id": TARGET_DISCORD_ID,
          "content-type": "application/json",
        },
        body: { participationType: "BOOSTER", offers: [{ characterId: targetCharacterId, role: "DPS" }] },
      }),
      params(mythicRun.id),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("BOOSTER_ACCESS_DIFFICULTY_MISMATCH");
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
    const draftRun = await runService.createRun(closedLead, {
      raidId,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt: futureIso(),
      desiredTankCount: 1,
      desiredHealerCount: 1,
      desiredDpsCount: 2,
    });
    createdRunIds.push(draftRun.id);

    const res = await signupPut(
      req(`/api/bot/runs/${draftRun.id}/signup`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "x-discord-user-id": TARGET_DISCORD_ID,
          "content-type": "application/json",
        },
        body: { participationType: "BOOSTER", offers: [{ characterId: targetCharacterId, role: "DPS" }] },
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
        body: { participationType: "BOOSTER", offers: [{ characterId: targetCharacterId, role: "DPS" }] },
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
        body: { participationType: "BOOSTER", offers: [{ characterId: targetCharacterId, role: "DPS" }] },
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
});
