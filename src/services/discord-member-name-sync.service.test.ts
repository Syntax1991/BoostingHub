import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { groupSignupTilesByPlayer } from "@/components/manage/roster-signup-grouping";
import { orm } from "@/lib/prisma";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import { rosterRepository } from "@/repositories/roster.repository";
import { userRepository } from "@/repositories/user.repository";
import { discordMemberNameSyncService } from "@/services/discord-member-name-sync.service";
import { syncDiscordRoleAccess } from "@/services/discord-role-access-sync.service";

/**
 * Discord → displayed player name (User.name): login-time member read and the
 * bot's bounded refresh. Discord is mocked (fetch); names are never used for
 * identity — signups stay keyed by user id.
 */

const ids = {
  nick: "dnm00000-0000-4000-8000-000000000001",
  global: "dnm00000-0000-4000-8000-000000000002",
  username: "dnm00000-0000-4000-8000-000000000003",
  hyphen: "dnm00000-0000-4000-8000-000000000004",
  departed: "dnm00000-0000-4000-8000-000000000005",
  outage: "dnm00000-0000-4000-8000-000000000006",
  lead: "dnm00000-0000-4000-8000-000000000007",
  outsider: "dnm00000-0000-4000-8000-000000000008",
  run: "dnm00000-0000-4000-8000-0000000000r1",
  charNick: "dnm00000-0000-4000-8000-0000000000c1",
  charTwisting: "dnm00000-0000-4000-8000-0000000000c2",
  signupNick: "dnm00000-0000-4000-8000-0000000000s1",
  signupGlobal: "dnm00000-0000-4000-8000-0000000000s2",
};

const discordIdOf = (userId: string) => `77${userId.replace(/\D/g, "").slice(-16).padStart(16, "0")}`;
/** Far future so only this file's Run counts as "upcoming" for the refresh (other test data never reaches it). */
const RUN_START = "2099-03-06T20:00:00.000Z";
const REFRESH_NOW = new Date("2099-03-01T12:00:00.000Z");

const fetchMock = vi.fn();
/** Discord member per discord user id: object = 200, null = 404 (left the guild), "fail" = HTTP 500. */
const members = new Map<string, { nick?: string | null; global_name?: string | null; username: string } | null | "fail">();

