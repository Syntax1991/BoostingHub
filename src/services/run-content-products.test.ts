import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededProductSelection, type SeededProductKey } from "@/lib/test-run-input";
import { projectRunContentDisplay } from "@/lib/run-content-display";
import {
  TIDEBOUND_GROTTO_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
} from "@/lib/wow-raid-catalog";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import { runService } from "@/services/run.service";
import { testActor } from "@/test/actors";
import { assertIsolatedTestDatabase, createTestUser, deleteCreatedRows } from "@/test/db-fixtures";
import { DAY_MS } from "@/test/time";

/** Contents and signups cascade with their Run. */
const created = { runIds: [] as string[], userIds: [] as string[] };
let lead: AuthenticatedUser;

function futureIso(days: number) {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

/** The full Run fields for one of the seeded products; only the product, boss count and day vary here. */
function productRun(product: SeededProductKey, venomousBossCount: number, daysAhead: number) {
  return {
    ...seededProductSelection(product, venomousBossCount),
    difficulty: "HEROIC" as const,
    lootType: "UNSAVED" as const,
    scheduledStartAt: futureIso(daysAhead),
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
  };
}

async function createProductRun(product: SeededProductKey, venomousBossCount: number, daysAhead: number) {
  const { id } = await runService.createRun(lead, productRun(product, venomousBossCount, daysAhead));
  created.runIds.push(id);
  return id;
}

describe("run content display (persisted contents)", () => {
  it("renders per-raid summaries and summed Bundle title/channel coverage", () => {
    const venomous = projectRunContentDisplay([
      {
        raidId: VENOMOUS_ABYSS_RAID_ID,
        raidName: "The Venomous Abyss",
        sortOrder: 1,
        plannedBossCount: 8,
        totalBossCount: 8,
      },
    ]);
    expect(venomous.productLabel).toBe("The Venomous Abyss");
    expect(venomous.summary).toBe("The Venomous Abyss 8/8");
    expect(venomous.titleCoverage).toBe("8/8");
    expect(venomous.channelCoverage).toBe("8of8");

    const bundle8 = projectRunContentDisplay([
      {
        raidId: TIDEBOUND_GROTTO_RAID_ID,
        raidName: "The Tidebound Grotto",
        sortOrder: 1,
        plannedBossCount: 1,
        totalBossCount: 1,
      },
      {
        raidId: VENOMOUS_ABYSS_RAID_ID,
        raidName: "The Venomous Abyss",
        sortOrder: 2,
        plannedBossCount: 8,
        totalBossCount: 8,
      },
    ]);
    expect(bundle8.productLabel).toBe("Season 2 Bundle");
    expect(bundle8.summary).toBe("Tide 1/1 · The Venomous Abyss 8/8");
    expect(bundle8.titleCoverage).toBe("9/9");
    expect(bundle8.channelCoverage).toBe("9of9");

    const bundle6 = projectRunContentDisplay([
      {
        raidId: TIDEBOUND_GROTTO_RAID_ID,
        raidName: "The Tidebound Grotto",
        sortOrder: 1,
        plannedBossCount: 1,
        totalBossCount: 1,
      },
      {
        raidId: VENOMOUS_ABYSS_RAID_ID,
        raidName: "The Venomous Abyss",
        sortOrder: 2,
        plannedBossCount: 6,
        totalBossCount: 8,
      },
    ]);
    expect(bundle6.summary).toBe("Tide 1/1 · The Venomous Abyss 6/8");
    expect(bundle6.titleCoverage).toBe("7/9");
    expect(bundle6.channelCoverage).toBe("7of9");

    for (const display of [venomous, bundle8, bundle6]) {
      expect(display.summary).not.toContain("9/9");
      expect(display.summary).not.toContain("7/9");
    }
  });

  it("honors persisted sortOrder for display even when identities are swapped", () => {
    const display = projectRunContentDisplay([
      {
        raidId: VENOMOUS_ABYSS_RAID_ID,
        raidName: "The Venomous Abyss",
        sortOrder: 1,
        plannedBossCount: 8,
        totalBossCount: 8,
      },
      {
        raidId: TIDEBOUND_GROTTO_RAID_ID,
        raidName: "The Tidebound Grotto",
        sortOrder: 2,
        plannedBossCount: 1,
        totalBossCount: 1,
      },
    ]);
    expect(display.summary).toBe("The Venomous Abyss 8/8 · Tide 1/1");
  });
});

describe("run content products — create / mass-create / edit", () => {
  beforeAll(async () => {
    assertIsolatedTestDatabase();
    await raidRepository.ensureReferenceRaids();
    const leadId = await createTestUser({ name: "Phase2 Lead", accountRole: "RAID_LEAD" });
    created.userIds.push(leadId);
    lead = testActor(leadId, "RAID_LEAD");
  });

  afterAll(() => deleteCreatedRows(created));

  it("creates Venomous 8 with one content row and Venomous authoritative contents", async () => {
    const id = await createProductRun("VENOMOUS_ABYSS", 8, 20);
    const contents = await runRepository.listRaidContents(id);
    expect(contents).toHaveLength(1);
    expect(contents[0]?.raidId).toBe(VENOMOUS_ABYSS_RAID_ID);
    expect(contents[0]?.plannedBossCount).toBe(8);
  });

  it("creates Bundle 8 with Tidebound 1 + Venomous 8 and Venomous authoritative contents", async () => {
    const id = await createProductRun("MIDNIGHT_S2_BUNDLE", 8, 21);
    const contents = await runRepository.listRaidContents(id);
    expect(contents).toHaveLength(2);
    expect(contents[0]).toMatchObject({
      raidId: TIDEBOUND_GROTTO_RAID_ID,
      sortOrder: 1,
      plannedBossCount: 1,
    });
    expect(contents[1]).toMatchObject({
      raidId: VENOMOUS_ABYSS_RAID_ID,
      sortOrder: 2,
      plannedBossCount: 8,
    });
  });

  it("creates partial Bundle 6 with display summary Tide 1/1 · Venomous 6/8", async () => {
    const id = await createProductRun("MIDNIGHT_S2_BUNDLE", 6, 22);
    const contents = await runRepository.listRaidContents(id);
    expect(contents.map((row) => row.plannedBossCount)).toEqual([1, 6]);
    const display = projectRunContentDisplay(contents);
    expect(display.summary).toBe("Tide 1/1 · The Venomous Abyss 6/8");
  });

  it("mass-creates mixed Venomous + Bundle rows atomically (3 runs / 5 contents)", async () => {
    const result = await runService.createManyRuns(lead, {
      defaults: {
        ...seededProductSelection("VENOMOUS_ABYSS", 8),
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      },
      runs: [
        { scheduledStartAt: futureIso(30) },
        {
          scheduledStartAt: futureIso(31),
          overrides: { ...seededProductSelection("MIDNIGHT_S2_BUNDLE", 8), },
        },
        {
          scheduledStartAt: futureIso(32),
          overrides: { ...seededProductSelection("MIDNIGHT_S2_BUNDLE", 6), },
        },
      ],
    });
    created.runIds.push(...result.ids);
    expect(result.ids).toHaveLength(3);
    const counts = await Promise.all(result.ids.map((id) => runRepository.listRaidContents(id)));
    expect(counts.map((rows) => rows.length)).toEqual([1, 2, 2]);
    expect(counts.flat()).toHaveLength(5);
  });

  it("allows Venomous → Bundle 6 before freeze and Bundle → Venomous after", async () => {
    const id = await createProductRun("VENOMOUS_ABYSS", 8, 40);

    await runService.updateRun(lead, { runId: id, ...productRun("MIDNIGHT_S2_BUNDLE", 6, 40) });
    let contents = await runRepository.listRaidContents(id);
    expect(contents).toHaveLength(2);
    expect(contents.map((row) => [row.raidId, row.plannedBossCount])).toEqual([
      [TIDEBOUND_GROTTO_RAID_ID, 1],
      [VENOMOUS_ABYSS_RAID_ID, 6],
    ]);

    await runService.updateRun(lead, { runId: id, ...productRun("VENOMOUS_ABYSS", 8, 40) });
    contents = await runRepository.listRaidContents(id);
    expect(contents).toHaveLength(1);
    expect(contents[0]?.raidId).toBe(VENOMOUS_ABYSS_RAID_ID);
    expect(contents[0]?.plannedBossCount).toBe(8);
  });

  it("keeps content identity editable after signup history — the signup rows stay attached", async () => {
    const id = await createProductRun("VENOMOUS_ABYSS", 8, 41);
    await runService.openRun(lead, id);

    const signupId = crypto.randomUUID();
    await orm.RunSignup.create({
      id: signupId,
      runId: id,
      userId: lead.id,
      characterId: null,
      participationType: "LOOTBUDDY",
      isBackup: false,
      status: "WITHDRAWN",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await runService.updateRun(lead, { runId: id, ...productRun("MIDNIGHT_S2_BUNDLE", 8, 41) });

    // Venomous → Bundle: Tidebound 1/1 + Venomous 8/8, signup history untouched.
    const contents = await runRepository.listRaidContents(id);
    expect(contents).toHaveLength(2);
    expect(contents.map((row) => row.raidId)).toContain(VENOMOUS_ABYSS_RAID_ID);
    expect(await orm.RunSignup.where({ id: signupId }).first()).toBeTruthy();

    // And back: Bundle → Venomous with a different boss count.
    await runService.updateRun(lead, { runId: id, ...productRun("VENOMOUS_ABYSS", 6, 41) });
    const back = await runRepository.listRaidContents(id);
    expect(back.map((row) => [row.raidId, row.plannedBossCount])).toEqual([[VENOMOUS_ABYSS_RAID_ID, 6]]);

  });

  it("notes-only update leaves Bundle contents untouched", async () => {
    const id = await createProductRun("MIDNIGHT_S2_BUNDLE", 7, 42);
    const before = await runRepository.listRaidContents(id);

    await runService.updateRun(lead, { runId: id, ...productRun("MIDNIGHT_S2_BUNDLE", 7, 42), notes: "Bundle note" });
    const after = await runRepository.listRaidContents(id);
    expect(after.map((row) => ({ id: row.id, raidId: row.raidId, plannedBossCount: row.plannedBossCount }))).toEqual(
      before.map((row) => ({ id: row.id, raidId: row.raidId, plannedBossCount: row.plannedBossCount })),
    );
  });
});
