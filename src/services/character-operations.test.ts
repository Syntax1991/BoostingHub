import pg from "pg";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getManagementNavItems, type AuthenticatedUser } from "@/auth/authorization";
import { DomainError, isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { releaseCharacterSyncLock, tryAcquireCharacterSyncLock } from "@/lib/character-sync-lock";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import { getCurrentLockoutRaids } from "@/lib/wow-raid-catalog";
import type { AccountRole, WowRegion } from "@/models/enums";

const apiMocks = vi.hoisted(() => ({
  getClientCredentialsToken: vi.fn(),
  getCharacterProfileStatus: vi.fn(),
  getCharacterProfileSummary: vi.fn(),
  getCharacterRaidEncounters: vi.fn(),
}));
const raiderIoMocks = vi.hoisted(() => ({ getCharacterEquippedItemLevel: vi.fn() }));
vi.mock("@/integrations/blizzard/blizzard-api-client", () => ({ blizzardApiClient: apiMocks }));
vi.mock("@/integrations/raider-io/raider-io-api-client", () => ({ raiderIoApiClient: raiderIoMocks }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: unknown }) =>
    createElement("a", { href, ...props }, children as never),
}));

import { battleNetConnectionRepository } from "@/repositories/battle-net-connection.repository";
import { characterRepository } from "@/repositories/character.repository";
import { characterOperationsRepository } from "@/repositories/character-operations.repository";
import { raidRepository } from "@/repositories/raid.repository";
import { scheduledJobLockRepository } from "@/repositories/scheduled-job-lock.repository";
import {
  BULK_FORCE_REFRESH_COMPLETED_EVENT,
  BULK_FORCE_REFRESH_STARTED_EVENT,
  characterOperationsService,
  deriveOperationsRow,
  filterOperationsRows,
  sortOperationsRows,
  summarizeOperationsRows,
  type OperationsRow,
} from "@/services/character-operations.service";
import { SCHEDULED_CHARACTER_SYNC_LOCK_KEY } from "@/services/scheduled-character-sync.service";
import { parseCharacterOperationsFilters } from "@/validators/character-operations";
import type { OperationsCharacterRecord } from "@/repositories/character-operations.repository";

const { ManageCharactersView } = await import("@/components/manage/manage-characters-view");

/* ------------------------------------------------------------------ fixtures */

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const token = Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 5) || "tok";