function respond(url: string): Response {
  const discordUserId = decodeURIComponent(url.split("/members/")[1] ?? "");
  const member = members.get(discordUserId);
  if (member === "fail" || member === undefined) return new Response("{}", { status: 500 });
  if (member === null) return new Response("{}", { status: 404 });
  return new Response(
    JSON.stringify({
      nick: member.nick ?? null,
      roles: [],
      user: { id: discordUserId, username: member.username, global_name: member.global_name ?? null },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

async function createUser(id: string, name: string, extra: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name,
    email: `${id}@names.test`,
    emailVerified: true,
    discordUserId: discordIdOf(id),
    discordUsername: `u_${id.slice(-2)}`,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    isBooster: true,
    isLootbuddy: false,
    createdAt: now,
    updatedAt: now,
    ...extra,
  });
}

async function createCharacter(id: string, userId: string, name: string, realm: string) {
  const now = new Date().toISOString();
  await orm.Character.create({
    id,
    userId,
    name,
    realm,
    region: "EU",
    normalizedName: name.toLowerCase(),
    normalizedRealm: realm.toLowerCase(),
    wowClass: "MAGE",
    specialization: "Fire",
    primaryRole: "RANGED_DPS",
    itemLevel: 330,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

async function createSignup(id: string, userId: string, characterId: string | null) {
  const now = new Date().toISOString();
  await orm.RunSignup.create({
    id,
    runId: ids.run,
    userId,
    characterId,
    participationType: characterId ? "BOOSTER" : "LOOTBUDDY",
    isBackup: false,
    status: "PENDING",
    publishedRole: null,
    ...(characterId ? {} : { lootbuddyClass: "MAGE", lootbuddyMode: "LOOT_ONLY" }),
    createdAt: now,
    updatedAt: now,
  });
}

const nameOf = async (id: string) => ((await orm.User.where({ id }).first()) as { name: string }).name;
const stored = async (id: string) =>
  (await orm.User.where({ id }).first()) as {
    name: string;
    discordGuildNickname: string | null;
    discordGlobalName: string | null;
    discordUsername: string | null;
    discordNameSyncedAt: string | null;
  };

async function cleanup() {
  await orm.RunSignup.where({ runId: ids.run }).deleteAndCount().catch(() => {});
  await orm.RunRoster.where({ runId: ids.run }).deleteAndCount().catch(() => {});
  await orm.RunRaidContent.where({ runId: ids.run }).deleteAndCount().catch(() => {});
  await orm.Run.where({ id: ids.run }).deleteAndCount().catch(() => {});
  for (const id of [ids.charNick, ids.charTwisting]) await orm.Character.where({ id }).deleteAndCount().catch(() => {});
  for (const id of Object.values(ids)) await orm.User.where({ id }).deleteAndCount().catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  await createUser(ids.nick, "Simon");
  await createUser(ids.global, "Old Global");
  await createUser(ids.username, "Old Username");
  await createUser(ids.hyphen, "Old Hyphen");
  await createUser(ids.departed, "Departed", { discordGuildNickname: "Dep-Antonidas", discordGlobalName: "Depy" });
  await createUser(ids.outage, "Kept Name", { discordGuildNickname: "Kept", discordGlobalName: "Kept Global" });
  await createUser(ids.lead, "Lead Old", { accountRole: "RAID_LEAD" });
  await createUser(ids.outsider, "Outsider");
  // Known realms come from stored Characters.
  await createCharacter(ids.charNick, ids.nick, "Syntax", "Antonidas");
  await createCharacter(ids.charTwisting, ids.global, "Kiri", "Twisting Nether");
  const now = new Date().toISOString();
  await orm.Run.create({
    id: ids.run,
    title: "Fri 21:00 HC Unsaved 8/8 Lead Old",
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    scheduledStartAt: RUN_START,
    status: "OPEN",
    signupsOpen: true,
    desiredTankCount: 1,
    desiredHealerCount: 1,
    desiredDpsCount: 1,
    desiredLootbuddyCount: 0,
    raidLeadId: ids.lead,
    notes: null,
    createdAt: now,
    updatedAt: now,
  });
  await orm.RunRaidContent.create({ id: crypto.randomUUID(), runId: ids.run, raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 8, createdAt: now });
  await createSignup(ids.signupNick, ids.nick, ids.charNick);
  await createSignup(ids.signupGlobal, ids.global, ids.charTwisting);
});

beforeEach(() => {
  members.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: URL | string) => respond(String(url)));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot-token");
  vi.stubEnv("DISCORD_GUILD_ID", "1526980319826280509");
  vi.stubEnv("DISCORD_BOOSTER_ROLE_ID", "1527022823103791104");
  vi.stubEnv("DISCORD_LOOTBUDDY_ROLE_ID", "1527024325306220704");
  vi.stubEnv("DEV_ACCOUNT_BOOTSTRAP_ENABLED", "false");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await cleanup();
});

describe("login: one guild member read refreshes roles and the displayed name", () => {
  it("server nickname wins; a known realm suffix is dropped; raw names are stored", async () => {
    members.set(discordIdOf(ids.nick), { nick: "Syntax-Antonidas", global_name: "Simon", username: "syntax1991" });
    await syncDiscordRoleAccess({ userId: ids.nick });
    expect(await stored(ids.nick)).toMatchObject({
      name: "Syntax",
      discordGuildNickname: "Syntax-Antonidas",
      discordGlobalName: "Simon",
      discordUsername: "syntax1991",
    });
    expect((await stored(ids.nick)).discordNameSyncedAt).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // roles and name from the same request
  });

  it("no server nickname → global display name (multi-word realm suffix dropped); none → username", async () => {
    members.set(discordIdOf(ids.global), { nick: null, global_name: "Kiri-TwistingNether", username: "kiri" });
    members.set(discordIdOf(ids.username), { nick: null, global_name: null, username: "plainuser" });
    await syncDiscordRoleAccess({ userId: ids.global });
    await syncDiscordRoleAccess({ userId: ids.username });
    expect(await nameOf(ids.global)).toBe("Kiri");
    expect(await nameOf(ids.username)).toBe("plainuser");
  });

  it("hyphenated names stay intact unless the part after the last hyphen is a known realm", async () => {
    members.set(discordIdOf(ids.hyphen), { nick: "Jean-Luc", username: "jl" });
    await syncDiscordRoleAccess({ userId: ids.hyphen });
    expect(await nameOf(ids.hyphen)).toBe("Jean-Luc");
    members.set(discordIdOf(ids.hyphen), { nick: "Jean-Luc-Antonidas", username: "jl" });
    await syncDiscordRoleAccess({ userId: ids.hyphen });
    expect(await nameOf(ids.hyphen)).toBe("Jean-Luc");
    members.set(discordIdOf(ids.hyphen), { nick: "Jean-Blackhand", username: "jl" }); // no Character on Blackhand
    await syncDiscordRoleAccess({ userId: ids.hyphen });
    expect(await nameOf(ids.hyphen)).toBe("Jean-Blackhand");
  });

  it("left the guild (404): server nickname cleared, last known global name shown", async () => {
    members.set(discordIdOf(ids.departed), null);
    await syncDiscordRoleAccess({ userId: ids.departed });
    expect(await stored(ids.departed)).toMatchObject({ name: "Depy", discordGuildNickname: null, discordGlobalName: "Depy" });
  });

  it("Discord unreachable: nothing changes — last known name and raw names stay", async () => {
    members.set(discordIdOf(ids.outage), "fail");
    await syncDiscordRoleAccess({ userId: ids.outage });
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    await syncDiscordRoleAccess({ userId: ids.outage });
    expect(await stored(ids.outage)).toMatchObject({
      name: "Kept Name",
      discordGuildNickname: "Kept",
      discordGlobalName: "Kept Global",
      discordNameSyncedAt: null,
    });
  });
});

describe("bot refresh: people of upcoming Runs, at most once a day, never while rendering", () => {
  it("refreshes the Raid Lead and signed-up players of upcoming Runs only; re-titles the Raid Lead's Run", async () => {
    await orm.User.where({ id: ids.nick }).update({ discordNameSyncedAt: null });
    await orm.User.where({ id: ids.global }).update({ discordNameSyncedAt: null });
    members.set(discordIdOf(ids.lead), { nick: "Titan-Antonidas", username: "titan" });
    members.set(discordIdOf(ids.nick), { nick: "Syn", username: "syntax1991" });
    members.set(discordIdOf(ids.global), { nick: null, global_name: "Kiri", username: "kiri" });
    members.set(discordIdOf(ids.outsider), { nick: "Never Read", username: "out" });

    const result = await discordMemberNameSyncService.runDuePass(REFRESH_NOW);
    expect(result).toMatchObject({ status: "DONE", stoppedOnError: false });
    expect(await nameOf(ids.lead)).toBe("Titan");
    expect(await nameOf(ids.nick)).toBe("Syn");
    expect(await nameOf(ids.outsider)).toBe("Outsider");
    const read = fetchMock.mock.calls.map(([url]) => decodeURIComponent(String(url).split("/members/")[1] ?? ""));
    expect(read).not.toContain(discordIdOf(ids.outsider));
    // The Raid Lead's not-yet-started Run follows the new name.
    expect(((await orm.Run.where({ id: ids.run }).first()) as { title: string }).title.endsWith(" Titan")).toBe(true);

    // Fresh names are not read again within a day.
    fetchMock.mockClear();
    expect(await discordMemberNameSyncService.runDuePass(REFRESH_NOW)).toMatchObject({ refreshed: 0, due: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a Discord failure stops the pass and keeps every last known name", async () => {
    await orm.User.where({ id: ids.lead }).update({ discordNameSyncedAt: null });
    members.set(discordIdOf(ids.lead), "fail");
    const result = await discordMemberNameSyncService.runDuePass(REFRESH_NOW);
    expect(result).toMatchObject({ status: "DONE", refreshed: 0, stoppedOnError: true });
    expect(await nameOf(ids.lead)).toBe("Titan");
  });

  it("Group by Player shows the resolved names, alphabetically, grouped by user id (never by name)", async () => {
    const tiles = (await rosterRepository.listSignups(ids.run)).map((signup) => ({
      id: signup.id,
      userId: signup.userId,
      userName: signup.userName,
      participationType: signup.participationType,
      assignableRoles: [],
    }));
    const groups = groupSignupTilesByPlayer(tiles);
    expect(groups.map((group) => group.label)).toEqual(["Kiri", "Syn"]);
    expect(groups.map((group) => group.key)).toEqual([`player:${ids.global}`, `player:${ids.nick}`]);
    // Same name for two players never merges them.
    await orm.User.where({ id: ids.global }).update({ name: "Syn" });
    const same = groupSignupTilesByPlayer(
      (await rosterRepository.listSignups(ids.run)).map((signup) => ({ ...signup, assignableRoles: [] })),
    );
    expect(same).toHaveLength(2);
  });

  it("not configured: no Discord read at all", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    expect(await discordMemberNameSyncService.runDuePass(REFRESH_NOW)).toEqual({ status: "NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await userRepository.findDiscordNameState(ids.nick)).toMatchObject({ discordGuildNickname: "Syn" });
  });
});
