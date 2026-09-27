import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth/auth";
import { orm } from "@/lib/prisma";
import { syncDiscordBoosterRole } from "@/services/discord-booster-role-sync.service";

const BOOSTER_ROLE_ID = "1527022823103791104";
const USER_IDS = {
  rolePresent: "dbr00000-0000-4000-8000-000000000001",
  roleAbsent: "dbr00000-0000-4000-8000-000000000002",
  manualGrant: "dbr00000-0000-4000-8000-000000000003",
  missingMember: "dbr00000-0000-4000-8000-000000000004",
  noConfig: "dbr00000-0000-4000-8000-000000000005",
  noDiscordIdentity: "dbr00000-0000-4000-8000-000000000006",
  apiFailure: "dbr00000-0000-4000-8000-000000000007",
  hookRegrant: "dbr00000-0000-4000-8000-000000000008",
} as const;

const fetchMock = vi.fn();

function discordIdFor(userId: string): string {
  const suffix = Object.values(USER_IDS).findIndex((value) => value === userId) + 1;
  return `88000000000000000${suffix}`;
}

function memberResponse(discordUserId: string, roles: string[]): Response {
  return new Response(
    JSON.stringify({
      user: {
        id: discordUserId,
        username: "raidbooster",
        discriminator: "0",
        avatar: null,
        global_name: "Raid Booster",
        bot: false,
        system: false,
        flags: 0,
        public_flags: 0,
      },
      nick: null,
      avatar: null,
      banner: null,
      roles,
      joined_at: "2026-09-27T12:00:00.000Z",
      premium_since: null,
      deaf: false,
      mute: false,
      flags: 0,
      pending: false,
      permissions: "0",
      communication_disabled_until: null,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

async function createUser(input: {
  id: string;
  discordUserId?: string | null;
  accountRole?: "USER" | "RAID_LEAD" | "ADMIN";
  isBooster?: boolean;
  isLootbuddy?: boolean;
}) {
  const now = new Date().toISOString();
  await orm.User.create({
    id: input.id,
    name: `Discord Role Test ${input.id}`,
    email: `${input.id}@discord-role.test`,
    emailVerified: true,
    discordUserId: input.discordUserId === undefined ? discordIdFor(input.id) : input.discordUserId,
    discordUsername: input.discordUserId === null ? null : `discord_${input.id}`,
    accountRole: input.accountRole ?? "USER",
    accountStatus: "ACTIVE",
    isBooster: input.isBooster ?? false,
    isLootbuddy: input.isLootbuddy ?? false,
    createdAt: now,
    updatedAt: now,
  });
}

async function rawUser(id: string): Promise<Record<string, unknown>> {
  return (await orm.User.where({ id }).first()) as Record<string, unknown>;
}

async function cleanup() {
  for (const userId of Object.values(USER_IDS)) {
    const events = await orm.ActivityEvent.where({ userId }).all();
    for (const event of events) {
      await orm.ActivityEvent.where({ id: String((event as Record<string, unknown>).id) }).delete();
    }
    try {
      await orm.User.where({ id: userId }).delete();
    } catch {
      // already gone
    }
  }
}

beforeAll(async () => {
  await cleanup();
  await createUser({
    id: USER_IDS.rolePresent,
    accountRole: "RAID_LEAD",
    isLootbuddy: true,
  });
  await createUser({ id: USER_IDS.roleAbsent });
  await createUser({ id: USER_IDS.manualGrant, isBooster: true });
  await createUser({ id: USER_IDS.missingMember });
  await createUser({ id: USER_IDS.noConfig });
  await createUser({ id: USER_IDS.noDiscordIdentity, discordUserId: null });
  await createUser({ id: USER_IDS.apiFailure });
  await createUser({ id: USER_IDS.hookRegrant });
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot-token");
  vi.stubEnv("DISCORD_GUILD_ID", "123456789012345678");
  vi.stubEnv("DISCORD_BOOSTER_ROLE_ID", BOOSTER_ROLE_ID);
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

describe("syncDiscordBoosterRole", () => {
  it("grants only Booster when the persisted Discord member holds the configured role", async () => {
    fetchMock.mockResolvedValueOnce(
      memberResponse(discordIdFor(USER_IDS.rolePresent), ["111", BOOSTER_ROLE_ID]),
    );

    await syncDiscordBoosterRole({ userId: USER_IDS.rolePresent });

    const user = await rawUser(USER_IDS.rolePresent);
    expect(user.isBooster).toBe(true);
    expect(user.isLootbuddy).toBe(true);
    expect(user.accountRole).toBe("RAID_LEAD");
    expect(await orm.ActivityEvent.where({ userId: USER_IDS.rolePresent }).all()).toHaveLength(0);
  });

  it("does not grant or revoke anything when the Discord role is absent", async () => {
    fetchMock.mockResolvedValueOnce(memberResponse(discordIdFor(USER_IDS.roleAbsent), ["111"]));
    fetchMock.mockResolvedValueOnce(memberResponse(discordIdFor(USER_IDS.manualGrant), ["111"]));
    const manualBefore = await rawUser(USER_IDS.manualGrant);

    await syncDiscordBoosterRole({ userId: USER_IDS.roleAbsent });
    await syncDiscordBoosterRole({ userId: USER_IDS.manualGrant });

    expect((await rawUser(USER_IDS.roleAbsent)).isBooster).toBe(false);
    const manualAfter = await rawUser(USER_IDS.manualGrant);
    expect(manualAfter.isBooster).toBe(true);
    expect(manualAfter.updatedAt).toBe(manualBefore.updatedAt);
  });

  it("leaves a manual revoke unchanged when the Discord member is missing", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));

    await syncDiscordBoosterRole({ userId: USER_IDS.missingMember });

    expect((await rawUser(USER_IDS.missingMember)).isBooster).toBe(false);
  });

  it("does no lookup or write when configuration or persisted Discord identity is missing", async () => {
    vi.stubEnv("DISCORD_BOOSTER_ROLE_ID", "");
    await syncDiscordBoosterRole({ userId: USER_IDS.noConfig });
    vi.stubEnv("DISCORD_BOOSTER_ROLE_ID", BOOSTER_ROLE_ID);
    await syncDiscordBoosterRole({ userId: USER_IDS.noDiscordIdentity });

    expect(fetchMock).not.toHaveBeenCalled();
    expect((await rawUser(USER_IDS.noConfig)).isBooster).toBe(false);
    expect((await rawUser(USER_IDS.noDiscordIdentity)).isBooster).toBe(false);
  });

  it("never blocks sign-in or changes access when Discord fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(syncDiscordBoosterRole({ userId: USER_IDS.apiFailure })).resolves.toBeUndefined();

    expect((await rawUser(USER_IDS.apiFailure)).isBooster).toBe(false);
  });
});

describe("Better Auth session-create hook", () => {
  it("re-grants a manually revoked Booster on the next Discord sign-in while the role remains", async () => {
    expect((await rawUser(USER_IDS.hookRegrant)).isBooster).toBe(false);
    fetchMock.mockResolvedValueOnce(
      memberResponse(discordIdFor(USER_IDS.hookRegrant), [BOOSTER_ROLE_ID]),
    );

    const after = auth.options.databaseHooks!.session!.create!.after!;
    await expect(
      after({ userId: USER_IDS.hookRegrant } as Parameters<typeof after>[0]),
    ).resolves.toBeUndefined();

    expect((await rawUser(USER_IDS.hookRegrant)).isBooster).toBe(true);
  });
});
