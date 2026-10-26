import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { blizzardApiClient } from "@/integrations/blizzard/blizzard-api-client";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { contentShortTitle, raidShortName } from "@/lib/raid-catalog";
import { venomousCreateInput } from "@/lib/test-run-input";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { discordSyncService } from "@/services/discord-sync.service";
import { raidCatalogService } from "@/services/raid-catalog.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";
import { normalizeSignupNote } from "@/services/signup-state";

vi.mock("@/integrations/warcraft-logs/warcraft-logs-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/warcraft-logs/warcraft-logs-api-client")>()),
  warcraftLogsApiClient: { isConfigured: () => true, fetchZones: async () => ({ status: "SUCCESS" as const, zones: [] }) },
}));

/**
 * Signup notes (Discord "Add / Edit Note"): one note per User and Run, stored
 * on their active signups, shown on the Signup embed; and the Raid short name
 * feeding the embed title.
 */

const ids = {
  lead: "b2d50000-0000-4000-8000-000000000001",
  booster: "b2d50000-0000-4000-8000-000000000002",
  outsider: "b2d50000-0000-4000-8000-000000000003",
  admin: "b2d50000-0000-4000-8000-000000000004",
};
function actor(id: string, accountRole: AuthenticatedUser["accountRole"]): AuthenticatedUser {
  return { id, name: id, email: `${id}@note.local`, image: null, discordUserId: null, discordUsername: null, accountRole, accountStatus: "ACTIVE" };
}
const lead = actor(ids.lead, "RAID_LEAD");
const booster = actor(ids.booster, "USER");
const outsider = actor(ids.outsider, "USER");
const admin = actor(ids.admin, "ADMIN");
let runId = "";
let originalShortName: string | null = null;

async function expectCode(promise: Promise<unknown>, code: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(isDomainError(caught) ? caught.code : caught).toBe(code);
}

/** Row-by-row: an ORM `update` on a non-unique filter touches one row. */
async function setBoosterSignupStatus(status: "WITHDRAWN" | "PENDING") {
  for (const row of (await orm.RunSignup.where({ runId, userId: ids.booster }).select("id").all()) as Array<{ id: string }>) {
    await orm.RunSignup.where({ id: row.id }).update({ status });
  }
}

async function cleanup() {
  for (const row of (await orm.Run.where({ raidLeadId: ids.lead }).select("id").all()) as Array<{ id: string }>) {
    await orm.Run.where({ id: row.id }).delete().catch(() => {});
  }
  for (const id of Object.values(ids)) {
    await orm.Character.where({ userId: id }).delete().catch(() => {});
    await orm.ActivityEvent.where({ userId: id }).delete().catch(() => {});
    await orm.User.where({ id }).delete().catch(() => {});
  }
}

beforeAll(async () => {
  vi.spyOn(blizzardApiClient, "getJournalInstanceIndex").mockResolvedValue([]);
  vi.spyOn(blizzardApiClient, "getJournalInstance").mockResolvedValue(null);
  await raidRepository.ensureReferenceRaids();
  await cleanup();
  const now = new Date().toISOString();
  for (const [id, role] of [[ids.lead, "RAID_LEAD"], [ids.booster, "USER"], [ids.outsider, "USER"], [ids.admin, "ADMIN"]] as const) {
    await orm.User.create({ id, name: id, email: `${id}@note.local`, emailVerified: true, accountRole: role, accountStatus: "ACTIVE", isBooster: false, createdAt: now, updatedAt: now });
  }
  const run = await runService.createRun(lead, venomousCreateInput());
  runId = run.id;
  await orm.Run.where({ id: runId }).update({ status: "OPEN" });
  for (const [name, wowClass] of [["Notey", "SHAMAN"], ["Notealt", "MAGE"]] as const) {
    const characterId = crypto.randomUUID();
    await orm.Character.create({
      id: characterId, userId: ids.booster, name, realm: "Note", normalizedName: normalizeCharacterIdentity(name),
      normalizedRealm: normalizeCharacterIdentity("Note"), region: "EU", wowClass, specialization: null, primaryRole: "RANGED_DPS",
      itemLevel: 700, isActive: true, createdAt: now, updatedAt: now,
    });
    await orm.RunSignup.create({
      id: crypto.randomUUID(), runId, userId: ids.booster, characterId, participationType: "BOOSTER", isBackup: false,
      status: "PENDING", publishedRole: null, createdAt: now, updatedAt: now,
    });
  }
  originalShortName = (await raidRepository.loadCatalog()).findById(VENOMOUS_ABYSS_RAID_ID)!.shortName;
});

