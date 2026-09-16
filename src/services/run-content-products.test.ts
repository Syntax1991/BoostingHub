import { describe, expect, it } from "vitest";
import {
  classifyRunContents,
  expandRunContentPreset,
  listCreateRunContentPresets,
  projectRunContentDisplay,
} from "@/lib/run-content-presets";
import {
  TIDEBOUND_GROTTO_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
} from "@/lib/wow-raid-catalog";
import { afterAll, beforeAll } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import { runService } from "@/services/run.service";

const ids = {
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-p2rc00000001",
};

const createdRunIds: string[] = [];

function asLead(): AuthenticatedUser {
  return {
    id: ids.lead,
    name: "Phase2 Lead",
    email: `${ids.lead}@p2.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole: "RAID_LEAD",
    accountStatus: "ACTIVE",
  };
}

function futureIso(days = 14) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function expectDomainCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected domain error ${code}`);
  } catch (error) {
    if (error instanceof Error && error.message === `Expected domain error ${code}`) {
      throw error;
    }
    expect(isDomainError(error) && error.code).toBe(code);
  }
}

describe("run content presets — pure expansion", () => {
  it("expands Venomous 8 to one content row", () => {
    expect(expandRunContentPreset({ preset: "VENOMOUS_ABYSS", venomousPlannedBossCount: 8 })).toEqual([
      { raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 8 },
    ]);
  });

  it("expands Bundle 8 and Bundle 6 with fixed Tidebound 1", () => {
    expect(expandRunContentPreset({ preset: "MIDNIGHT_S2_BUNDLE", venomousPlannedBossCount: 8 })).toEqual([
      { raidId: TIDEBOUND_GROTTO_RAID_ID, sortOrder: 1, plannedBossCount: 1 },
      { raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 2, plannedBossCount: 8 },
    ]);
    expect(expandRunContentPreset({ preset: "MIDNIGHT_S2_BUNDLE", venomousPlannedBossCount: 6 })).toEqual([
      { raidId: TIDEBOUND_GROTTO_RAID_ID, sortOrder: 1, plannedBossCount: 1 },
      { raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 2, plannedBossCount: 6 },
    ]);
  });

  it("rejects Venomous 0 and 9", () => {
    expect(() => expandRunContentPreset({ preset: "VENOMOUS_ABYSS", venomousPlannedBossCount: 0 })).toThrow();
    expect(() => expandRunContentPreset({ preset: "VENOMOUS_ABYSS", venomousPlannedBossCount: 9 })).toThrow();
  });

  it("exposes only Venomous and Bundle products", () => {
    expect(listCreateRunContentPresets().map((row) => row.key)).toEqual([
      "VENOMOUS_ABYSS",
      "MIDNIGHT_S2_BUNDLE",
    ]);
  });
});

describe("run content classification + display", () => {
  it("classifies Venomous and Bundle by identity, not length alone", () => {
    expect(
      classifyRunContents([{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 8 }]),
    ).toBe("VENOMOUS_ABYSS");
    expect(
      classifyRunContents([
        { raidId: TIDEBOUND_GROTTO_RAID_ID, sortOrder: 1, plannedBossCount: 1 },
        { raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 2, plannedBossCount: 8 },
      ]),
    ).toBe("MIDNIGHT_S2_BUNDLE");
    expect(
      classifyRunContents([
        { raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 8 },
        { raidId: TIDEBOUND_GROTTO_RAID_ID, sortOrder: 2, plannedBossCount: 1 },
      ]),
    ).toBe("MIDNIGHT_S2_BUNDLE");
    expect(
      classifyRunContents([
        { raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 8 },
        { raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 2, plannedBossCount: 8 },
      ]),
    ).toBe("CUSTOM");
  });

  it("renders display summaries without 9/9 or 7/9", () => {
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
    expect(bundle8.summary).toBe("Nymrissa 1/1 · The Venomous Abyss 8/8");

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
    expect(bundle6.summary).toBe("Nymrissa 1/1 · The Venomous Abyss 6/8");

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
    expect(display.summary).toBe("The Venomous Abyss 8/8 · Nymrissa 1/1");
  });
});