function asUser(id: string, accountRole: AccountRole): AuthenticatedUser {
  return {
    id,
    name: `Ops ${accountRole}`,
    email: null,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function createUser(name: string, role: AccountRole = "USER"): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name,
    email: `${id}@ops.boostting.local`,
    emailVerified: true,
    accountRole: role,
    accountStatus: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
  createdUserIds.push(id);
  return id;
}

async function connect(userId: string, region: WowRegion = "EU") {
  return battleNetConnectionRepository.upsert({
    userId,
    region,
    battleNetAccountId: `acct-${userId}-${region}`,
    battleTag: `Ops#${region}`,
    scope: "wow.profile openid",
  });
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

async function createCharacter(
  userId: string,
  label: string,
  input: {
    linked?: boolean;
    active?: boolean;
    lastSyncedAt?: string | null;
    lastSyncAttemptAt?: string | null;
    lastSyncErrorAt?: string | null;
    lastSyncErrorCode?: string | null;
    syncFailureCount?: number;
  } = {},
) {
  const name = `Ops${label}${token}`;
  const realm = "Twisting Nether";
  const id = crypto.randomUUID();
  await characterRepository.create({
    id,
    userId,
    name,
    realm,
    region: "EU",
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity(realm),
    wowClass: "MAGE",
    specialization: "Arcane",
    primaryRole: "DPS",
    itemLevel: 600,
    isActive: input.active ?? true,
    blizzardCharacterId: input.linked === false ? null : `bz-${id}`,
    blizzardRealmId: input.linked === false ? null : "1301",
    lastSyncedAt: null,
  });
  await orm.Character.where({ id }).update({
    warcraftLogsId: "wcl-known",
    lastSyncedAt: input.lastSyncedAt ?? null,
    lastSyncAttemptAt: input.lastSyncAttemptAt ?? null,
    lastSyncErrorAt: input.lastSyncErrorAt ?? null,
    lastSyncErrorCode: (input.lastSyncErrorCode ?? null) as never,
    syncFailureCount: input.syncFailureCount ?? 0,
  });
  createdCharacterIds.push(id);
  return { id, name };
}

function mockBlizzardSuccess(delayMs = 0) {
  apiMocks.getCharacterProfileStatus.mockImplementation(async () => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return { id: undefined, isValid: true };
  });
  apiMocks.getCharacterProfileSummary.mockImplementation(async (_region: WowRegion, _slug: string, name: string) => ({
    id: undefined,
    name,
    realmId: undefined,
    // No class in the mock: seeded dev Characters of other classes are eligible too.
    wowClass: undefined,
    equippedItemLevel: 610,
    activeSpecialization: "Arcane",
  }));
  apiMocks.getCharacterRaidEncounters.mockResolvedValue({ raids: [] });
}

let adminId = "";
let ownerA = "";
let ownerB = "";
let admin: AuthenticatedUser;
const fx: Record<string, { id: string; name: string }> = {};

beforeAll(async () => {
  vi.stubEnv("BLIZZARD_CLIENT_ID", "test-client-id");
  vi.stubEnv("BLIZZARD_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("BLIZZARD_REDIRECT_URI", "http://localhost:3000/api/integrations/battlenet/callback");
  vi.stubEnv("BLIZZARD_SYNC_STALE_MINUTES", "");
  await raidRepository.ensureReferenceRaids();
  adminId = await createUser("Ops Admin", "ADMIN");
  admin = asUser(adminId, "ADMIN");
  ownerA = await createUser(`Ops Owner Alpha ${token}`);
  ownerB = await createUser(`Ops Owner Bravo ${token}`);
  await connect(ownerA, "EU");
  // ownerB has no EU connection → NO_CONNECTION.
  fx.healthy = await createCharacter(ownerA, "Healthy", { lastSyncedAt: minutesAgo(5), lastSyncAttemptAt: minutesAgo(5) });
  fx.stale = await createCharacter(ownerA, "Stale", { lastSyncedAt: minutesAgo(600), lastSyncAttemptAt: minutesAgo(600) });
  fx.error = await createCharacter(ownerA, "Error", {
    lastSyncedAt: minutesAgo(5),
    lastSyncAttemptAt: minutesAgo(1),
    lastSyncErrorAt: minutesAgo(1),
    lastSyncErrorCode: "UPSTREAM_UNAVAILABLE",
    syncFailureCount: 2,
  });
  fx.never = await createCharacter(ownerA, "Never");
  fx.noconn = await createCharacter(ownerB, "Noconn");
  fx.notlinked = await createCharacter(ownerA, "Notlinked", { linked: false });
  fx.retired = await createCharacter(ownerA, "Retired", { active: false, lastSyncedAt: minutesAgo(10_000) });
});

beforeEach(async () => {
  vi.clearAllMocks();
  raiderIoMocks.getCharacterEquippedItemLevel.mockResolvedValue({ status: "TEMPORARY_FAILURE", message: "n/a" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // Each bulk test starts outside the 10-minute bulk cooldown.
  await orm.ActivityEvent.where({ type: BULK_FORCE_REFRESH_STARTED_EVENT }).deleteAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await orm.ActivityEvent.where({ type: BULK_FORCE_REFRESH_STARTED_EVENT }).deleteAll();
  await orm.ActivityEvent.where({ type: BULK_FORCE_REFRESH_COMPLETED_EVENT }).deleteAll();
  for (const id of createdCharacterIds) {
    await orm.CharacterRaidLockout.where({ characterId: id }).deleteAll();
    await orm.CharacterWeeklyUnavailability.where({ characterId: id }).deleteAll();
    await orm.Character.where({ id }).deleteAll();
  }
  for (const id of createdUserIds) {
    await orm.BoosterQualification.where({ userId: id }).deleteAll();
    await orm.BattleNetConnection.where({ userId: id }).deleteAll();
    await orm.ActivityEvent.where({ userId: id }).deleteAll();
    await orm.User.where({ id }).deleteAll();
  }
  vi.unstubAllEnvs();
});

async function rowOf(id: string): Promise<OperationsRow> {
  const page = await characterOperationsService.getListPage(admin, parseCharacterOperationsFilters({}));
  return page.rows.find((row) => row.id === id)!;
}

/* ------------------------------------------------------------ authorization */

describe("authorization", () => {
  const denied = (role: AccountRole) => asUser(crypto.randomUUID(), role);

  it.each(["USER", "RAID_LEAD"] as const)("%s is denied everywhere (list, detail, sync, force, bulk)", async (role) => {
    const user = denied(role);
    const expectDenied = async (promise: Promise<unknown>) =>
      expect(await promise.then(() => "allowed").catch((error) => (isDomainError(error) ? error.code : "other"))).toBe(
        "NOT_AUTHORIZED",
      );
    await expectDenied(characterOperationsService.getListPage(user, parseCharacterOperationsFilters({})));
    await expectDenied(characterOperationsService.getDetail(user, fx.healthy!.id));
    await expectDenied(characterOperationsService.syncCharacter(user, { characterId: fx.healthy!.id, force: false }));
    await expectDenied(characterOperationsService.syncCharacter(user, { characterId: fx.healthy!.id, force: true }));
    await expectDenied(characterOperationsService.forceRefreshAll(user));
  });

  it("ADMIN and OWNER are allowed (OWNER through hasAdminAccess)", async () => {
    for (const role of ["ADMIN", "OWNER"] as const) {
      const page = await characterOperationsService.getListPage(asUser(adminId, role), parseCharacterOperationsFilters({}));
      expect(page.rows.length).toBeGreaterThan(0);
    }
  });

  it("the Characters nav item exists only for admin-level roles", () => {
    const has = (role: AccountRole) => getManagementNavItems(role).some((item) => item.href === "/manage/characters");
    expect(has("USER")).toBe(false);
    expect(has("RAID_LEAD")).toBe(false);
    expect(has("ADMIN")).toBe(true);
    expect(has("OWNER")).toBe(true);
  });
});

/* ----------------------------------------------------- list, query bound */

describe("admin list read model", () => {
  it("loads with a bounded number of SQL statements, independent of Character count", async () => {
    const spy = vi.spyOn(pg.Client.prototype, "query");
    await characterOperationsRepository.listAll();
    const first = spy.mock.calls.length;
    const extra = await createUser(`Ops Extra ${token}`);
    await connect(extra, "EU");
    for (let index = 0; index < 5; index += 1) await createCharacter(extra, `Bulk${String.fromCharCode(97 + index)}x`);
    spy.mockClear();
    await characterOperationsRepository.listAll();
    expect(spy.mock.calls.length).toBe(first);
    expect(first).toBeLessThanOrEqual(3);
  });

  it("derives linkage/health authoritatively for every fixture state", async () => {
    const page = await characterOperationsService.getListPage(admin, parseCharacterOperationsFilters({}));
    const byId = new Map(page.rows.map((row) => [row.id, row]));
    expect(byId.get(fx.healthy!.id)).toMatchObject({ linkage: "LINKED", health: "HEALTHY", retired: false, syncIneligibleReason: null });
    expect(byId.get(fx.stale!.id)).toMatchObject({ linkage: "LINKED", health: "STALE" });
    expect(byId.get(fx.error!.id)).toMatchObject({
      linkage: "LINKED",
      health: "ERROR",
      lastSyncErrorCode: "UPSTREAM_UNAVAILABLE",
      lastSyncErrorLabel: "Blizzard API unavailable",
      syncFailureCount: 2,
    });
    expect(byId.get(fx.never!.id)).toMatchObject({ linkage: "LINKED", health: "NEVER_SYNCED" });
    expect(byId.get(fx.noconn!.id)).toMatchObject({ linkage: "NO_CONNECTION", health: null, syncIneligibleReason: "NO_CONNECTION" });
    expect(byId.get(fx.notlinked!.id)).toMatchObject({ linkage: "NOT_LINKED", health: null, syncIneligibleReason: "NOT_LINKED" });
    expect(byId.get(fx.retired!.id)).toMatchObject({ retired: true, health: null, syncIneligibleReason: "RETIRED" });
    // Bulk eligibility shown on the page matches the row derivation.
    expect(page.bulkEligibleCount).toBe(page.rows.filter((row) => row.syncIneligibleReason === null).length);
  });

  it("projects multi-content lockouts: every current raid independently, 0/N verified, missing = UNKNOWN, old reset excluded", async () => {
    const character = await createCharacter(ownerA, "Lockouts", { lastSyncedAt: minutesAgo(5) });
    const [first, second] = getCurrentLockoutRaids();
    const reset = getRegionalWeeklyReset("EU").resetIdentifier;
    const now = new Date().toISOString();
    const add = (raidId: string, difficulty: "NORMAL" | "HEROIC" | "MYTHIC", bosses: number, resetIdentifier = reset) =>
      orm.CharacterRaidLockout.create({
        id: crypto.randomUUID(),
        characterId: character.id,
        raidId,
        difficulty,
        resetIdentifier,
        bossesDefeated: bosses,
        isComplete: false,
        createdAt: now,
        updatedAt: now,
      });
    await add(first!.id, "HEROIC", 3);
    await add(first!.id, "MYTHIC", 0);
    await add(second!.id, "NORMAL", 7, "1999-W01"); // an old reset — never shown
    const row = await rowOf(character.id);
    expect(row.lockoutSlots.map((slot) => slot.raidId)).toEqual(getCurrentLockoutRaids().map((raid) => raid.id));
    const [slotA, slotB] = row.lockoutSlots;
    expect(slotA!.status).toBe("VERIFIED");
    if (slotA!.status === "VERIFIED") {
      expect(slotA!.rows.find((item) => item.difficulty === "HEROIC")?.bossesDefeated).toBe(3);
      expect(slotA!.rows.find((item) => item.difficulty === "MYTHIC")?.bossesDefeated).toBe(0);
      expect(slotA!.rows.find((item) => item.difficulty === "NORMAL")).toBeUndefined();
    }
    expect(slotB!.status).toBe("UNKNOWN");
  });

  it("renders readable error copy — never the raw category or an upstream message", async () => {
    const page = await characterOperationsService.getListPage(admin, parseCharacterOperationsFilters({ query: "OpsError" }));
    const html = renderToStaticMarkup(createElement(ManageCharactersView, { data: page }));
    expect(html).toContain("Blizzard API unavailable");
    expect(html).not.toContain("UPSTREAM_UNAVAILABLE");
    expect(html).toContain("No connection");
  });
});

/* ------------------------------------------- pure: filters, sort, summary */

function record(overrides: Partial<OperationsCharacterRecord> & { id: string; name: string }): OperationsCharacterRecord {
  return {
    userId: "u1",
    realm: "Twisting Nether",
    region: "EU",
    wowClass: "MAGE",
    specialization: null,
    primaryRole: "DPS",
    itemLevel: null,
    isActive: true,
    blizzardCharacterId: "b",
    blizzardRealmId: "r",
    lastSyncedAt: null,
    lastSyncAttemptAt: null,
    lastSyncErrorAt: null,
    lastSyncErrorCode: null,
    syncFailureCount: 0,
    owner: { id: "u1", name: "Alpha", discordUsername: "alpha" },
    currentLockouts: [],
    ...overrides,
  };
}

const NOW = new Date("2026-09-26T12:00:00.000Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
function derive(rec: OperationsCharacterRecord, connected = true) {
  return deriveOperationsRow(rec, { ownerHasRegionConnection: connected, now: NOW, staleMinutes: 120 });
}

const pureRows: OperationsRow[] = [
  derive(record({ id: "1", name: "Bravo", lastSyncedAt: ago(5) })), // HEALTHY
  derive(record({ id: "2", name: "alpha", lastSyncedAt: ago(500), realm: "Silvermoon" })), // STALE
  derive(record({ id: "3", name: "Charlie", lastSyncedAt: ago(5), lastSyncErrorAt: ago(1), lastSyncErrorCode: "RATE_LIMITED" })), // ERROR
  derive(record({ id: "4", name: "Delta" })), // NEVER_SYNCED
  derive(record({ id: "5", name: "Echo", owner: { id: "u2", name: "Zulu", discordUsername: null } }), false), // NO_CONNECTION
  derive(record({ id: "6", name: "Foxtrot", blizzardCharacterId: null, blizzardRealmId: null, region: "US", wowClass: "PRIEST" })), // NOT_LINKED
  derive(record({ id: "7", name: "Golf", isActive: false, lastSyncedAt: ago(9999) })), // retired
];

describe("summary", () => {
  it("counts active operational states from the same rows; retired never counts as a problem", () => {
    expect(summarizeOperationsRows(pureRows)).toEqual({
      total: 7,
      active: 6,
      retired: 1,
      healthy: 1,
      stale: 1,
      errors: 1,
      neverSynced: 1,
      linked: 4,
      noConnection: 1,
      notLinked: 1,
    });
  });
});

describe("filters", () => {
  const ids = (filters: Record<string, string>) =>
    filterOperationsRows(pureRows, parseCharacterOperationsFilters(filters)).map((row) => row.id);

  it("text (name or realm), owner (name, Discord, id), class, region", () => {
    expect(ids({ query: "silver" })).toEqual(["2"]);
    expect(ids({ query: "ALPHA" })).toEqual(["2"]);
    expect(ids({ owner: "zul" })).toEqual(["5"]);
    expect(ids({ owner: "alpha" })).toHaveLength(6);
    expect(ids({ owner: "u2" })).toEqual(["5"]);
    expect(ids({ class: "PRIEST" })).toEqual(["6"]);
    expect(ids({ region: "US" })).toEqual(["6"]);
  });

  it("status, linkage and health (health = active linked only) and combinations", () => {
    expect(ids({ status: "retired" })).toEqual(["7"]);
    expect(ids({ status: "active" })).toHaveLength(6);
    expect(ids({ linkage: "NO_CONNECTION" })).toEqual(["5"]);
    expect(ids({ linkage: "NOT_LINKED" })).toEqual(["6"]);
    expect(ids({ health: "ERROR" })).toEqual(["3"]);
    expect(ids({ health: "STALE" })).toEqual(["2"]);
    expect(ids({ health: "HEALTHY", owner: "alpha", region: "EU", status: "active" })).toEqual(["1"]);
    expect(ids({ health: "STALE", status: "retired" })).toEqual([]);
  });

  it("ignores unknown filter values instead of failing", () => {
    expect(parseCharacterOperationsFilters({ class: "WIZARD", health: "GREAT", sort: "random", status: "x" })).toEqual({
      query: undefined,
      owner: undefined,
      wowClass: undefined,
      region: undefined,
      status: "all",
      linkage: undefined,
      health: undefined,
      sort: "character",
    });
  });
});

describe("sorting (stable, deterministic)", () => {
  const order = (sort: string) =>
    sortOperationsRows(pureRows, parseCharacterOperationsFilters({ sort }).sort).map((row) => row.id);

  it("character (case-insensitive) and owner", () => {
    expect(order("character")).toEqual(["2", "1", "3", "4", "5", "6", "7"]);
    expect(order("owner").at(-1)).toBe("5");
  });

  it("last success: most recent first, never-synced grouped last by name", () => {
    expect(order("last_success")).toEqual(["1", "3", "2", "7", "4", "5", "6"]);
  });

  it("health: problems first (ERROR, STALE, NEVER_SYNCED, HEALTHY), then NO_CONNECTION, NOT_LINKED, retired", () => {
    expect(order("health")).toEqual(["3", "2", "4", "1", "5", "6", "7"]);
  });
});

/* ------------------------------------------------------------------ detail */

describe("detail", () => {
  it("shows identity, owner, telemetry with safe error copy, weekly availability, Booster Access and lockouts", async () => {
    const detail = await characterOperationsService.getDetail(admin, fx.error!.id);
    expect(detail.row).toMatchObject({
      name: fx.error!.name,
      owner: { id: ownerA },
      health: "ERROR",
      lastSyncErrorLabel: "Blizzard API unavailable",
      syncFailureCount: 2,
    });
    expect(detail.identity).toMatchObject({ primaryRole: "DPS", ownerHasRegionConnection: true });
    expect(detail.weeklyAvailability).toMatchObject({ characterId: fx.error!.id, status: "AVAILABLE" });
    expect(detail.boosterAccess.difficulties.map((entry) => entry.difficulty)).toEqual(["NORMAL", "HEROIC", "MYTHIC"]);
    expect(detail.row.lockoutSlots).toHaveLength(getCurrentLockoutRaids().length);
    expect(JSON.stringify(detail)).not.toMatch(/message|stack/i);
  });

  it("404s for an unknown Character", async () => {
    await expect(characterOperationsService.getDetail(admin, crypto.randomUUID())).rejects.toMatchObject({
      code: "CHARACTER_NOT_FOUND",
    });
  });
});

/* ------------------------------------------------------- admin single sync */

describe("admin Sync now / Force refresh", () => {
  it("normal Sync now respects the 60s cooldown; Force refresh bypasses it and runs the shared sync with the OWNER's connection", async () => {
    const character = await createCharacter(ownerA, "Cool", { lastSyncedAt: minutesAgo(3), lastSyncAttemptAt: new Date().toISOString() });
    mockBlizzardSuccess();
    await expect(characterOperationsService.syncCharacter(admin, { characterId: character.id, force: false })).rejects.toMatchObject({
      code: "BLIZZARD_REFRESH_COOLDOWN",
    });
    expect(apiMocks.getCharacterProfileStatus).not.toHaveBeenCalled();

    const before = await battleNetConnectionRepository.findByUserAndRegion(ownerA, "EU");
    const outcome = await characterOperationsService.syncCharacter(admin, { characterId: character.id, force: true });
    expect(outcome.status).toBe("SUCCEEDED");
    const after = (await characterRepository.findById(character.id))!;
    expect(after).toMatchObject({ itemLevel: 610, lastSyncErrorAt: null, syncFailureCount: 0 });
    // The acting admin has no Battle.net connection at all — the owner's was used and marked.
    expect(await battleNetConnectionRepository.findByUserAndRegion(adminId, "EU")).toBeNull();
    const connection = await battleNetConnectionRepository.findByUserAndRegion(ownerA, "EU");
    expect(connection?.lastSuccessfulSyncAt).toBeTruthy();
    expect(connection?.lastSuccessfulSyncAt).not.toBe(before?.lastSuccessfulSyncAt);
  });

  it("normal Sync now runs when out of cooldown and records an admin activity event", async () => {
    const character = await createCharacter(ownerA, "Normal", { lastSyncAttemptAt: minutesAgo(5) });
    mockBlizzardSuccess();
    const outcome = await characterOperationsService.syncCharacter(admin, { characterId: character.id, force: false });
    expect(outcome.status).toBe("SUCCEEDED");
    const events = (await orm.ActivityEvent.where({ userId: adminId, type: "ADMIN_CHARACTER_SYNC" }).all()) as Array<{ message: string }>;
    expect(events.some((event) => event.message.includes(`targetCharacterId=${character.id}`))).toBe(true);
  });

  it.each([
    ["retired", "RETIRED", "Retired characters are not synced."],
    ["notlinked", "NOT_LINKED", "Character is not linked to Battle.net."],
    ["noconn", "NO_CONNECTION", "Owner has no Battle.net connection for this region."],
  ] as const)("%s is not eligible for Sync now or Force refresh", async (key, _reason, copy) => {
    mockBlizzardSuccess();
    for (const force of [false, true]) {
      const error = await characterOperationsService
        .syncCharacter(admin, { characterId: fx[key]!.id, force })
        .catch((caught) => caught);
      expect(isDomainError(error) && error.code).toBe("CHARACTER_SYNC_NOT_ELIGIBLE");
      expect(error.message).toBe(copy);
    }
    expect(apiMocks.getCharacterProfileStatus).not.toHaveBeenCalled();
  });

  it("the per-Character lock is kept: an already-syncing Character is refused for both modes", async () => {
    const character = await createCharacter(ownerA, "Locked");
    const held = await tryAcquireCharacterSyncLock(character.id);
    try {
      mockBlizzardSuccess();
      for (const force of [false, true]) {
        await expect(characterOperationsService.syncCharacter(admin, { characterId: character.id, force })).rejects.toMatchObject({
          code: "CHARACTER_SYNC_IN_PROGRESS",
        });
      }
      expect(apiMocks.getCharacterProfileStatus).not.toHaveBeenCalled();
    } finally {
      await releaseCharacterSyncLock(held!);
    }
  });

  it("a failed sync returns only the safe category label, records telemetry and a safe activity event", async () => {
    const character = await createCharacter(ownerA, "Fails");
    apiMocks.getCharacterProfileStatus.mockRejectedValue(
      new DomainError("BATTLENET_API_UNAVAILABLE", "upstream 10.0.0.9 said token=abc", 503),
    );
    const outcome = await characterOperationsService.syncCharacter(admin, { characterId: character.id, force: true });
    expect(outcome).toMatchObject({ status: "FAILED", errorCategory: "UPSTREAM_UNAVAILABLE", errorLabel: "Blizzard API unavailable" });
    expect(JSON.stringify(outcome)).not.toContain("token=abc");
    expect((await characterRepository.findById(character.id))!).toMatchObject({ lastSyncErrorCode: "UPSTREAM_UNAVAILABLE", syncFailureCount: 1 });
    const events = (await orm.ActivityEvent.where({ userId: adminId, type: "ADMIN_CHARACTER_FORCE_REFRESH" }).all()) as Array<{ message: string }>;
    const event = events.find((item) => item.message.includes(character.id))!;
    expect(event.message).toContain("UPSTREAM_UNAVAILABLE");
    expect(event.message).not.toContain("token=abc");
  });
});

/* -------------------------------------------------------- bulk force refresh */

describe("Force refresh all", () => {
  it("runs exactly the eligible population (active + ids + owner connection) and excludes retired / not linked / no connection", async () => {
    mockBlizzardSuccess();
    const page = await characterOperationsService.getListPage(admin, parseCharacterOperationsFilters({}));
    const result = await characterOperationsService.forceRefreshAll(admin);
    expect(result.eligible).toBe(page.bulkEligibleCount);
    expect(result.succeeded + result.failed + result.skipped).toBe(result.eligible);
    for (const key of ["healthy", "stale", "error", "never"] as const) {
      expect((await characterRepository.findById(fx[key]!.id))!.lastSyncAttemptAt).toBeTruthy();
    }
    for (const key of ["retired", "notlinked", "noconn"] as const) {
      const row = (await characterRepository.findById(fx[key]!.id))!;
      expect(row.lastSyncAttemptAt).toBeNull();
    }
    const completed = (await orm.ActivityEvent.where({ userId: adminId, type: BULK_FORCE_REFRESH_COMPLETED_EVENT }).all()) as unknown[];
    expect(completed.length).toBeGreaterThan(0);
  });

  it("never runs more than 4 syncs at once", async () => {
    let inFlight = 0;
    let peak = 0;
    mockBlizzardSuccess();
    apiMocks.getCharacterProfileStatus.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return { id: undefined, isValid: true };
    });
    const result = await characterOperationsService.forceRefreshAll(admin);
    expect(result.eligible).toBeGreaterThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("one failure does not abort the batch", async () => {
    mockBlizzardSuccess();
    apiMocks.getCharacterProfileStatus.mockImplementation(async (_region: WowRegion, _slug: string, name: string) => {
      if (name === fx.stale!.name) throw new DomainError("BATTLENET_API_UNAVAILABLE", "x", 503);
      return { id: undefined, isValid: true };
    });
    const result = await characterOperationsService.forceRefreshAll(admin);
    expect(result.failures).toEqual([
      expect.objectContaining({ characterId: fx.stale!.id, errorCategory: "UPSTREAM_UNAVAILABLE", errorLabel: "Blizzard API unavailable" }),
    ]);
    expect(result.succeeded).toBe(result.eligible - 1);
    expect(JSON.stringify(result)).not.toMatch(/"message"/);
  });

  it("stops starting work after the first 429; the rest are skipped as rate limited", async () => {
    mockBlizzardSuccess();
    let calls = 0;
    apiMocks.getCharacterProfileStatus.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new DomainError("BATTLENET_RATE_LIMITED", "Battle.net rate limit reached.", 429);
      return { id: undefined, isValid: true };
    });
    const result = await characterOperationsService.forceRefreshAll(admin, { concurrency: 1 });
    expect(result.attempted).toBe(1);
    expect(result.failures[0]?.errorCategory).toBe("RATE_LIMITED");
    expect(result.skippedByReason.RATE_LIMITED).toBe(result.eligible - 1);
    expect(calls).toBe(1);
  });

  it("stops starting work after the time budget; unstarted Characters are skipped", async () => {
    mockBlizzardSuccess(40);
    const result = await characterOperationsService.forceRefreshAll(admin, { concurrency: 1, workBudgetMs: 60 });
    expect(result.attempted).toBeGreaterThanOrEqual(1);
    expect(result.attempted).toBeLessThan(result.eligible);
    expect(result.skippedByReason.TIME_BUDGET).toBe(result.eligible - result.attempted);
  });

  it("skips a Character that is already syncing and continues", async () => {
    mockBlizzardSuccess();
    const held = await tryAcquireCharacterSyncLock(fx.never!.id);
    try {
      const result = await characterOperationsService.forceRefreshAll(admin);
      expect(result.skippedCharacters).toContainEqual(
        expect.objectContaining({ characterId: fx.never!.id, reason: "ALREADY_SYNCING" }),
      );
      expect(result.succeeded).toBe(result.eligible - 1);
    } finally {
      await releaseCharacterSyncLock(held!);
    }
  });

  it("is refused while the scheduler holds the whole-job lock, and a second concurrent bulk run is refused", async () => {
    mockBlizzardSuccess();
    const handle = await scheduledJobLockRepository.tryAcquireLock(
      SCHEDULED_CHARACTER_SYNC_LOCK_KEY.classId,
      SCHEDULED_CHARACTER_SYNC_LOCK_KEY.objectId,
    );
    try {
      const error = await characterOperationsService.forceRefreshAll(admin).catch((caught) => caught);
      expect(isDomainError(error) && error.code).toBe("CHARACTER_SYNC_ALREADY_RUNNING");
      expect(error.message).toBe("Character synchronization is already in progress.");
      expect(apiMocks.getCharacterProfileStatus).not.toHaveBeenCalled();
    } finally {
      await scheduledJobLockRepository.releaseLock(handle!);
    }

    mockBlizzardSuccess(15);
    const results = await Promise.allSettled([
      characterOperationsService.forceRefreshAll(admin),
      characterOperationsService.forceRefreshAll(admin),
    ]);
    const rejected = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(["CHARACTER_SYNC_ALREADY_RUNNING", "CHARACTER_BULK_REFRESH_COOLDOWN"]).toContain(rejected[0]!.reason.code);
  });

  it("enforces the 10-minute bulk cooldown from acceptance; single Force refresh stays available", async () => {
    mockBlizzardSuccess();
    await characterOperationsService.forceRefreshAll(admin);
    await expect(characterOperationsService.forceRefreshAll(admin)).rejects.toMatchObject({
      code: "CHARACTER_BULK_REFRESH_COOLDOWN",
    });
    // Single-character Force refresh is unaffected by the bulk cooldown.
    const single = await characterOperationsService.syncCharacter(admin, { characterId: fx.healthy!.id, force: true });
    expect(single.status).toBe("SUCCEEDED");

    await orm.ActivityEvent.where({ type: BULK_FORCE_REFRESH_STARTED_EVENT }).update({
      occurredAt: new Date(Date.now() - 11 * 60_000).toISOString(),
    });
    await expect(characterOperationsService.forceRefreshAll(admin)).resolves.toMatchObject({ eligible: expect.any(Number) });
  });

  it("the cooldown starts even when every attempt fails", async () => {
    mockBlizzardSuccess();
    apiMocks.getCharacterProfileStatus.mockRejectedValue(new DomainError("BATTLENET_API_UNAVAILABLE", "x", 503));
    const result = await characterOperationsService.forceRefreshAll(admin);
    expect(result.succeeded).toBe(0);
    await expect(characterOperationsService.forceRefreshAll(admin)).rejects.toMatchObject({
      code: "CHARACTER_BULK_REFRESH_COOLDOWN",
    });
  });
});