afterAll(async () => {
  await orm.Raid.where({ id: VENOMOUS_ABYSS_RAID_ID }).update({ shortName: originalShortName });
  raidRepository.invalidateCatalogMemo();
  await cleanup();
});

describe("signup notes", () => {
  it("normalizes to one short line; blank clears; over 100 characters is refused", () => {
    expect(normalizeSignupNote("  can   also\nplay Ele ")).toBe("can also play Ele");
    expect(normalizeSignupNote("   ")).toBeNull();
    expect(normalizeSignupNote(null)).toBeNull();
    expect(() => normalizeSignupNote("x".repeat(101))).toThrow();
  });

  it("is stored on every active signup of the User and shown once on the Signup embed", async () => {
    const saved = await signupService.setRunNote(booster, { runId, note: "can also play Ele" });
    expect(saved).toEqual({ note: "can also play Ele", updated: 2 });
    expect(await signupService.getRunNote(booster, { runId })).toEqual({ note: "can also play Ele" });
    const embed = await discordSyncService.getSignupEmbedData(runId);
    expect(embed?.notes).toEqual([
      expect.objectContaining({ userId: ids.booster, note: "can also play Ele" }),
    ]);
  });

  it("editing replaces the note; clearing removes it from the embed", async () => {
    await signupService.setRunNote(booster, { runId, note: "~10 min late" });
    expect((await discordSyncService.getSignupEmbedData(runId))?.notes?.map((row) => row.note)).toEqual(["~10 min late"]);
    await signupService.setRunNote(booster, { runId, note: "  " });
    expect((await discordSyncService.getSignupEmbedData(runId))?.notes).toEqual([]);
    expect(await signupService.getRunNote(booster, { runId })).toEqual({ note: null });
  });

  it("needs an active signup; a withdrawn User's note leaves the embed", async () => {
    await expectCode(signupService.setRunNote(outsider, { runId, note: "hi" }), "NOT_FOUND");
    await signupService.setRunNote(booster, { runId, note: "bring flask" });
    await setBoosterSignupStatus("WITHDRAWN");
    expect((await discordSyncService.getSignupEmbedData(runId))?.notes).toEqual([]);
    await expectCode(signupService.setRunNote(booster, { runId, note: "again" }), "NOT_FOUND");
    await setBoosterSignupStatus("PENDING");
  });

  it("an ended Run refuses note changes", async () => {
    await orm.Run.where({ id: runId }).update({ status: "COMPLETED" });
    await expectCode(signupService.setRunNote(booster, { runId, note: "late" }), "INVALID_STATE_TRANSITION");
    await orm.Run.where({ id: runId }).update({ status: "OPEN" });
  });
});

describe("Raid short names", () => {
  it("derives a short name when none is stored; explicit names win", () => {
    expect(raidShortName({ name: "The Venomous Abyss" })).toBe("Venomous");
    expect(raidShortName({ name: "The Unbinding of Kith'ix" })).toBe("Kith'ix");
    expect(raidShortName({ name: "The Venomous Abyss", shortName: " Venom " })).toBe("Venom");
    expect(
      contentShortTitle([
        { sortOrder: 2, raidName: "The Tidebound Grotto", raidShortName: "Tide" },
        { sortOrder: 1, raidName: "The Venomous Abyss", raidShortName: "Venom" },
        { sortOrder: 3, raidName: "The Unbinding of Kith'ix", raidShortName: "Kithix" },
      ]),
    ).toBe("Venom & Tide & Kithix");
  });

  it("an admin edit of the short name reaches the Signup embed title; omitting it keeps it", async () => {
    const raid = (await raidRepository.loadCatalog()).findById(VENOMOUS_ABYSS_RAID_ID)!;
    const base = {
      raidId: raid.id,
      name: raid.name,
      season: raid.season,
      sortOrder: raid.sortOrder,
      trackLockouts: raid.trackLockouts,
      availableForRuns: raid.availableForRuns,
      blizzardInstanceId: raid.blizzardInstanceId,
    };
    await raidCatalogService.updateRaid(admin, { ...base, shortName: "VA" });
    expect((await discordSyncService.getSignupEmbedData(runId))?.contentTitle).toBe("VA");
    await raidCatalogService.updateRaid(admin, base);
    expect((await raidRepository.loadCatalog()).findById(VENOMOUS_ABYSS_RAID_ID)!.shortName).toBe("VA");
    await raidCatalogService.updateRaid(admin, { ...base, shortName: null });
    expect((await discordSyncService.getSignupEmbedData(runId))?.contentTitle).toBe("Venomous");
  });
});