describe("run content products — create / mass-create / edit", () => {
  const lead = asLead();

  beforeAll(async () => {
    await raidRepository.ensureReferenceRaids();
    try {
      await orm.User.where({ id: ids.lead }).delete();
    } catch {
      // absent
    }
    await orm.User.create({
      id: ids.lead,
      name: "Phase2 Lead",
      email: `${ids.lead}@p2.boostting.local`,
      emailVerified: true,
      accountRole: "RAID_LEAD",
      accountStatus: "ACTIVE",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    for (const id of createdRunIds) {
      try {
        await orm.Run.where({ id }).delete();
      } catch {
        // cascade / already gone
      }
    }
    try {
      await orm.User.where({ id: ids.lead }).delete();
    } catch {
      // absent
    }
  });

  it("creates Venomous 8 with one content row and Venomous authoritative contents", async () => {
    const { id } = await runService.createRun(lead, {
      contentPreset: "VENOMOUS_ABYSS",
      venomousPlannedBossCount: 8,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: futureIso(20),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    createdRunIds.push(id);
    const contents = await runRepository.listRaidContents(id);
            expect(contents).toHaveLength(1);
    expect(contents[0]?.raidId).toBe(VENOMOUS_ABYSS_RAID_ID);
    expect(contents[0]?.plannedBossCount).toBe(8);
  });

  it("creates Bundle 8 with Tidebound 1 + Venomous 8 and Venomous authoritative contents", async () => {
    const { id } = await runService.createRun(lead, {
      contentPreset: "MIDNIGHT_S2_BUNDLE",
      venomousPlannedBossCount: 8,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: futureIso(21),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    createdRunIds.push(id);
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

  it("creates partial Bundle 6 with display summary Nymrissa 1/1 · Venomous 6/8", async () => {
    const { id } = await runService.createRun(lead, {
      contentPreset: "MIDNIGHT_S2_BUNDLE",
      venomousPlannedBossCount: 6,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: futureIso(22),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    createdRunIds.push(id);
    const contents = await runRepository.listRaidContents(id);
    expect(contents.map((row) => row.plannedBossCount)).toEqual([1, 6]);
    const display = projectRunContentDisplay(contents);
    expect(display.summary).toBe("Nymrissa 1/1 · The Venomous Abyss 6/8");
  });

  it("mass-creates mixed Venomous + Bundle rows atomically (3 runs / 5 contents)", async () => {
    const result = await runService.createManyRuns(lead, {
      defaults: {
        contentPreset: "VENOMOUS_ABYSS",
        venomousPlannedBossCount: 8,
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
          overrides: { contentPreset: "MIDNIGHT_S2_BUNDLE", venomousPlannedBossCount: 8 },
        },
        {
          scheduledStartAt: futureIso(32),
          overrides: { contentPreset: "MIDNIGHT_S2_BUNDLE", venomousPlannedBossCount: 6 },
        },
      ],
    });
    createdRunIds.push(...result.ids);
    expect(result.ids).toHaveLength(3);
    const counts = await Promise.all(result.ids.map((id) => runRepository.listRaidContents(id)));
    expect(counts.map((rows) => rows.length)).toEqual([1, 2, 2]);
    expect(counts.flat()).toHaveLength(5);
  });

  it("allows Venomous → Bundle 6 before freeze and Bundle → Venomous after", async () => {
    const { id } = await runService.createRun(lead, {
      contentPreset: "VENOMOUS_ABYSS",
      venomousPlannedBossCount: 8,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: futureIso(40),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    createdRunIds.push(id);

    await runService.updateRun(lead, {
      runId: id,
      contentPreset: "MIDNIGHT_S2_BUNDLE",
      venomousPlannedBossCount: 6,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: futureIso(40),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    let contents = await runRepository.listRaidContents(id);
    expect(contents).toHaveLength(2);
    expect(contents.map((row) => [row.raidId, row.plannedBossCount])).toEqual([
      [TIDEBOUND_GROTTO_RAID_ID, 1],
      [VENOMOUS_ABYSS_RAID_ID, 6],
    ]);

    await runService.updateRun(lead, {
      runId: id,
      contentPreset: "VENOMOUS_ABYSS",
      venomousPlannedBossCount: 8,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: futureIso(40),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    contents = await runRepository.listRaidContents(id);
    expect(contents).toHaveLength(1);
    expect(contents[0]?.raidId).toBe(VENOMOUS_ABYSS_RAID_ID);
    expect(contents[0]?.plannedBossCount).toBe(8);
  });

  it("freezes content identity after signup history", async () => {
    const { id } = await runService.createRun(lead, {
      contentPreset: "VENOMOUS_ABYSS",
      venomousPlannedBossCount: 8,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: futureIso(41),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    createdRunIds.push(id);
    await runService.openRun(lead, id);

    const signupId = crypto.randomUUID();
    await orm.RunSignup.create({
      id: signupId,
      runId: id,
      userId: ids.lead,
      characterId: null,
      participationType: "LOOTBUDDY",
      isBackup: false,
      status: "WITHDRAWN",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await expectDomainCode(
      runService.updateRun(lead, {
        runId: id,
        contentPreset: "MIDNIGHT_S2_BUNDLE",
        venomousPlannedBossCount: 8,
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        scheduledStartAt: futureIso(41),
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
      }),
      "RUN_IDENTITY_LOCKED",
    );

    const contents = await runRepository.listRaidContents(id);
    expect(contents).toHaveLength(1);
    expect(contents[0]?.raidId).toBe(VENOMOUS_ABYSS_RAID_ID);

    await orm.RunSignup.where({ id: signupId }).delete();
  });

  it("notes-only update leaves Bundle contents untouched", async () => {
    const { id } = await runService.createRun(lead, {
      contentPreset: "MIDNIGHT_S2_BUNDLE",
      venomousPlannedBossCount: 7,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: futureIso(42),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    createdRunIds.push(id);
    const before = await runRepository.listRaidContents(id);

    await runService.updateRun(lead, {
      runId: id,
      contentPreset: "MIDNIGHT_S2_BUNDLE",
      venomousPlannedBossCount: 7,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: futureIso(42),
      notes: "Bundle note",
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    const after = await runRepository.listRaidContents(id);
    expect(after.map((row) => ({ id: row.id, raidId: row.raidId, plannedBossCount: row.plannedBossCount }))).toEqual(
      before.map((row) => ({ id: row.id, raidId: row.raidId, plannedBossCount: row.plannedBossCount })),
    );
  });
});
