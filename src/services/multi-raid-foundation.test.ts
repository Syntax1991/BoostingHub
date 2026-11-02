import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { futureTestIso, venomousCreateInput } from "@/lib/test-run-input";
import {
  MANAFORGE_OMEGA_RAID_ID,
  NYMRISSA_WAVECALLER_BOSS_ID,
  TIDEBOUND_GROTTO_RAID_ID,
  UNBINDING_KITHIX_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
  findRaidCatalogById,
} from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import { runService } from "@/services/run.service";
import { testActor } from "@/test/actors";
import { assertIsolatedTestDatabase, createTestUser, deleteCreatedRows } from "@/test/db-fixtures";

/** Contents, rosters and the like cascade with their Run. */
const created = { runIds: [] as string[], userIds: [] as string[] };
let lead: AuthenticatedUser;

beforeAll(async () => {
  assertIsolatedTestDatabase();
  await raidRepository.ensureReferenceRaids();
  const leadId = await createTestUser({ name: "MultiRaid Foundation Lead", accountRole: "RAID_LEAD" });
  created.userIds.push(leadId);
  lead = testActor(leadId, "RAID_LEAD");
}, 60_000);

afterAll(() => deleteCreatedRows(created), 60_000);

describe("Tidebound / Nymrissa catalog (verified Blizzard ids)", () => {
  it("exposes Tidebound instance 1317 and Nymrissa encounter 2849", () => {
    const tidebound = findRaidCatalogById(TIDEBOUND_GROTTO_RAID_ID)!;
    expect(tidebound.name).toBe("The Tidebound Grotto");
    expect(tidebound.season).toBe("Midnight Season 2");
    expect(tidebound.blizzardInstanceId).toBe(1317);
    expect(tidebound.trackLockouts).toBe(true);
    expect(tidebound.availableForRuns).toBe(false);
    expect(tidebound.bosses).toHaveLength(1);
    expect(tidebound.bosses[0]?.id).toBe(NYMRISSA_WAVECALLER_BOSS_ID);
    expect(tidebound.bosses[0]?.name).toBe("Nymrissa Wavecaller");
    expect(tidebound.bosses[0]?.blizzardEncounterIds).toEqual([2849]);
  });

  it("keeps Venomous tracked for lockouts and the DB lockout set includes Venomous, Tidebound, and Kith'ix", async () => {
    const venomous = findRaidCatalogById(VENOMOUS_ABYSS_RAID_ID)!;
    expect(venomous.trackLockouts).toBe(true);
    await raidRepository.ensureReferenceRaids();
    const idsInLockouts = (await raidRepository.loadCatalog()).lockoutRaids.map((raid) => raid.id).sort();
    expect(idsInLockouts).toEqual(
      [TIDEBOUND_GROTTO_RAID_ID, UNBINDING_KITHIX_RAID_ID, VENOMOUS_ABYSS_RAID_ID].sort(),
    );
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
    const run = await runService.createRun(
      lead,
      venomousCreateInput({
        venomousPlannedBossCount: 6,
        scheduledStartAt: futureTestIso(40),
      }),
    );
    created.runIds.push(run.id);

    const stored = await runRepository.findById(run.id);
    const contents = await runRepository.listRaidContents(run.id);
    expect(stored?.contents).toHaveLength(1);
    expect(stored?.contentDisplay.titleCoverage).toBe("6/8");
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
        raidLeadId: lead.id,
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
        raidLeadId: lead.id,
        notes: null,
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 5 }],
      },
    ]);
    created.runIds.push(...idsCreated);

    // Each Run keeps its own planned count.
    for (const [runId, plannedBossCount] of [[idsCreated[0]!, 4], [idsCreated[1]!, 5]] as const) {
      const contents = await runRepository.listRaidContents(runId);
      expect(contents).toEqual([expect.objectContaining({ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount })]);
    }
  });

  it("updateFields does not rewrite RunRaidContent (Bundle-safe)", async () => {
    const run = await runService.createRun(
      lead,
      venomousCreateInput({
        venomousPlannedBossCount: 3,
        scheduledStartAt: futureTestIso(42),
      }),
    );
    created.runIds.push(run.id);

    await runRepository.updateFields(run.id, { notes: "touch scheduling metadata only" });
    const stored = await runRepository.findById(run.id);
    const contents = await runRepository.listRaidContents(run.id);
    expect(stored?.notes).toBe("touch scheduling metadata only");
    expect(contents).toHaveLength(1);
    expect(contents[0]?.plannedBossCount).toBe(3);
  });

  it("rejects duplicate runId+raidId and runId+sortOrder", async () => {
    const run = await runService.createRun(
      lead,
      venomousCreateInput({
        venomousPlannedBossCount: 2,
        scheduledStartAt: futureTestIso(43),
      }),
    );
    created.runIds.push(run.id);
    const now = new Date().toISOString();

    await expect(
      orm.RunRaidContent.create({
        id: crypto.randomUUID(),
        runId: run.id,
        raidId: VENOMOUS_ABYSS_RAID_ID,
        sortOrder: 2,
        plannedBossCount: 1,
        createdAt: now,
      }),
    ).rejects.toBeTruthy();

    await expect(
      orm.RunRaidContent.create({
        id: crypto.randomUUID(),
        runId: run.id,
        raidId: TIDEBOUND_GROTTO_RAID_ID,
        sortOrder: 1,
        plannedBossCount: 1,
        createdAt: now,
      }),
    ).rejects.toBeTruthy();
  });

  it("schema can hold two distinct raid contents on one Run (low-level only)", async () => {
    const run = await runService.createRun(
      lead,
      venomousCreateInput({
        venomousPlannedBossCount: 8,
        scheduledStartAt: futureTestIso(44),
      }),
    );
    created.runIds.push(run.id);

    await orm.RunRaidContent.create({
      id: crypto.randomUUID(),
      runId: run.id,
      raidId: TIDEBOUND_GROTTO_RAID_ID,
      sortOrder: 2,
      plannedBossCount: 1,
      createdAt: new Date().toISOString(),
    });

    const contents = await runRepository.listRaidContents(run.id);
    expect(contents).toHaveLength(2);
    expect(contents.map((row) => row.raidId)).toEqual([
      VENOMOUS_ABYSS_RAID_ID,
      TIDEBOUND_GROTTO_RAID_ID,
    ]);
  });

  it("deleteRun does not leave orphan RunRaidContent rows", async () => {
    const run = await runService.createRun(
      lead,
      venomousCreateInput({
        venomousPlannedBossCount: 1,
        scheduledStartAt: futureTestIso(45),
      }),
    );
    const before = await orm.RunRaidContent.where({ runId: run.id }).all();
    expect(before).toHaveLength(1);

    await runRepository.deleteRun(run.id);
    const after = await orm.RunRaidContent.where({ runId: run.id }).all();
    expect(after).toHaveLength(0);
  });

  it("findById rejects Runs with no persisted raid content", async () => {
    const run = await runService.createRun(
      lead,
      venomousCreateInput({ scheduledStartAt: futureTestIso(46) }),
    );
    created.runIds.push(run.id);
    await orm.RunRaidContent.where({ runId: run.id }).delete();

    await expect(runRepository.findById(run.id)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: expect.stringContaining("no persisted raid content"),
    });
  });

});
