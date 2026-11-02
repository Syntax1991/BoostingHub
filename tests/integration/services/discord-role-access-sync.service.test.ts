import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth/auth";
import { orm } from "@/lib/prisma";
import { hasEffectiveBoosterAccess, hasEffectiveLootbuddyAccess, isApprovedBooster } from "@/domain/boosting-access";
import { syncDiscordRoleAccess } from "@/services/discord-role-access-sync.service";
import { userRepository } from "@/repositories/user.repository";
import { assertIsolatedTestDatabase, createTestUser, deleteCreatedRows, syntheticDiscordId } from "@tests/fixtures/db-fixtures";

/** The two configured roles that grant access, and three other server roles that must not. */
const GUILD_ID = syntheticDiscordId();
const RAID_BOOSTER_ROLE_ID = syntheticDiscordId();
const LOOTBUDDY_ROLE_ID = syntheticDiscordId();
const MPLUS_BOOSTER_ROLE_ID = syntheticDiscordId();
const RAID_STAFF_ROLE_ID = syntheticDiscordId();
const RAIDLEADER_ROLE_ID = syntheticDiscordId();

const created = { userIds: [] as string[] };
const fetchMock = vi.fn();

type AccessFlags = { isBooster?: boolean; isLootbuddy?: boolean; discordRaidBooster?: boolean; discordLootbuddy?: boolean };

/** A fresh User linked to a fresh Discord id (or none), with the given access flags. */
async function linkedUser(flags: AccessFlags = {}, options: { linked?: boolean } = {}) {
  const discordUserId = options.linked === false ? null : syntheticDiscordId();
  const id = await createTestUser({ name: "Discord Access", discordUserId });
  created.userIds.push(id);
  if (Object.keys(flags).length > 0) await orm.User.where({ id }).update(flags);
  return { id, discordUserId: discordUserId ?? "" };
}

