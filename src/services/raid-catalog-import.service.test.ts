import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { blizzardApiClient } from "@/integrations/blizzard/blizzard-api-client";
import type { WarcraftLogsCatalogZone } from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import { deriveCurrentResetLockouts } from "@/lib/blizzard/raid-lockout-derivation";
import type { BlizzardJournalInstance } from "@/lib/blizzard/types";
import { DomainError } from "@/lib/errors";
import { asNumber, asString } from "@/lib/persistence";
import { orm } from "@/lib/prisma";
import { getRegionalWeeklyReset } from "@/lib/wow-weekly-reset";
import { raidCatalogRepository } from "@/repositories/raid-catalog.repository";
import { raidRepository } from "@/repositories/raid.repository";
import {
  raidCatalogImportService,
  type RaidImportDeps,
} from "@/services/raid-catalog-import.service";
import { raidCatalogService } from "@/services/raid-catalog.service";

/**
 * Raid Catalog import / sync from the Blizzard journal. Battle.net and Warcraft
 * Logs are injected fakes (no live requests); the database is the isolated test DB.
 */

// Code seasons replaced by QA seasons, so the seeded Midnight raids are never touched.
vi.mock("@/lib/raid-seasons", () => {
  const seasons = [
    {
      key: "QA_CURRENT",
      name: "QA Season Current",
      current: true,
      journalInstanceIds: [994001, 994002, 994003],
    },
    {
      key: "QA_HISTORIC",
      name: "QA Season Historic",
      current: false,
      journalInstanceIds: [994101],
    },
  ];
  return {
    RAID_SEASONS: seasons,
    findRaidSeason: (key: string) => seasons.find((season) => season.key === key) ?? null,
    findRaidSeasonForInstance: (id: number) =>
      seasons.find((season) => season.journalInstanceIds.includes(id)) ?? null,
  };
});

