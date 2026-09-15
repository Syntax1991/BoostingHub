import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import {
  MANAFORGE_OMEGA_RAID_ID,
  NYMRISSA_WAVECALLER_BOSS_ID,
  TIDEBOUND_GROTTO_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
  findRaidCatalogById,
  getCurrentLockoutRaids,
} from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import { runService } from "@/services/run.service";

const ids = {
  lead: "cccccccc-cccc-4ccc-8ccc-mrf000000001",
};

const createdRunIds: string[] = [];

function asLead(): AuthenticatedUser {
  return {
    id: ids.lead,
    name: "MultiRaid Foundation Lead",
    email: `${ids.lead}@mrf.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole: "RAID_LEAD",
    accountStatus: "ACTIVE",
  };
}

async function deleteIfPresent(table: "User" | "Run" | "RunRaidContent" | "RunRoster", id: string) {
  try {
    if (table === "User") await orm.User.where({ id }).delete();
    else if (table === "RunRaidContent") await orm.RunRaidContent.where({ id }).delete();
    else if (table === "RunRoster") await orm.RunRoster.where({ id }).delete();
    else if (table === "Run") await orm.Run.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

async function cleanupRun(runId: string) {
  const roster = await orm.RunRoster.where({ runId }).first();
  if (roster) {
    await orm.RunRoster.where({ id: String((roster as { id: string }).id) }).delete();
  }
  // RunRaidContent cascades on Run delete; delete Run last.
  await deleteIfPresent("Run", runId);
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await deleteIfPresent("User", ids.lead);
  const now = new Date().toISOString();
  await orm.User.create({
    id: ids.lead,
    name: "MultiRaid Foundation Lead",
    email: `${ids.lead}@mrf.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole: "RAID_LEAD",
    accountStatus: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
}, 60_000);

afterAll(async () => {
  for (const runId of createdRunIds) {
    await cleanupRun(runId);
  }
  await deleteIfPresent("User", ids.lead);
}, 60_000);

describe("Tidebound / Nymrissa catalog (verified Blizzard ids)", () => {
  it("exposes Tidebound instance 1317 and Nymrissa encounter 2849", () => {
    const tidebound = findRaidCatalogById(TIDEBOUND_GROTTO_RAID_ID)!;
    expect(tidebound.name).toBe("The Tidebound Grotto");
    expect(tidebound.season).toBe("Midnight Season 2");
    expect(tidebound.blizzardInstanceId).toBe(1317);
    expect(tidebound.currentForLockouts).toBe(true);
    expect(tidebound.availableForRuns).toBe(false);
    expect(tidebound.bosses).toHaveLength(1);
    expect(tidebound.bosses[0]?.id).toBe(NYMRISSA_WAVECALLER_BOSS_ID);
    expect(tidebound.bosses[0]?.name).toBe("Nymrissa Wavecaller");
    expect(tidebound.bosses[0]?.blizzardEncounterIds).toEqual([2849]);
  });

  it("keeps Venomous current for lockouts and getCurrentLockoutRaids includes both", () => {
    const venomous = findRaidCatalogById(VENOMOUS_ABYSS_RAID_ID)!;
    expect(venomous.currentForLockouts).toBe(true);
    const idsInLockouts = getCurrentLockoutRaids().map((raid) => raid.id).sort();
    expect(idsInLockouts).toEqual([TIDEBOUND_GROTTO_RAID_ID, VENOMOUS_ABYSS_RAID_ID].sort());
  });

  it("bootstrap upserts Tidebound without changing Venomous/Manaforge identities", async () => {
    await raidRepository.ensureReferenceRaids();
    const tidebound = await raidRepository.findById(TIDEBOUND_GROTTO_RAID_ID);
    const venomous = await raidRepository.findById(VENOMOUS_ABYSS_RAID_ID);
    const manaforge = await raidRepository.findById(MANAFORGE_OMEGA_RAID_ID);
    expect(tidebound?.totalBossCount).toBe(1);
    expect(venomous?.totalBossCount).toBe(8);
    expect(manaforge?.totalBossCount).toBe(8);
  });
});

