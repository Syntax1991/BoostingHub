import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth/auth";
import { orm } from "@/lib/prisma";
import {
  hasEffectiveBoosterAccess,
  hasEffectiveLootbuddyAccess,
  isApprovedBooster,
} from "@/services/boosting-role.service";
import { syncDiscordRoleAccess } from "@/services/discord-role-access-sync.service";
import { userRepository } from "@/repositories/user.repository";

const RAID_BOOSTER_ROLE_ID = "1527022823103791104";
const LOOTBUDDY_ROLE_ID = "1527024325306220704";
const MPLUS_BOOSTER_ROLE_ID = "1527020247683436745";
const RAID_STAFF_ROLE_ID = "1527026271224201367";
const RAIDLEADER_ROLE_ID = "1527022875976925427";

const USER_IDS = {
  raidBoosterOnly: "dra00000-0000-4000-8000-000000000001",
  lootbuddyOnly: "dra00000-0000-4000-8000-000000000002",
  bothRoles: "dra00000-0000-4000-8000-000000000003",
  manualBooster: "dra00000-0000-4000-8000-000000000004",
  manualLootbuddy: "dra00000-0000-4000-8000-000000000005",
  mplusOnly: "dra00000-0000-4000-8000-000000000006",
  staffOnly: "dra00000-0000-4000-8000-000000000007",
  raidleadOnly: "dra00000-0000-4000-8000-000000000008",
  neither: "dra00000-0000-4000-8000-000000000009",
  apiFailure: "dra00000-0000-4000-8000-00000000000a",
  guildDepart: "dra00000-0000-4000-8000-00000000000b",
  noConfig: "dra00000-0000-4000-8000-00000000000c",
  noDiscord: "dra00000-0000-4000-8000-00000000000d",
  hookSync: "dra00000-0000-4000-8000-00000000000e",
} as const;

const fetchMock = vi.fn();