function memberResponse(discordUserId: string, roles: string[]): Response {
  return new Response(
    JSON.stringify({
      user: { id: discordUserId, username: "member", discriminator: "0" },
      roles,
      joined_at: "2026-09-27T12:00:00.000Z",
      deaf: false,
      mute: false,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** Syncs `user` against a guild member holding `roles`; returns the stored access flags. */
async function syncWithRoles(user: { id: string; discordUserId: string }, roles: string[]) {
  fetchMock.mockResolvedValueOnce(memberResponse(user.discordUserId, roles));
  await syncDiscordRoleAccess({ userId: user.id });
  return userRepository.findBoostingRoles(user.id);
}

beforeAll(() => {
  assertIsolatedTestDatabase();
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot-token");
  vi.stubEnv("DISCORD_GUILD_ID", GUILD_ID);
  vi.stubEnv("DISCORD_BOOSTER_ROLE_ID", RAID_BOOSTER_ROLE_ID);
  vi.stubEnv("DISCORD_LOOTBUDDY_ROLE_ID", LOOTBUDDY_ROLE_ID);
  vi.stubEnv("DEV_ACCOUNT_BOOTSTRAP_ENABLED", "false");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(() => deleteCreatedRows(created));

describe("effective access helpers", () => {
  it("cross-grant invariants: Raid Booster and Lootbuddy never grant each other", () => {
    expect(hasEffectiveBoosterAccess({ isBooster: false, discordRaidBooster: true })).toEqual({ granted: true, manual: false, discord: true });
    expect(hasEffectiveLootbuddyAccess({ isLootbuddy: false, discordLootbuddy: false })).toEqual({ granted: false, manual: false, discord: false });
    expect(hasEffectiveBoosterAccess({ isBooster: false, discordRaidBooster: false })).toEqual({ granted: false, manual: false, discord: false });
    expect(hasEffectiveLootbuddyAccess({ isLootbuddy: false, discordLootbuddy: true })).toEqual({ granted: true, manual: false, discord: true });

    expect(isApprovedBooster({ isBooster: false, discordRaidBooster: true })).toBe(true);
    expect(isApprovedBooster({ isBooster: false, discordRaidBooster: false })).toBe(false);
    expect(isApprovedBooster({ isBooster: true, discordRaidBooster: false })).toBe(true);
  });
});

describe("syncDiscordRoleAccess", () => {
  it("1. Discord Raid Booster only → Booster effective, Lootbuddy not", async () => {
    const r = await syncWithRoles(await linkedUser(), [RAID_BOOSTER_ROLE_ID]);
    expect(r).toMatchObject({ isBooster: false, isLootbuddy: false, discordRaidBooster: true, discordLootbuddy: false });
    expect(hasEffectiveBoosterAccess(r).granted).toBe(true);
    expect(hasEffectiveLootbuddyAccess(r).granted).toBe(false);
  });

  it("2/6/7. Discord Lootbuddy only → Lootbuddy effective, Booster not", async () => {
    const r = await syncWithRoles(await linkedUser(), [LOOTBUDDY_ROLE_ID]);
    expect(r).toMatchObject({ isBooster: false, discordRaidBooster: false, discordLootbuddy: true });
    expect(hasEffectiveBoosterAccess(r).granted).toBe(false);
    expect(hasEffectiveLootbuddyAccess(r).granted).toBe(true);
  });

  it("3/5. manual Booster survives Discord Raid Booster removal", async () => {
    const r = await syncWithRoles(await linkedUser({ isBooster: true }), []);
    expect(r).toMatchObject({ isBooster: true, discordRaidBooster: false });
    expect(hasEffectiveBoosterAccess(r).granted).toBe(true);
  });

  it("8/10. manual Lootbuddy survives Discord Lootbuddy removal", async () => {
    const r = await syncWithRoles(await linkedUser({ isLootbuddy: true }), []);
    expect(r).toMatchObject({ isLootbuddy: true, discordLootbuddy: false });
    expect(hasEffectiveLootbuddyAccess(r).granted).toBe(true);
  });

  it("4/9. authoritative role removal clears only Discord grants", async () => {
    const user = await linkedUser({ discordRaidBooster: true, discordLootbuddy: true });
    const r = await syncWithRoles(user, []);
    expect(r).toMatchObject({ discordRaidBooster: false, discordLootbuddy: false, isBooster: false, isLootbuddy: false });
  });

  it("11. both Discord roles → both effective", async () => {
    const r = await syncWithRoles(await linkedUser(), [RAID_BOOSTER_ROLE_ID, LOOTBUDDY_ROLE_ID, MPLUS_BOOSTER_ROLE_ID]);
    expect(hasEffectiveBoosterAccess(r).granted).toBe(true);
    expect(hasEffectiveLootbuddyAccess(r).granted).toBe(true);
  });

  it("13. M+ Booster only → neither Discord grant", async () => {
    const r = await syncWithRoles(await linkedUser(), [MPLUS_BOOSTER_ROLE_ID]);
    expect(r).toMatchObject({ discordRaidBooster: false, discordLootbuddy: false });
  });

  it("14/15. Raid Staff / Raidleader only → neither", async () => {
    for (const role of [RAID_STAFF_ROLE_ID, RAIDLEADER_ROLE_ID]) {
      expect(await syncWithRoles(await linkedUser(), [role])).toMatchObject({ discordRaidBooster: false, discordLootbuddy: false });
    }
  });

  it("16. Discord outage preserves last authoritative Discord grants", async () => {
    const user = await linkedUser({ discordRaidBooster: true, discordLootbuddy: true });
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(syncDiscordRoleAccess({ userId: user.id })).resolves.toBeUndefined();
    expect(await userRepository.findBoostingRoles(user.id)).toMatchObject({ discordRaidBooster: true, discordLootbuddy: true });
  });

  it("17/18. guild departure (404) clears Discord grants and keeps manual", async () => {
    const user = await linkedUser({ isBooster: true, isLootbuddy: true, discordRaidBooster: true, discordLootbuddy: true });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await syncDiscordRoleAccess({ userId: user.id });
    expect(await userRepository.findBoostingRoles(user.id)).toMatchObject({
      isBooster: true,
      isLootbuddy: true,
      discordRaidBooster: false,
      discordLootbuddy: false,
    });
  });

  it("does no lookup when config or Discord identity is missing", async () => {
    vi.stubEnv("DISCORD_LOOTBUDDY_ROLE_ID", "");
    await syncDiscordRoleAccess({ userId: (await linkedUser()).id });
    vi.stubEnv("DISCORD_LOOTBUDDY_ROLE_ID", LOOTBUDDY_ROLE_ID);
    await syncDiscordRoleAccess({ userId: (await linkedUser({}, { linked: false })).id });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clearDiscordRoleAccess removes Discord grants only (unlink)", async () => {
    const user = await linkedUser({ isBooster: true, isLootbuddy: true, discordRaidBooster: true, discordLootbuddy: true });
    await userRepository.clearDiscordRoleAccess(user.id);
    expect(await userRepository.findBoostingRoles(user.id)).toMatchObject({
      isBooster: true,
      isLootbuddy: true,
      discordRaidBooster: false,
      discordLootbuddy: false,
    });
  });
});

describe("Better Auth session-create hook", () => {
  it("syncs Discord role access on sign-in without writing manual flags", async () => {
    const user = await linkedUser();
    fetchMock.mockResolvedValueOnce(memberResponse(user.discordUserId, [RAID_BOOSTER_ROLE_ID, LOOTBUDDY_ROLE_ID]));

    const after = auth.options.databaseHooks!.session!.create!.after!;
    await expect(after({ userId: user.id } as Parameters<typeof after>[0])).resolves.toBeUndefined();

    const r = await userRepository.findBoostingRoles(user.id);
    expect(r).toMatchObject({ isBooster: false, isLootbuddy: false, discordRaidBooster: true, discordLootbuddy: true });
    expect(isApprovedBooster(r)).toBe(true);
  });
});