describe("RunRaidContent transitional invariant", () => {
  it("createRun writes exactly one matching content row", async () => {
    const created = await runService.createRun(asLead(), {
      raidId: VENOMOUS_ABYSS_RAID_ID,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 6,
      scheduledStartAt: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString(),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    createdRunIds.push(created.id);

    const run = await runRepository.findById(created.id);
    const contents = await runRepository.listRaidContents(created.id);
    expect(run?.raidId).toBe(VENOMOUS_ABYSS_RAID_ID);
    expect(run?.plannedBossCount).toBe(6);
    expect(contents).toHaveLength(1);
    expect(contents[0]?.raidId).toBe(run?.raidId);
    expect(contents[0]?.plannedBossCount).toBe(run?.plannedBossCount);
    expect(contents[0]?.sortOrder).toBe(1);
  });

  it("createManyDraftsAtomic writes one content per Run", async () => {
    const schedule = new Date(Date.now() + 41 * 24 * 60 * 60 * 1000).toISOString();
    const idsCreated = await runRepository.createManyDraftsAtomic([
      {
        title: "Mass A",
        raidId: VENOMOUS_ABYSS_RAID_ID,
        difficulty: "NORMAL",
        lootType: "UNSAVED",
        scheduledStartAt: schedule,
        raidLeadId: ids.lead,
        notes: null,
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        plannedBossCount: 4,
      },
      {
        title: "Mass B",
        raidId: VENOMOUS_ABYSS_RAID_ID,
        difficulty: "NORMAL",
        lootType: "UNSAVED",
        scheduledStartAt: new Date(Date.parse(schedule) + 3 * 60 * 60 * 1000).toISOString(),
        raidLeadId: ids.lead,
        notes: null,
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        plannedBossCount: 5,
      },
    ]);
    createdRunIds.push(...idsCreated);

    for (const runId of idsCreated) {
      const run = await runRepository.findById(runId);
      const contents = await runRepository.listRaidContents(runId);
      expect(contents).toHaveLength(1);
      expect(contents[0]?.raidId).toBe(run?.raidId);
      expect(contents[0]?.plannedBossCount).toBe(run?.plannedBossCount);
      expect(contents[0]?.sortOrder).toBe(1);
    }
  });

  it("updateFields keeps sole content plannedBossCount synchronized", async () => {
    const created = await runService.createRun(asLead(), {
      raidId: VENOMOUS_ABYSS_RAID_ID,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 3,
      scheduledStartAt: new Date(Date.now() + 42 * 24 * 60 * 60 * 1000).toISOString(),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    createdRunIds.push(created.id);

    await runRepository.updateFields(created.id, { plannedBossCount: 7 });
    const run = await runRepository.findById(created.id);
    const contents = await runRepository.listRaidContents(created.id);
    expect(run?.plannedBossCount).toBe(7);
    expect(contents).toHaveLength(1);
    expect(contents[0]?.plannedBossCount).toBe(7);
  });

  it("rejects duplicate runId+raidId and runId+sortOrder", async () => {
    const created = await runService.createRun(asLead(), {
      raidId: VENOMOUS_ABYSS_RAID_ID,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 2,
      scheduledStartAt: new Date(Date.now() + 43 * 24 * 60 * 60 * 1000).toISOString(),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    createdRunIds.push(created.id);
    const now = new Date().toISOString();

    await expect(
      orm.RunRaidContent.create({
        id: crypto.randomUUID(),
        runId: created.id,
        raidId: VENOMOUS_ABYSS_RAID_ID,
        sortOrder: 2,
        plannedBossCount: 1,
        createdAt: now,
      }),
    ).rejects.toBeTruthy();

    await expect(
      orm.RunRaidContent.create({
        id: crypto.randomUUID(),
        runId: created.id,
        raidId: TIDEBOUND_GROTTO_RAID_ID,
        sortOrder: 1,
        plannedBossCount: 1,
        createdAt: now,
      }),
    ).rejects.toBeTruthy();
  });

  it("schema can hold two distinct raid contents on one Run (low-level only)", async () => {
    const created = await runService.createRun(asLead(), {
      raidId: VENOMOUS_ABYSS_RAID_ID,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt: new Date(Date.now() + 44 * 24 * 60 * 60 * 1000).toISOString(),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    createdRunIds.push(created.id);

    await orm.RunRaidContent.create({
      id: crypto.randomUUID(),
      runId: created.id,
      raidId: TIDEBOUND_GROTTO_RAID_ID,
      sortOrder: 2,
      plannedBossCount: 1,
      createdAt: new Date().toISOString(),
    });

    const contents = await runRepository.listRaidContents(created.id);
    expect(contents).toHaveLength(2);
    expect(contents.map((row) => row.raidId)).toEqual([
      VENOMOUS_ABYSS_RAID_ID,
      TIDEBOUND_GROTTO_RAID_ID,
    ]);
  });

  it("deleteRun does not leave orphan RunRaidContent rows", async () => {
    const created = await runService.createRun(asLead(), {
      raidId: VENOMOUS_ABYSS_RAID_ID,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 1,
      scheduledStartAt: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    const before = await orm.RunRaidContent.where({ runId: created.id }).all();
    expect(before).toHaveLength(1);

    await runRepository.deleteRun(created.id);
    const after = await orm.RunRaidContent.where({ runId: created.id }).all();
    expect(after).toHaveLength(0);
  });

  it("migration backfill left existing Runs with matching sole content", async () => {
    // Seed/historical Runs on this DB were backfilled by 20260915T2209_add_run_raid_content.
    const sample = await orm.Run.select("id", "raidId", "plannedBossCount").first();
    if (!sample) return;
    const runId = String((sample as { id: string }).id);
    const contents = await runRepository.listRaidContents(runId);
    expect(contents.length).toBeGreaterThanOrEqual(1);
    const primary = contents.find((row) => row.sortOrder === 1);
    expect(primary?.raidId).toBe(String((sample as { raidId: string }).raidId));
    expect(primary?.plannedBossCount).toBe(Number((sample as { plannedBossCount: number }).plannedBossCount));
  });
});
