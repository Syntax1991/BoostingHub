import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { futureTestIso, venomousCreateInput } from "@/lib/test-run-input";
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

describe("RunRaidContent — contents authority", () => {
  it("createRun writes exactly one matching content row from contentPreset", async () => {
    const created = await runService.createRun(
      asLead(),
      venomousCreateInput({
        venomousPlannedBossCount: 6,
        scheduledStartAt: futureTestIso(40),
      }),
    );
    createdRunIds.push(created.id);

    const run = await runRepository.findById(created.id);
    const contents = await runRepository.listRaidContents(created.id);
    expect(run?.contents).toHaveLength(1);
    expect(run?.contentDisplay.titleCoverage).toBe("6/8");
    expect(contents).toHaveLength(1);
    expect(contents[0]?.raidId).toBe(VENOMOUS_ABYSS_RAID_ID);
    expect(contents[0]?.plannedBossCount).toBe(6);
    expect(contents[0]?.sortOrder).toBe(1);
  });

  it("createManyDraftsAtomic writes one content per Run (contents-only Run row)", async () => {
    const schedule = futureTestIso(41);
    const idsCreated = await runRepository.createManyDraftsAtomic([
      {
        title: "Mass A",
        difficulty: "NORMAL",
        lootType: "UNSAVED",
        scheduledStartAt: schedule,
        raidLeadId: ids.lead,
        notes: null,
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 4 }],
      },
      {
        title: "Mass B",
        difficulty: "NORMAL",
        lootType: "UNSAVED",
        scheduledStartAt: new Date(Date.parse(schedule) + 3 * 60 * 60 * 1000).toISOString(),
        raidLeadId: ids.lead,
        notes: null,
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 5 }],
      },
    ]);
    createdRunIds.push(...idsCreated);

    for (const runId of idsCreated) {
      const run = await runRepository.findById(runId);
      const contents = await runRepository.listRaidContents(runId);
      expect(contents).toHaveLength(1);
      expect(contents[0]?.raidId).toBe(VENOMOUS_ABYSS_RAID_ID);
      expect(contents[0]?.plannedBossCount).toBe(
        run?.contents[0]?.plannedBossCount,
      );
      expect(contents[0]?.sortOrder).toBe(1);
    }
  });

  it("updateFields does not rewrite RunRaidContent (Bundle-safe)", async () => {
    const created = await runService.createRun(
      asLead(),
      venomousCreateInput({
        venomousPlannedBossCount: 3,
        scheduledStartAt: futureTestIso(42),
      }),
    );
    createdRunIds.push(created.id);

    await runRepository.updateFields(created.id, { notes: "touch scheduling metadata only" });
    const run = await runRepository.findById(created.id);
    const contents = await runRepository.listRaidContents(created.id);
    expect(run?.notes).toBe("touch scheduling metadata only");
    expect(contents).toHaveLength(1);
    expect(contents[0]?.plannedBossCount).toBe(3);
  });

  it("rejects duplicate runId+raidId and runId+sortOrder", async () => {
    const created = await runService.createRun(
      asLead(),
      venomousCreateInput({
        venomousPlannedBossCount: 2,
        scheduledStartAt: futureTestIso(43),
      }),
    );
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
    const created = await runService.createRun(
      asLead(),
      venomousCreateInput({
        venomousPlannedBossCount: 8,
        scheduledStartAt: futureTestIso(44),
      }),
    );
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
    const created = await runService.createRun(
      asLead(),
      venomousCreateInput({
        venomousPlannedBossCount: 1,
        scheduledStartAt: futureTestIso(45),
      }),
    );
    const before = await orm.RunRaidContent.where({ runId: created.id }).all();
    expect(before).toHaveLength(1);

    await runRepository.deleteRun(created.id);
    const after = await orm.RunRaidContent.where({ runId: created.id }).all();
    expect(after).toHaveLength(0);
  });

  it("findById rejects Runs with no persisted raid content", async () => {
    const created = await runService.createRun(
      asLead(),
      venomousCreateInput({ scheduledStartAt: futureTestIso(46) }),
    );
    createdRunIds.push(created.id);
    await orm.RunRaidContent.where({ runId: created.id }).delete();

    try {
      await runRepository.findById(created.id);
      throw new Error("Expected domain error");
    } catch (error) {
      expect(isDomainError(error) && error.code).toBe("VALIDATION_FAILED");
      expect(String((error as Error).message)).toContain("no persisted raid content");
    }
  });

  it("migration backfill left existing Runs with matching sole content", async () => {
    const sampleContent = await orm.RunRaidContent.select("runId", "raidId", "plannedBossCount", "sortOrder").first();
    if (!sampleContent) return;
    const runId = String((sampleContent as { runId: string }).runId);
    const contents = await runRepository.listRaidContents(runId);
    expect(contents.length).toBeGreaterThanOrEqual(1);
    const primary = contents.find((row) => row.sortOrder === 1);
    expect(primary?.raidId).toBe(String((sampleContent as { raidId: string }).raidId));
    expect(primary?.plannedBossCount).toBe(Number((sampleContent as { plannedBossCount: number }).plannedBossCount));
  });
});
