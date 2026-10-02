import { afterAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { rosterSelectedSourceKey } from "@/repositories/user-notification.repository";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import type { CharacterRole, WowClass } from "@/models/enums";

const thorneId = "33333333-3333-4333-8333-333333333333";

const thorne: AuthenticatedUser = {
  id: thorneId,
  name: "Thorne Ironvein",
  email: `${thorneId}@dev.boostting.local`,
  image: null,
  discordUserId: null,
  discordUsername: null,
  accountRole: "RAID_LEAD",
  accountStatus: "ACTIVE",
};

const createdCharacterIds: string[] = [];
const createdRunIds: string[] = [];
const createdUserIds: string[] = [];

type Fixture = {
  name: string;
  wowClass: WowClass;
  specialization: string;
  primaryRole: CharacterRole;
  offeredRoles: CharacterRole[];
  playableSpecs?: string[];
  expected: "MELEE_DPS" | "RANGED_DPS" | null;
};

const productionNine: Fixture[] = [
  { name: "Glesien", wowClass: "HUNTER", specialization: "Marksmanship", primaryRole: "RANGED_DPS", offeredRoles: ["DPS"], expected: "RANGED_DPS" },
  { name: "Kiri", wowClass: "PRIEST", specialization: "Shadow", primaryRole: "RANGED_DPS", offeredRoles: ["DPS"], expected: "RANGED_DPS" },
  { name: "Synblast", wowClass: "SHAMAN", specialization: "Restoration", primaryRole: "HEALER", offeredRoles: ["HEALER", "DPS"], playableSpecs: ["Elemental"], expected: "RANGED_DPS" },
  { name: "Pheia", wowClass: "WARLOCK", specialization: "Demonology", primaryRole: "RANGED_DPS", offeredRoles: ["DPS"], expected: "RANGED_DPS" },
  { name: "Temph", wowClass: "ROGUE", specialization: "Subtlety", primaryRole: "MELEE_DPS", offeredRoles: ["DPS"], expected: "MELEE_DPS" },
  { name: "Eunmi", wowClass: "WARRIOR", specialization: "Arms", primaryRole: "MELEE_DPS", offeredRoles: ["DPS"], expected: "MELEE_DPS" },
  { name: "Frostbite", wowClass: "MAGE", specialization: "Frost", primaryRole: "RANGED_DPS", offeredRoles: ["DPS"], expected: "RANGED_DPS" },
  { name: "Armsman", wowClass: "WARRIOR", specialization: "Arms", primaryRole: "MELEE_DPS", offeredRoles: ["DPS"], expected: "MELEE_DPS" },
  { name: "Eleboom", wowClass: "SHAMAN", specialization: "Elemental", primaryRole: "RANGED_DPS", offeredRoles: ["DPS"], expected: "RANGED_DPS" },
];

async function createUser(): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  createdUserIds.push(id);
  await orm.User.create({
    id,
    name: `Legacy ${id.slice(0, 8)}`,
    email: `${id}@legacy-draft.boostting.local`,
    emailVerified: true,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    isBooster: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function createHistoricSignup(runId: string, fixture: Fixture): Promise<string> {
  const now = new Date().toISOString();
  const characterId = crypto.randomUUID();
  createdCharacterIds.push(characterId);
  const userId = await createUser();
  await orm.Character.create({
    id: characterId,
    userId,
    name: fixture.name,
    realm: "Antonidas",
    normalizedName: fixture.name.toLowerCase(),
    normalizedRealm: "antonidas",
    region: "EU",
    wowClass: fixture.wowClass,
    specialization: fixture.specialization,
    primaryRole: fixture.primaryRole,
    itemLevel: 700,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  for (const specialization of fixture.playableSpecs ?? []) {
    await orm.CharacterPlayableSpec.create({
      id: crypto.randomUUID(),
      characterId,
      specialization,
      createdAt: now,
    });
  }
  const signupId = crypto.randomUUID();
  await orm.RunSignup.create({
    id: signupId,
    runId,
    userId,
    characterId,
    participationType: "BOOSTER",
    isBackup: false,
    status: "PENDING",
    publishedRole: null,
    createdAt: now,
    updatedAt: now,
  });
  for (const role of fixture.offeredRoles) {
    await orm.RunSignupRole.create({
      id: crypto.randomUUID(),
      signupId,
      role,
      createdAt: now,
    });
  }
  return signupId;
}

async function createOpenRun(desiredDpsCount = 11) {
  const run = await runService.createRun(
    thorne,
    venomousCreateInput({
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      venomousPlannedBossCount: 8,
      scheduledStartAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000 + createdRunIds.length * 3600_000).toISOString(),
      desiredTankCount: 0,
      desiredHealerCount: 0,
      desiredDpsCount,
    }),
  );
  createdRunIds.push(run.id);
  await runService.openRun(thorne, run.id);
  return run.id;
}

async function selectAsLegacyDps(rosterId: string, signupId: string) {
  const now = new Date().toISOString();
  await orm.RunRosterEntry.create({
    id: crypto.randomUUID(),
    rosterId,
    signupId,
    selected: true,
    selectedRole: "DPS",
    createdAt: now,
    updatedAt: now,
  });
}

async function storedRole(signupId: string): Promise<string | null> {
  const row = (await orm.RunRosterEntry.where({ signupId }).select("selectedRole").first()) as {
    selectedRole: string | null;
  } | null;
  return row ? row.selectedRole : "MISSING";
}

async function offeredRoles(signupId: string): Promise<string[]> {
  const rows = (await orm.RunSignupRole.where({ signupId }).select("role").all()) as Array<{ role: string }>;
  return rows.map((row) => row.role).sort();
}

describe("historic saved DPS draft self-heal", () => {
  afterAll(async () => {
    for (const runId of createdRunIds) {
      const notes = await orm.UserNotification.where({ runId }).select("id").all();
      for (const row of notes) {
        await orm.UserNotification.where({ id: (row as { id: string }).id }).delete();
      }
      const roster = await orm.RunRoster.where({ runId }).first();
      if (roster) {
        const rosterId = (roster as { id: string }).id;
        const entries = await orm.RunRosterEntry.where({ rosterId }).all();
        for (const entry of entries) {
          await orm.RunRosterEntry.where({ id: (entry as { id: string }).id }).delete();
        }
        await orm.RunRoster.where({ id: rosterId }).delete();
      }
      const signups = await orm.RunSignup.where({ runId }).select("id").all();
      for (const row of signups) {
        const signupId = (row as { id: string }).id;
        const roles = await orm.RunSignupRole.where({ signupId }).select("id").all();
        for (const role of roles) {
          await orm.RunSignupRole.where({ id: (role as { id: string }).id }).delete();
        }
        await orm.RunSignup.where({ id: signupId }).delete();
      }
      await orm.Run.where({ id: runId }).delete();
    }
    for (const id of createdCharacterIds) {
      const specs = await orm.CharacterPlayableSpec.where({ characterId: id }).select("id").all();
      for (const spec of specs) {
        await orm.CharacterPlayableSpec.where({ id: (spec as { id: string }).id }).delete();
      }
      await orm.Character.where({ id }).delete();
    }
    for (const id of createdUserIds) {
      await orm.User.where({ id }).delete();
    }
  });

  it("counts nine stored DPS selections as concrete DPS on read, then self-heals on save", async () => {
    const runId = await createOpenRun(11);
    const ids = new Map<string, string>();
    for (const fixture of productionNine) {
      ids.set(fixture.name, await createHistoricSignup(runId, fixture));
    }
    let view = await rosterService.getRosterManagementView(thorne, runId);
    for (const signupId of ids.values()) {
      await selectAsLegacyDps(view.roster.id, signupId);
    }

    view = await rosterService.getRosterManagementView(thorne, runId);
    const selected = view.boosters.filter((row) => row.draftSelected);
    expect(selected).toHaveLength(9);
    expect(view.summary.meleeDps + view.summary.rangedDps).toBe(9);
    expect(view.summary.legacyDps).toBe(0);
    expect(view.composition.dps.selected).toBe(9);
    expect(view.validation.canPublish).toBe(true);

    for (const fixture of productionNine) {
      const signupId = ids.get(fixture.name)!;
      const card = view.boosters.find((row) => row.id === signupId);
      expect(card?.draftSelected).toBe(true);
      expect(card?.selectedRole).toBe(fixture.expected);
      const section = fixture.expected === "MELEE_DPS" ? view.groups.meleeDps : view.groups.rangedDps;
      const projected = section.find((row) => row.id === signupId);
      expect(projected?.groupRole).toBe(fixture.expected);
      expect(projected?.selectedRole).toBe(fixture.expected);
      expect(projected?.draftSelected).toBe(true);
      expect(await storedRole(signupId)).toBe("DPS");
      expect(await offeredRoles(signupId)).toEqual([...fixture.offeredRoles].sort());
    }

    const tenthId = await createHistoricSignup(runId, {
      name: "Newfrost",
      wowClass: "MAGE",
      specialization: "Frost",
      primaryRole: "RANGED_DPS",
      offeredRoles: ["DPS"],
      expected: "RANGED_DPS",
    });
    view = await rosterService.getRosterManagementView(thorne, runId);
    await rosterService.saveDraftSelection(thorne, {
      runId,
      version: view.roster.version,
      selections: [
        ...productionNine.map((fixture) => ({
          signupId: ids.get(fixture.name)!,
          selectedRole: fixture.expected,
        })),
        { signupId: tenthId, selectedRole: "RANGED_DPS" as const },
      ],
    });

    for (const fixture of productionNine) {
      expect(await storedRole(ids.get(fixture.name)!)).toBe(fixture.expected);
      expect(await offeredRoles(ids.get(fixture.name)!)).toEqual([...fixture.offeredRoles].sort());
    }
    expect(await storedRole(tenthId)).toBe("RANGED_DPS");
    expect(await offeredRoles(tenthId)).toEqual(["DPS"]);
    view = await rosterService.getRosterManagementView(thorne, runId);
    expect(view.composition.dps.selected).toBe(10);
    expect(view.boosters.filter((row) => row.selectedRole === "DPS")).toHaveLength(0);
  });

  it("accepts a stale client that still submits selectedRole DPS for an existing legacy slot", async () => {
    const runId = await createOpenRun(11);
    const ids = new Map<string, string>();
    for (const fixture of productionNine) {
      ids.set(fixture.name, await createHistoricSignup(runId, fixture));
    }
    let view = await rosterService.getRosterManagementView(thorne, runId);
    for (const signupId of ids.values()) await selectAsLegacyDps(view.roster.id, signupId);
    const tenthId = await createHistoricSignup(runId, {
      name: "Stalefrost",
      wowClass: "MAGE",
      specialization: "Frost",
      primaryRole: "RANGED_DPS",
      offeredRoles: ["DPS"],
      expected: "RANGED_DPS",
    });
    view = await rosterService.getRosterManagementView(thorne, runId);

    await rosterService.saveDraftSelection(thorne, {
      runId,
      version: view.roster.version,
      selections: [
        ...[...ids.values()].map((signupId) => ({ signupId, selectedRole: "DPS" as const })),
        { signupId: tenthId, selectedRole: "RANGED_DPS" as const },
      ],
    });

    for (const fixture of productionNine) {
      expect(await storedRole(ids.get(fixture.name)!)).toBe(fixture.expected);
    }
    expect(await storedRole(tenthId)).toBe("RANGED_DPS");
  });

  it("lets an ambiguous stored DPS row stay selected without blocking an unrelated save", async () => {
    const runId = await createOpenRun(11);
    const unique = productionNine.filter((fixture) => fixture.name !== "Eleboom");
    const ids = new Map<string, string>();
    for (const fixture of unique) ids.set(fixture.name, await createHistoricSignup(runId, fixture));
    const ambiguousId = await createHistoricSignup(runId, {
      name: "Ambiguous",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      primaryRole: "HEALER",
      offeredRoles: ["HEALER", "DPS"],
      expected: null,
    });
    let view = await rosterService.getRosterManagementView(thorne, runId);
    for (const signupId of ids.values()) await selectAsLegacyDps(view.roster.id, signupId);
    await selectAsLegacyDps(view.roster.id, ambiguousId);

    view = await rosterService.getRosterManagementView(thorne, runId);
    expect(view.summary.meleeDps + view.summary.rangedDps).toBe(8);
    expect(view.summary.legacyDps).toBe(1);
    expect(view.composition.dps.selected).toBe(8);
    expect(view.boosters.find((row) => row.id === ambiguousId)?.draftSelected).toBe(true);
    expect(view.boosters.find((row) => row.id === ambiguousId)?.selectedRole).toBeNull();
    expect(view.groups.unassignedDps.some((row) => row.id === ambiguousId && row.draftSelected)).toBe(true);
    expect(view.validation.canPublish).toBe(false);
    expect(view.validation.blockers.some((issue) => issue.message.includes("Choose Melee or Ranged DPS"))).toBe(true);
    expect(await storedRole(ambiguousId)).toBe("DPS");

    const extraId = await createHistoricSignup(runId, {
      name: "Extrafrost",
      wowClass: "MAGE",
      specialization: "Frost",
      primaryRole: "RANGED_DPS",
      offeredRoles: ["DPS"],
      expected: "RANGED_DPS",
    });
    view = await rosterService.getRosterManagementView(thorne, runId);
    await rosterService.saveDraftSelection(thorne, {
      runId,
      version: view.roster.version,
      selections: [
        ...unique.map((fixture) => ({ signupId: ids.get(fixture.name)!, selectedRole: fixture.expected })),
        { signupId: ambiguousId, selectedRole: null },
        { signupId: extraId, selectedRole: "RANGED_DPS" as const },
      ],
    });
    expect(await storedRole(ambiguousId)).toBeNull();
    expect(await offeredRoles(ambiguousId)).toEqual(["DPS", "HEALER"]);
    view = await rosterService.getRosterManagementView(thorne, runId);
    expect(view.boosters.find((row) => row.id === ambiguousId)?.draftSelected).toBe(true);
    await expect(
      rosterService.publishRoster(thorne, { runId, version: view.roster.version, acknowledgeWarnings: true }),
    ).rejects.toMatchObject({ code: "ROSTER_VALIDATION_FAILED" });

    view = await rosterService.getRosterManagementView(thorne, runId);
    const keep = view.boosters.filter((row) => row.draftSelected && row.id !== ambiguousId);
    await rosterService.saveDraftSelection(thorne, {
      runId,
      version: view.roster.version,
      selections: [
        ...keep.map((row) => ({ signupId: row.id, selectedRole: row.selectedRole })),
        { signupId: ambiguousId, selectedRole: "MELEE_DPS" as const },
      ],
    });
    expect(await storedRole(ambiguousId)).toBe("MELEE_DPS");

    view = await rosterService.getRosterManagementView(thorne, runId);
    await rosterService.saveDraftSelection(thorne, {
      runId,
      version: view.roster.version,
      selections: view.boosters
        .filter((row) => row.draftSelected)
        .map((row) => ({
          signupId: row.id,
          selectedRole: row.id === ambiguousId ? ("RANGED_DPS" as const) : row.selectedRole,
        })),
    });
    expect(await storedRole(ambiguousId)).toBe("RANGED_DPS");
  });

  it("removes a legacy DPS row when it is unchecked, and still rejects a new DPS assignment", async () => {
    const runId = await createOpenRun(11);
    const glesien = await createHistoricSignup(runId, productionNine[0]!);
    const temph = await createHistoricSignup(runId, productionNine[4]!);
    let view = await rosterService.getRosterManagementView(thorne, runId);
    await selectAsLegacyDps(view.roster.id, glesien);
    await selectAsLegacyDps(view.roster.id, temph);
    view = await rosterService.getRosterManagementView(thorne, runId);

    await rosterService.saveDraftSelection(thorne, {
      runId,
      version: view.roster.version,
      selections: [{ signupId: temph, selectedRole: "DPS" }],
    });
    expect(await storedRole(glesien)).toBe("MISSING");
    expect(await storedRole(temph)).toBe("MELEE_DPS");

    const fresh = await createHistoricSignup(runId, {
      name: "Brandnew",
      wowClass: "MAGE",
      specialization: "Frost",
      primaryRole: "RANGED_DPS",
      offeredRoles: ["DPS"],
      expected: "RANGED_DPS",
    });
    view = await rosterService.getRosterManagementView(thorne, runId);
    await expect(
      rosterService.saveDraftSelection(thorne, {
        runId,
        version: view.roster.version,
        selections: [
          { signupId: temph, selectedRole: "MELEE_DPS" },
          { signupId: fresh, selectedRole: "DPS" },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_ROSTER_SELECTION" });
    expect(await storedRole(fresh)).toBe("MISSING");
  });

  it("does not send a selection notification when an already-selected DPS row self-heals", async () => {
    const runId = await createOpenRun(11);
    const signupId = await createHistoricSignup(runId, productionNine[6]!);
    const view = await rosterService.getRosterManagementView(thorne, runId);
    await selectAsLegacyDps(view.roster.id, signupId);
    const userId = (await orm.RunSignup.where({ id: signupId }).select("userId").first()) as { userId: string };
    const now = new Date().toISOString();
    await orm.UserNotification.create({
      id: crypto.randomUUID(),
      userId: userId.userId,
      type: "ROSTER_SELECTED",
      runId,
      signupId,
      sourceKey: rosterSelectedSourceKey(runId, 1, signupId),
      title: "Roster selected",
      message: "Already selected",
      href: `/runs/${runId}`,
      discordDeliveryStatus: "SKIPPED",
      visibleInApp: true,
      createdAt: now,
      updatedAt: now,
    });

    const loaded = await rosterService.getRosterManagementView(thorne, runId);
    await rosterService.saveDraftSelection(thorne, {
      runId,
      version: loaded.roster.version,
      selections: [{ signupId, selectedRole: "DPS" }],
    });

    const notes = await orm.UserNotification.where({ runId, signupId }).select("type").all();
    expect(notes.map((row) => (row as { type: string }).type)).toEqual(["ROSTER_SELECTED"]);
    expect(await storedRole(signupId)).toBe("RANGED_DPS");
  });

  it("does not treat a stored DPS self-heal as a brand-new selection when nobody was notified yet", async () => {
    const runId = await createOpenRun(11);
    const signupId = await createHistoricSignup(runId, productionNine[4]!);
    const view = await rosterService.getRosterManagementView(thorne, runId);
    await selectAsLegacyDps(view.roster.id, signupId);
    const loaded = await rosterService.getRosterManagementView(thorne, runId);
    await rosterService.saveDraftSelection(thorne, {
      runId,
      version: loaded.roster.version,
      selections: [{ signupId, selectedRole: "DPS" }],
    });
    const notes = await orm.UserNotification.where({ runId, signupId }).select("type").all();
    expect(notes).toHaveLength(0);
    expect(await storedRole(signupId)).toBe("MELEE_DPS");
  });

  it("lets Synblast's healed Ranged assignment be changed to Healer", async () => {
    const runId = await createOpenRun(11);
    const signupId = await createHistoricSignup(runId, productionNine[2]!);
    let view = await rosterService.getRosterManagementView(thorne, runId);
    await selectAsLegacyDps(view.roster.id, signupId);
    view = await rosterService.getRosterManagementView(thorne, runId);
    expect(view.boosters.find((row) => row.id === signupId)?.selectedRole).toBe("RANGED_DPS");

    await rosterService.saveDraftSelection(thorne, {
      runId,
      version: view.roster.version,
      selections: [{ signupId, selectedRole: "DPS" }],
    });
    expect(await storedRole(signupId)).toBe("RANGED_DPS");

    view = await rosterService.getRosterManagementView(thorne, runId);
    await rosterService.saveDraftSelection(thorne, {
      runId,
      version: view.roster.version,
      selections: [{ signupId, selectedRole: "HEALER" }],
    });
    expect(await storedRole(signupId)).toBe("HEALER");
    expect(await offeredRoles(signupId)).toEqual(["DPS", "HEALER"]);
  });
});
