import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { blizzardApiClient } from "@/integrations/blizzard/blizzard-api-client";
import type { BlizzardJournalInstance } from "@/lib/blizzard/types";
import { orm } from "@/lib/prisma";
import { raidRepository } from "@/repositories/raid.repository";
import { raidCatalogService } from "@/services/raid-catalog.service";

/**
 * Raid Catalog writes take the Blizzard ids from the Blizzard journal (mocked
 * here — no live Battle.net): empty fields are filled, manual values survive
 * soft discovery, Retry detection replaces them with the journal's ids
 * (the Kith'ix case: wrong 17059 / 3271 → 1324 / 2896).
 */

vi.mock("@/lib/blizzard/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blizzard/config")>()),
  isBlizzardConfigured: () => true,
}));
// No live Warcraft Logs: WCL zone discovery (on raid / encounter writes) sees an empty zone list.
vi.mock("@/integrations/warcraft-logs/warcraft-logs-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/warcraft-logs/warcraft-logs-api-client")>()),
  warcraftLogsApiClient: {
    isConfigured: () => true,
    fetchZones: async () => ({ status: "SUCCESS" as const, zones: [] }),
  },
}));

/** Seeded ADMIN (src/prisma/seed.ts). */
const admin: AuthenticatedUser = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Aelira Nightwatch",
  email: "aelira@dev.boostting.local",
  image: null,
  discordUserId: null,
  discordUsername: null,
  accountRole: "ADMIN",
  accountStatus: "ACTIVE",
};

const JOURNAL: BlizzardJournalInstance[] = [
  { id: 991324, name: "QA Unbinding of Journal Boss", category: "RAID", encounters: [{ id: 992896, name: "Journal Boss" }] },
  {
    id: 991320,
    name: "QA Journal Abyss",
    category: "RAID",
    encounters: [
      { id: 992888, name: "First Coil" },
      { id: 992874, name: "Second Coil" },
    ],
  },
];

const createdRaidIds: string[] = [];

async function catalogRaid(raidId: string) {
  return (await raidRepository.loadCatalog()).raids.find((raid) => raid.id === raidId)!;
}

async function newRaid(name: string, blizzardInstanceId: number | null) {
  const { raidId } = await raidCatalogService.createRaid(admin, {
    name,
    season: "QA",
    sortOrder: 95,
    trackLockouts: true,
    blizzardInstanceId,
  });
  createdRaidIds.push(raidId);
  return raidId;
}

beforeAll(() => {
  vi.spyOn(blizzardApiClient, "getJournalInstanceIndex").mockResolvedValue(
    JOURNAL.map(({ id, name }) => ({ id, name })),
  );
  vi.spyOn(blizzardApiClient, "getJournalInstance").mockImplementation(
    async (_region, id) => JOURNAL.find((instance) => instance.id === id) ?? null,
  );
});

afterAll(async () => {
  vi.restoreAllMocks();
  for (const id of createdRaidIds) await orm.Raid.where({ id }).delete().catch(() => {});
});

describe("Raid Catalog — Blizzard journal discovery", () => {
  it("fills the instance id on create and each boss's encounter id when it is added", async () => {
    const raidId = await newRaid("QA Journal Abyss", null);
    expect((await catalogRaid(raidId)).blizzardInstanceId).toBe(991320);

    await raidCatalogService.createEncounter(admin, { raidId, name: "First Coil", blizzardEncounterIds: [] });
    await raidCatalogService.createEncounter(admin, { raidId, name: "Unknown Coil", blizzardEncounterIds: [] });
    const bosses = (await catalogRaid(raidId)).bosses;
    expect(bosses.map((boss) => [boss.name, boss.blizzardEncounterIds])).toEqual([
      ["First Coil", [992888]],
      ["Unknown Coil", []], // no exact match → never guessed
    ]);
  });

  it("keeps manual ids on soft discovery; Retry detection replaces them with the journal's (Kith'ix case)", async () => {
    const raidId = await newRaid("QA Unbinding of Journal Boss", 997059);
    await raidCatalogService.createEncounter(admin, {
      raidId,
      name: "QA Unbinding of Journal Boss",
      blizzardEncounterIds: [993271],
    });
    let raid = await catalogRaid(raidId);
    expect(raid.blizzardInstanceId).toBe(997059);
    expect(raid.bosses[0]!.blizzardEncounterIds).toEqual([993271]);

    await raidCatalogService.retryWclDetection(admin, raidId);
    raid = await catalogRaid(raidId);
    expect(raid.blizzardInstanceId).toBe(991324);
    // Single-boss raid named after the event → the instance's only encounter.
    expect(raid.bosses[0]!.blizzardEncounterIds).toEqual([992896]);
  });

  it("a Battle.net outage never fails the catalog write", async () => {
    vi.mocked(blizzardApiClient.getJournalInstanceIndex).mockRejectedValueOnce(new Error("Battle.net down"));
    const raidId = await newRaid("QA Journal Outage", null);
    expect((await catalogRaid(raidId)).blizzardInstanceId).toBeNull();
  });
});