// Legacy catalog writes (updateRaid / createRaid) run name-based discovery: keep it offline.
vi.mock("@/lib/blizzard/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blizzard/config")>()),
  isBlizzardConfigured: () => false,
}));
vi.mock("@/integrations/warcraft-logs/warcraft-logs-api-client", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/integrations/warcraft-logs/warcraft-logs-api-client")
  >()),
  warcraftLogsApiClient: {
    isConfigured: () => false,
    fetchZones: async () => ({ status: "NOT_CONFIGURED" as const }),
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

function instance(
  id: number,
  name: string,
  encounters: Array<[number, string]>,
  category = "RAID",
): BlizzardJournalInstance {
  return {
    id,
    name,
    category,
    expansion: "QA Expansion",
    encounters: encounters.map(([eid, ename]) => ({ id: eid, name: ename })),
  };
}

let journal = new Map<number, BlizzardJournalInstance>();
let zones: WarcraftLogsCatalogZone[] = [];
const fetchInstance = vi.fn(async (id: number) => journal.get(id) ?? null);
const deps: RaidImportDeps = {
  fetchInstance,
  fetchZones: async () => ({ status: "SUCCESS" as const, zones }),
};

function setJournal(...instances: BlizzardJournalInstance[]) {
  journal = new Map(instances.map((row) => [row.id, row]));
}

const ABYSS = () =>
  instance(994001, "QA Import Abyss", [
    [995001, "First Coil"],
    [995002, "Second Coil"],
    [995003, "Third Coil"],
  ]);

const QA_INSTANCE_IDS = [994001, 994002, 994003, 994101, 994201];

async function raidByInstance(instanceId: number) {
  return (
    (await raidRepository.loadCatalog()).raids.find(
      (raid) => raid.blizzardInstanceId === instanceId,
    ) ?? null
  );
}

async function countRaids(instanceId: number): Promise<number> {
  return (await orm.Raid.where({ blizzardInstanceId: instanceId }).all()).length;
}

async function cleanup() {
  const raids = (await orm.Raid.where((raid) =>
    raid.blizzardInstanceId.in(QA_INSTANCE_IDS),
  ).all()) as Array<Record<string, unknown>>;
  const raidIds = raids.map((row) => asString(row.id));
  if (raidIds.length === 0) {
    // Still drop a warm memo — a prior test may have deleted via raw orm.
    raidRepository.invalidateCatalogMemo();
    return;
  }
  await orm.RunRaidContent.where((row) => row.raidId.in(raidIds)).delete();
  await orm.Run.where((row) => row.title.like("QA Import %")).delete();
  await orm.RunTemplateRaidContent.where((row) => row.raidId.in(raidIds)).delete();
  await orm.RunTemplate.where((row) => row.name.like("QA Import %")).delete();
  await orm.ProductRaidContent.where((row) => row.raidId.in(raidIds)).delete();
  await orm.Product.where((row) => row.name.like("QA Import %")).delete();
  await orm.CharacterRaidLockout.where((row) => row.raidId.in(raidIds)).delete();
  for (const id of raidIds) await orm.Raid.where({ id }).delete();
  raidRepository.invalidateCatalogMemo();
}

beforeEach(async () => {
  await cleanup();
  zones = [];
  fetchInstance.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(cleanup);

describe("Import Raid", () => {
  it("imports one valid instance: raid name, bosses, order, derived count and encounter ids", async () => {
    setJournal(ABYSS());
    const preview = await raidCatalogImportService.previewRaidImport(admin, 994001, deps);
    expect(preview.plan.status).toBe("NEW");
    expect(preview.plan.bosses.map((boss) => boss.name)).toEqual([
      "First Coil",
      "Second Coil",
      "Third Coil",
    ]);
    expect(preview.defaults).toEqual({ season: "QA Season Current", trackLockouts: true });
    expect(await raidByInstance(994001)).toBeNull(); // preview never writes

    const result = await raidCatalogImportService.importRaid(
      admin,
      { journalInstanceId: 994001 },
      deps,
    );
    expect(result.created).toBe(1);

    const raid = (await raidByInstance(994001))!;
    expect(raid.name).toBe("QA Import Abyss"); // raid name derived
    expect(raid.season).toBe("QA Season Current");
    expect(raid.trackLockouts).toBe(true);
    expect(raid.availableForRuns).toBe(false); // admins enable new Runs explicitly
    expect(raid.bosses.map((boss) => [boss.sortOrder, boss.name])).toEqual([
      [1, "First Coil"],
      [2, "Second Coil"],
      [3, "Third Coil"],
    ]); // bosses imported, in journal order
    expect((await raidRepository.loadCatalog()).bossTotal(raid.id)).toBe(3); // count derived from RaidBoss rows
    expect(raid.bosses.map((boss) => boss.blizzardEncounterIds)).toEqual([
      [995001],
      [995002],
      [995003],
    ]);
    expect(raid.bosses.every((boss) => boss.wclEncounterIds.length === 0)).toBe(true); // never Blizzard ids as WCL ids
  });

  it("re-importing the same instance creates no duplicate raid or boss", async () => {
    setJournal(ABYSS());
    await raidCatalogImportService.importRaid(admin, { journalInstanceId: 994001 }, deps);
    const first = (await raidByInstance(994001))!;

    const again = await raidCatalogImportService.previewRaidImport(admin, 994001, deps);
    expect(again.plan.status).toBe("UP_TO_DATE");
    const result = await raidCatalogImportService.importRaid(
      admin,
      { journalInstanceId: 994001 },
      deps,
    );
    expect(result).toMatchObject({ created: 0, updated: 0, unchanged: 1 });

    expect(await countRaids(994001)).toBe(1);
    const second = (await raidByInstance(994001))!;
    expect(second.id).toBe(first.id);
    expect(second.bosses.map((boss) => boss.id)).toEqual(first.bosses.map((boss) => boss.id));
    expect((await orm.RaidBoss.where({ raidId: first.id }).all()).length).toBe(3);
  });

  it("adopts an existing unlinked raid of the same name instead of duplicating it", async () => {
    const { raidId } = await raidCatalogService.createRaid(admin, {
      name: "QA Import Abyss",
      season: "QA Manual",
      sortOrder: 90,
      trackLockouts: false,
      blizzardInstanceId: null,
    });
    await raidCatalogRepository.createEncounter({
      id: crypto.randomUUID(),
      raidId,
      name: "Second Coil",
      sortOrder: 1,
      blizzardEncounterIds: [],
      wclEncounterIds: [],
    });
    setJournal(ABYSS());
    const preview = await raidCatalogImportService.previewRaidImport(admin, 994001, deps);
    expect(preview.plan).toMatchObject({ status: "UPDATE_AVAILABLE", raidId, adopt: true });
    await raidCatalogImportService.importRaid(admin, { journalInstanceId: 994001 }, deps);
    const raid = (await raidByInstance(994001))!;
    expect(raid.id).toBe(raidId);
    expect(raid.season).toBe("QA Manual"); // BoostingHub-owned, kept
    expect(raid.bosses.map((boss) => [boss.name, boss.blizzardEncounterIds])).toEqual([
      ["First Coil", [995001]],
      ["Second Coil", [995002]],
      ["Third Coil", [995003]],
    ]);
    await orm.Raid.where({ id: raidId }).delete();
    raidRepository.invalidateCatalogMemo();
  });

  it("a failed or invalid Blizzard response writes nothing and explains why", async () => {
    fetchInstance.mockRejectedValueOnce(new DomainError("BATTLENET_API_UNAVAILABLE", "down", 503));
    await expect(
      raidCatalogImportService.importRaid(admin, { journalInstanceId: 994001 }, deps),
    ).rejects.toMatchObject({
      code: "BLIZZARD_JOURNAL_UNAVAILABLE",
      message: expect.stringContaining("Nothing was imported"),
    });

    fetchInstance.mockRejectedValueOnce(
      new DomainError("BLIZZARD_CHARACTER_NOT_FOUND", "404", 404),
    );
    await expect(
      raidCatalogImportService.importRaid(admin, { journalInstanceId: 994001 }, deps),
    ).rejects.toMatchObject({
      code: "BLIZZARD_JOURNAL_INSTANCE_NOT_FOUND",
    });

    setJournal(instance(994001, "QA Dungeon", [[995001, "Boss"]], "DUNGEON"));
    await expect(
      raidCatalogImportService.importRaid(admin, { journalInstanceId: 994001 }, deps),
    ).rejects.toMatchObject({
      code: "BLIZZARD_JOURNAL_NOT_RAID",
    });

    expect(await countRaids(994001)).toBe(0);
  });
});

describe("Refresh from Blizzard", () => {
  it("updates only Blizzard-owned metadata: raid name, boss names, order, encounter ids", async () => {
    setJournal(ABYSS());
    await raidCatalogImportService.importRaid(admin, { journalInstanceId: 994001 }, deps);
    const before = (await raidByInstance(994001))!;
    await raidCatalogService.updateRaid(admin, {
      raidId: before.id,
      name: before.name,
      season: "QA Admin Season",
      sortOrder: 77,
      trackLockouts: false,
      availableForRuns: true,
      blizzardInstanceId: before.blizzardInstanceId,
    });

    setJournal(
      instance(994001, "QA Import Abyss (Renamed)", [
        [995002, "Second Coil"],
        [995001, "First Coil, Reborn"],
        [995003, "Third Coil"],
      ]),
    );
    const preview = await raidCatalogImportService.previewRaidRefresh(admin, before.id, deps);
    expect(preview.plan.status).toBe("UPDATE_AVAILABLE");
    await raidCatalogImportService.refreshRaid(admin, before.id, deps);

    const after = (await raidByInstance(994001))!;
    expect(after.id).toBe(before.id);
    expect(after.name).toBe("QA Import Abyss (Renamed)");
    expect(
      after.bosses.map((boss) => [boss.sortOrder, boss.name, boss.blizzardEncounterIds]),
    ).toEqual([
      [1, "Second Coil", [995002]],
      [2, "First Coil, Reborn", [995001]],
      [3, "Third Coil", [995003]],
    ]);
    // Boss identity (UUID) follows the encounter id, not the position.
    const idByEncounter = new Map(
      before.bosses.map((boss) => [boss.blizzardEncounterIds[0], boss.id]),
    );
    expect(after.bosses.map((boss) => boss.id)).toEqual(
      after.bosses.map((boss) => idByEncounter.get(boss.blizzardEncounterIds[0])),
    );
    // BoostingHub-owned fields untouched.
    expect(after).toMatchObject({
      season: "QA Admin Season",
      sortOrder: 77,
      trackLockouts: false,
      availableForRuns: true,
    });
  });

  it("an unused raid follows Blizzard (adds and removes bosses)", async () => {
    setJournal(ABYSS());
    await raidCatalogImportService.importRaid(admin, { journalInstanceId: 994001 }, deps);
    const raid = (await raidByInstance(994001))!;
    setJournal(
      instance(994001, "QA Import Abyss", [
        [995001, "First Coil"],
        [995003, "Third Coil"],
        [995004, "Fourth Coil"],
      ]),
    );
    await raidCatalogImportService.refreshRaid(admin, raid.id, deps);
    const after = (await raidByInstance(994001))!;
    expect(after.bosses.map((boss) => boss.name)).toEqual([
      "First Coil",
      "Third Coil",
      "Fourth Coil",
    ]);
  });

  it("Products, Run Setups and Runs survive a refresh; an in-use raid keeps its boss set for reconciliation", async () => {
    setJournal(ABYSS());
    await raidCatalogImportService.importRaid(admin, { journalInstanceId: 994001 }, deps);
    const raid = (await raidByInstance(994001))!;
    const now = new Date().toISOString();

    const { productId } = await raidCatalogService.createProduct(admin, {
      name: "QA Import Product",
      active: true,
      selectable: true,
      sortOrder: 99,
      contents: [
        {
          raidId: raid.id,
          bossCountMode: "FIXED",
          fixedBossCount: 3,
          minBossCount: null,
          defaultBossCount: null,
        },
      ],
    });
    const templateId = crypto.randomUUID();
    await orm.RunTemplate.create({
      id: templateId,
      name: "QA Import Template",
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      isActive: true,
      createdById: admin.id,
      updatedById: admin.id,
      createdAt: now,
      updatedAt: now,
    });
    await orm.RunTemplateRaidContent.create({
      id: crypto.randomUUID(),
      runTemplateId: templateId,
      raidId: raid.id,
      sortOrder: 1,
      plannedBossCount: 2,
      createdAt: now,
    });
    const runId = crypto.randomUUID();
    await orm.Run.create({
      id: runId,
      title: "QA Import Run",
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      status: "COMPLETED",
      signupsOpen: false,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      raidLeadId: admin.id,
      notes: null,
      createdAt: now,
      updatedAt: now,
    });
    await orm.RunRaidContent.create({
      id: crypto.randomUUID(),
      runId,
      raidId: raid.id,
      sortOrder: 1,
      plannedBossCount: 3,
      createdAt: now,
    });

    const snapshot = async () => ({
      product: await orm.ProductRaidContent.where({ productId }).all(),
      template: await orm.RunTemplateRaidContent.where({ runTemplateId: templateId }).all(),
      run: await orm.RunRaidContent.where({ runId }).all(),
      runRow: await orm.Run.where({ id: runId }).first(),
    });
    const before = await snapshot();

    // Blizzard renames a boss, drops one and adds another.
    setJournal(
      instance(994001, "QA Import Abyss", [
        [995001, "First Coil Renamed"],
        [995002, "Second Coil"],
        [995004, "Fourth Coil"],
      ]),
    );
    const preview = await raidCatalogImportService.previewRaidRefresh(admin, raid.id, deps);
    expect(preview.plan.structureLocked).toBe(true);
    expect(preview.plan.unaddedEncounters.map((row) => row.name)).toEqual(["Fourth Coil"]);
    expect(preview.plan.staleBosses.map((row) => row.name)).toEqual(["Third Coil"]);
    await raidCatalogImportService.refreshRaid(admin, raid.id, deps);

    const after = (await raidByInstance(994001))!;
    expect(after.bosses.map((boss) => boss.name)).toEqual([
      "First Coil Renamed",
      "Second Coil",
      "Third Coil",
    ]);
    expect(after.bosses.map((boss) => boss.id).sort()).toEqual(
      raid.bosses.map((boss) => boss.id).sort(),
    );
    expect(await snapshot()).toEqual(before);
    expect(asNumber((before.product[0] as Record<string, unknown>).fixedBossCount)).toBe(3);
  });

  it("never overwrites manual Warcraft Logs ids; fills only unique matches; ambiguous stays unmapped", async () => {
    setJournal(ABYSS());
    await raidCatalogImportService.importRaid(admin, { journalInstanceId: 994001 }, deps);
    const raid = (await raidByInstance(994001))!;
    const [first, second, third] = raid.bosses;
    await raidCatalogRepository.updateEncounter(first!.id, {
      name: first!.name,
      blizzardEncounterIds: first!.blizzardEncounterIds,
      wclEncounterIds: [996900], // manual override
    });

    zones = [
      {
        id: 996000,
        name: "QA Import Abyss",
        encounters: [
          { id: 996001, name: "First Coil", journalId: 995001 },
          { id: 996002, name: "Second Coil", journalId: 995002 },
          // Two WCL encounters share the name → not uniquely resolvable.
          { id: 996003, name: "Third Coil", journalId: 995003 },
          { id: 996004, name: "Third Coil", journalId: null },
        ],
      },
    ];
    await raidCatalogImportService.refreshRaid(admin, raid.id, deps);

    const after = (await raidByInstance(994001))!;
    expect(after.wclZoneId).toBe(996000);
    const wcl = new Map(after.bosses.map((boss) => [boss.id, boss.wclEncounterIds]));
    expect(wcl.get(first!.id)).toEqual([996900]); // manual kept
    expect(wcl.get(second!.id)).toEqual([996002]); // unique → automatic
    expect(wcl.get(third!.id)).toEqual([]); // ambiguous → needs mapping
    expect(
      after.bosses.every(
        (boss) => !boss.wclEncounterIds.some((id) => boss.blizzardEncounterIds.includes(id)),
      ),
    ).toBe(true);
  });
});

describe("Import Season", () => {
  const SEASON = () => [
    ABYSS(),
    instance(994002, "QA Import Grotto", [[995101, "Wavecaller"]]),
    instance(994003, "QA Import Unbinding", [[995201, "Kith"]]),
  ];

  it("imports every configured raid of the season; current season tracks lockouts", async () => {
    setJournal(...SEASON());
    const preview = await raidCatalogImportService.previewSeasonImport(admin, "QA_CURRENT", deps);
    expect(preview.plans.map((plan) => [plan.name, plan.status, plan.bosses.length])).toEqual([
      ["QA Import Abyss", "NEW", 3],
      ["QA Import Grotto", "NEW", 1],
      ["QA Import Unbinding", "NEW", 1],
    ]);

    const result = await raidCatalogImportService.importSeason(
      admin,
      { seasonKey: "QA_CURRENT" },
      deps,
    );
    expect(result.created).toBe(3);
    for (const id of [994001, 994002, 994003]) {
      const raid = (await raidByInstance(id))!;
      expect(raid).toMatchObject({ season: "QA Season Current", trackLockouts: true });
      expect(raid.bosses.length).toBeGreaterThan(0);
    }
  });

  it("is idempotent and reports per-raid status on re-import", async () => {
    setJournal(...SEASON());
    await raidCatalogImportService.importSeason(admin, { seasonKey: "QA_CURRENT" }, deps);
    const ids = await Promise.all(
      [994001, 994002, 994003].map(async (id) => (await raidByInstance(id))!.id),
    );

    setJournal(
      ...SEASON().map((row) => (row.id === 994002 ? { ...row, name: "QA Import Grotto II" } : row)),
    );
    const preview = await raidCatalogImportService.previewSeasonImport(admin, "QA_CURRENT", deps);
    expect(preview.plans.map((plan) => plan.status)).toEqual([
      "UP_TO_DATE",
      "UPDATE_AVAILABLE",
      "UP_TO_DATE",
    ]);

    const result = await raidCatalogImportService.importSeason(
      admin,
      { seasonKey: "QA_CURRENT" },
      deps,
    );
    expect(result).toMatchObject({ created: 0, updated: 1, unchanged: 2 });
    await raidCatalogImportService.importSeason(admin, { seasonKey: "QA_CURRENT" }, deps);
    for (const [index, id] of [994001, 994002, 994003].entries()) {
      expect(await countRaids(id)).toBe(1);
      expect((await raidByInstance(id))!.id).toBe(ids[index]);
    }
    expect((await raidByInstance(994002))!.name).toBe("QA Import Grotto II");
  });

  it("historic seasons leave lockout tracking to the admin", async () => {
    setJournal(instance(994101, "QA Import Old Raid", [[995301, "Old Boss"]]));
    await raidCatalogImportService.importSeason(admin, { seasonKey: "QA_HISTORIC" }, deps);
    expect((await raidByInstance(994101))!.trackLockouts).toBe(false);
  });

  it("one failed Blizzard request aborts the whole season: nothing is written", async () => {
    setJournal(ABYSS(), instance(994003, "QA Import Unbinding", [[995201, "Kith"]])); // 994002 missing → 404
    await expect(
      raidCatalogImportService.importSeason(admin, { seasonKey: "QA_CURRENT" }, deps),
    ).rejects.toMatchObject({
      code: "BLIZZARD_JOURNAL_INSTANCE_NOT_FOUND",
    });
    for (const id of [994001, 994002, 994003]) expect(await countRaids(id)).toBe(0);
  });
});

describe("Lockouts", () => {
  it("a Character Encounters response maps lockouts to the imported raid without extra config", async () => {
    setJournal(ABYSS());
    await raidCatalogImportService.importRaid(admin, { journalInstanceId: 994001 }, deps);
    const raid = (await raidByInstance(994001))!;

    const now = new Date();
    const killedAt = now.getTime() - 60 * 60 * 1000;
    const encounter = (id: number, name: string) => ({
      encounter: {
        key: { href: `https://eu.api.blizzard.com/data/wow/journal-encounter/${id}` },
        name,
        id,
      },
      completed_count: 1,
      last_kill_timestamp: killedAt,
    });
    const payload = {
      expansions: [
        {
          expansion: { name: "QA Expansion", id: 1 },
          instances: [
            {
              instance: {
                key: { href: "https://eu.api.blizzard.com/data/wow/journal-instance/994001" },
                name: "QA Import Abyss",
                id: 994001,
              },
              modes: [
                {
                  difficulty: { type: "HEROIC", name: "Heroic" },
                  status: { type: "IN_PROGRESS" },
                  progress: {
                    completed_count: 2,
                    total_count: 3,
                    encounters: [encounter(995001, "First Coil"), encounter(995003, "Third Coil")],
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    vi.spyOn(blizzardApiClient, "getClientCredentialsToken").mockResolvedValue("test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
    );
    const encounters = await blizzardApiClient.getCharacterRaidEncounters("EU", "qa-realm", "Qa");

    const catalog = await raidRepository.loadCatalog();
    const derived = deriveCurrentResetLockouts({
      region: "EU",
      encounters,
      lockoutRaids: catalog.lockoutRaids,
      now,
      resetWindow: getRegionalWeeklyReset("EU", now),
    });
    expect(derived.status).toBe("derived");
    if (derived.status !== "derived") return;
    const heroic = derived.raids
      .find((row) => row.raidId === raid.id)!
      .difficulties.find((row) => row.difficulty === "HEROIC")!;
    expect(heroic).toMatchObject({ bossesDefeated: 2, bossTotal: 3, isComplete: false });
    expect(heroic.bosses.filter((boss) => boss.killedThisReset).map((boss) => boss.name)).toEqual([
      "First Coil",
      "Third Coil",
    ]);
  });
});

describe("Raid status", () => {
  it("shows Blizzard synced, bosses N/N mapped, lockouts ready and WCL needs mapping after an import", async () => {
    setJournal(ABYSS());
    const { raidIds } = await raidCatalogImportService.importRaid(
      admin,
      { journalInstanceId: 994001 },
      deps,
    );
    const row = (await raidCatalogService.getPage(admin)).raids.find(
      (raid) => raid.id === raidIds[0],
    )!;
    expect(row.status).toEqual({
      blizzardLinked: true,
      bossTotal: 3,
      bossesMapped: 3,
      lockouts: "READY",
      warcraftLogs: "NEEDS_MAPPING",
    });
  });
});