function discordIdFor(userId: string): string {
  const suffix = Object.values(USER_IDS).findIndex((value) => value === userId) + 1;
  return `8800000000000000${String(suffix).padStart(2, "0")}`;
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

async function createUser(input: {
  id: string;
  discordUserId?: string | null;
  isBooster?: boolean;
  isLootbuddy?: boolean;
  discordRaidBooster?: boolean;
  discordLootbuddy?: boolean;
}) {
  const now = new Date().toISOString();
  await orm.User.create({
    id: input.id,
    name: `Discord Access ${input.id}`,
    email: `${input.id}@discord-access.test`,
    emailVerified: true,
    discordUserId: input.discordUserId === undefined ? discordIdFor(input.id) : input.discordUserId,
    discordUsername: input.discordUserId === null ? null : `discord_${input.id}`,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    isBooster: input.isBooster ?? false,
    isLootbuddy: input.isLootbuddy ?? false,
    discordRaidBooster: input.discordRaidBooster ?? false,
    discordLootbuddy: input.discordLootbuddy ?? false,
    createdAt: now,
    updatedAt: now,
  });
}

async function roles(id: string) {
  return userRepository.findBoostingRoles(id);
}

async function cleanup() {
  for (const userId of Object.values(USER_IDS)) {
    try {
      await orm.User.where({ id: userId }).delete();
    } catch {
      // already gone
    }
  }
}

beforeAll(async () => {
  await cleanup();
  await createUser({ id: USER_IDS.raidBoosterOnly });
  await createUser({ id: USER_IDS.lootbuddyOnly });
  await createUser({ id: USER_IDS.bothRoles });
  await createUser({ id: USER_IDS.manualBooster, isBooster: true });
  await createUser({ id: USER_IDS.manualLootbuddy, isLootbuddy: true });
  await createUser({ id: USER_IDS.mplusOnly });
  await createUser({ id: USER_IDS.staffOnly });
  await createUser({ id: USER_IDS.raidleadOnly });
  await createUser({ id: USER_IDS.neither });
  await createUser({
    id: USER_IDS.apiFailure,
    discordRaidBooster: true,
    discordLootbuddy: true,
  });
  await createUser({
    id: USER_IDS.guildDepart,
    discordRaidBooster: true,
    discordLootbuddy: true,
    isBooster: true,
    isLootbuddy: true,
  });
  await createUser({ id: USER_IDS.noConfig });
  await createUser({ id: USER_IDS.noDiscord, discordUserId: null });
  await createUser({ id: USER_IDS.hookSync });
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot-token");
  vi.stubEnv("DISCORD_GUILD_ID", "1526980319826280509");
  vi.stubEnv("DISCORD_BOOSTER_ROLE_ID", RAID_BOOSTER_ROLE_ID);
  vi.stubEnv("DISCORD_LOOTBUDDY_ROLE_ID", LOOTBUDDY_ROLE_ID);
  vi.stubEnv("DEV_ACCOUNT_BOOTSTRAP_ENABLED", "false");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanup();
});

describe("effective access helpers", () => {
  it("cross-grant invariants: Raid Booster and Lootbuddy never grant each other", () => {
    expect(
      hasEffectiveBoosterAccess({
        isBooster: false,
        discordRaidBooster: true,
      }),
    ).toEqual({ granted: true, manual: false, discord: true });
    expect(
      hasEffectiveLootbuddyAccess({
        isLootbuddy: false,
        discordLootbuddy: false,
      }),
    ).toEqual({ granted: false, manual: false, discord: false });

    expect(
      hasEffectiveBoosterAccess({
        isBooster: false,
        discordRaidBooster: false,
      }),
    ).toEqual({ granted: false, manual: false, discord: false });
    expect(
      hasEffectiveLootbuddyAccess({
        isLootbuddy: false,
        discordLootbuddy: true,
      }),
    ).toEqual({ granted: true, manual: false, discord: true });

    expect(
      isApprovedBooster({
        isBooster: false,
        discordRaidBooster: true,
      }),
    ).toBe(true);
    expect(
      isApprovedBooster({
        isBooster: false,
        discordRaidBooster: false,
      }),
    ).toBe(false);
    expect(
      isApprovedBooster({
        isBooster: true,
        discordRaidBooster: false,
      }),
    ).toBe(true);
  });
});

describe("syncDiscordRoleAccess", () => {
  it("1. Discord Raid Booster only → Booster effective, Lootbuddy not", async () => {
    fetchMock.mockResolvedValueOnce(
      memberResponse(discordIdFor(USER_IDS.raidBoosterOnly), [RAID_BOOSTER_ROLE_ID]),
    );
    await syncDiscordRoleAccess({ userId: USER_IDS.raidBoosterOnly });
    const r = await roles(USER_IDS.raidBoosterOnly);
    expect(r).toMatchObject({
      isBooster: false,
      isLootbuddy: false,
      discordRaidBooster: true,
      discordLootbuddy: false,
    });
    expect(hasEffectiveBoosterAccess(r).granted).toBe(true);
    expect(hasEffectiveLootbuddyAccess(r).granted).toBe(false);
  });

  it("2/6/7. Discord Lootbuddy only → Lootbuddy effective, Booster not", async () => {
    fetchMock.mockResolvedValueOnce(
      memberResponse(discordIdFor(USER_IDS.lootbuddyOnly), [LOOTBUDDY_ROLE_ID]),
    );
    await syncDiscordRoleAccess({ userId: USER_IDS.lootbuddyOnly });
    const r = await roles(USER_IDS.lootbuddyOnly);
    expect(r).toMatchObject({
      isBooster: false,
      discordRaidBooster: false,
      discordLootbuddy: true,
    });
    expect(hasEffectiveBoosterAccess(r).granted).toBe(false);
    expect(hasEffectiveLootbuddyAccess(r).granted).toBe(true);
  });

  it("3/5. manual Booster survives Discord Raid Booster removal", async () => {
    fetchMock.mockResolvedValueOnce(memberResponse(discordIdFor(USER_IDS.manualBooster), []));
    await syncDiscordRoleAccess({ userId: USER_IDS.manualBooster });
    const r = await roles(USER_IDS.manualBooster);
    expect(r).toMatchObject({
      isBooster: true,
      discordRaidBooster: false,
    });
    expect(hasEffectiveBoosterAccess(r).granted).toBe(true);
  });

  it("8/10. manual Lootbuddy survives Discord Lootbuddy removal", async () => {
    fetchMock.mockResolvedValueOnce(memberResponse(discordIdFor(USER_IDS.manualLootbuddy), []));
    await syncDiscordRoleAccess({ userId: USER_IDS.manualLootbuddy });
    const r = await roles(USER_IDS.manualLootbuddy);
    expect(r).toMatchObject({
      isLootbuddy: true,
      discordLootbuddy: false,
    });
    expect(hasEffectiveLootbuddyAccess(r).granted).toBe(true);
  });

  it("4/9. authoritative role removal clears only Discord grants", async () => {
    await orm.User.where({ id: USER_IDS.neither }).update({
      discordRaidBooster: true,
      discordLootbuddy: true,
      isBooster: false,
      isLootbuddy: false,
    });
    fetchMock.mockResolvedValueOnce(memberResponse(discordIdFor(USER_IDS.neither), []));
    await syncDiscordRoleAccess({ userId: USER_IDS.neither });
    const r = await roles(USER_IDS.neither);
    expect(r).toMatchObject({
      discordRaidBooster: false,
      discordLootbuddy: false,
      isBooster: false,
      isLootbuddy: false,
    });
  });

  it("11. both Discord roles → both effective", async () => {
    fetchMock.mockResolvedValueOnce(
      memberResponse(discordIdFor(USER_IDS.bothRoles), [
        RAID_BOOSTER_ROLE_ID,
        LOOTBUDDY_ROLE_ID,
        MPLUS_BOOSTER_ROLE_ID,
      ]),
    );
    await syncDiscordRoleAccess({ userId: USER_IDS.bothRoles });
    const r = await roles(USER_IDS.bothRoles);
    expect(hasEffectiveBoosterAccess(r).granted).toBe(true);
    expect(hasEffectiveLootbuddyAccess(r).granted).toBe(true);
  });

  it("13. M+ Booster only → neither Discord grant", async () => {
    fetchMock.mockResolvedValueOnce(
      memberResponse(discordIdFor(USER_IDS.mplusOnly), [MPLUS_BOOSTER_ROLE_ID]),
    );
    await syncDiscordRoleAccess({ userId: USER_IDS.mplusOnly });
    const r = await roles(USER_IDS.mplusOnly);
    expect(r).toMatchObject({ discordRaidBooster: false, discordLootbuddy: false });
  });

  it("14/15. Raid Staff / Raidleader only → neither", async () => {
    fetchMock.mockResolvedValueOnce(
      memberResponse(discordIdFor(USER_IDS.staffOnly), [RAID_STAFF_ROLE_ID]),
    );
    fetchMock.mockResolvedValueOnce(
      memberResponse(discordIdFor(USER_IDS.raidleadOnly), [RAIDLEADER_ROLE_ID]),
    );
    await syncDiscordRoleAccess({ userId: USER_IDS.staffOnly });
    await syncDiscordRoleAccess({ userId: USER_IDS.raidleadOnly });
    expect(await roles(USER_IDS.staffOnly)).toMatchObject({
      discordRaidBooster: false,
      discordLootbuddy: false,
    });
    expect(await roles(USER_IDS.raidleadOnly)).toMatchObject({
      discordRaidBooster: false,
      discordLootbuddy: false,
    });
  });

  it("16. Discord outage preserves last authoritative Discord grants", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(syncDiscordRoleAccess({ userId: USER_IDS.apiFailure })).resolves.toBeUndefined();
    const r = await roles(USER_IDS.apiFailure);
    expect(r).toMatchObject({ discordRaidBooster: true, discordLootbuddy: true });
  });

  it("17/18. guild departure (404) clears Discord grants and keeps manual", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await syncDiscordRoleAccess({ userId: USER_IDS.guildDepart });
    const r = await roles(USER_IDS.guildDepart);
    expect(r).toMatchObject({
      isBooster: true,
      isLootbuddy: true,
      discordRaidBooster: false,
      discordLootbuddy: false,
    });
  });

  it("does no lookup when config or Discord identity is missing", async () => {
    vi.stubEnv("DISCORD_LOOTBUDDY_ROLE_ID", "");
    await syncDiscordRoleAccess({ userId: USER_IDS.noConfig });
    vi.stubEnv("DISCORD_LOOTBUDDY_ROLE_ID", LOOTBUDDY_ROLE_ID);
    await syncDiscordRoleAccess({ userId: USER_IDS.noDiscord });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clearDiscordRoleAccess removes Discord grants only (unlink)", async () => {
    await orm.User.where({ id: USER_IDS.hookSync }).update({
      isBooster: true,
      isLootbuddy: true,
      discordRaidBooster: true,
      discordLootbuddy: true,
    });
    await userRepository.clearDiscordRoleAccess(USER_IDS.hookSync);
    const r = await roles(USER_IDS.hookSync);
    expect(r).toMatchObject({
      isBooster: true,
      isLootbuddy: true,
      discordRaidBooster: false,
      discordLootbuddy: false,
    });
  });
});

describe("Better Auth session-create hook", () => {
  it("syncs Discord role access on sign-in without writing manual flags", async () => {
    await orm.User.where({ id: USER_IDS.hookSync }).update({
      isBooster: false,
      isLootbuddy: false,
      discordRaidBooster: false,
      discordLootbuddy: false,
    });
    fetchMock.mockResolvedValueOnce(
      memberResponse(discordIdFor(USER_IDS.hookSync), [RAID_BOOSTER_ROLE_ID, LOOTBUDDY_ROLE_ID]),
    );

    const after = auth.options.databaseHooks!.session!.create!.after!;
    await expect(
      after({ userId: USER_IDS.hookSync } as Parameters<typeof after>[0]),
    ).resolves.toBeUndefined();

    const r = await roles(USER_IDS.hookSync);
    expect(r).toMatchObject({
      isBooster: false,
      isLootbuddy: false,
      discordRaidBooster: true,
      discordLootbuddy: true,
    });
    expect(isApprovedBooster(r)).toBe(true);
  });
});
