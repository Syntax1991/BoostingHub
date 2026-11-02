import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { anyContentRunInput } from "@/lib/test-run-input";
import { rosterSelectedSourceKey } from "@/repositories/user-notification.repository";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import type { CharacterRole, WowClass } from "@/models/enums";
import { testActor } from "@/test/actors";
import { assertIsolatedTestDatabase, createTestCharacter, createTestUser, deleteCreatedRows } from "@/test/db-fixtures";
import { DAY_MS, HOUR_MS } from "@/test/time";

/**
 * Roster rows saved before DPS was split into Melee and Ranged still store
 * selectedRole "DPS" (and offers may still carry the generic DPS role). They
 * are read as the concrete role the Character can play and rewritten on the
 * next save.
 */
const created = { runIds: [] as string[], characterIds: [] as string[], userIds: [] as string[] };
let lead: AuthenticatedUser;

type Fixture = {
  name: string;
  wowClass: WowClass;
  specialization: string;
  primaryRole: CharacterRole;
  offeredRoles: CharacterRole[];
  playableSpecs?: string[];
  expected: "MELEE_DPS" | "RANGED_DPS" | null;
};

/** The shape of the stored roster that exposed the bug: nine generic DPS picks, one of them a hybrid healer. */
const legacyNine: Fixture[] = [
  { name: "Legacyhunter", wowClass: "HUNTER", specialization: "Marksmanship", primaryRole: "RANGED_DPS", offeredRoles: ["DPS"], expected: "RANGED_DPS" },
  { name: "Legacyshadow", wowClass: "PRIEST", specialization: "Shadow", primaryRole: "RANGED_DPS", offeredRoles: ["DPS"], expected: "RANGED_DPS" },
  { name: "Legacyhybrid", wowClass: "SHAMAN", specialization: "Restoration", primaryRole: "HEALER", offeredRoles: ["HEALER", "DPS"], playableSpecs: ["Elemental"], expected: "RANGED_DPS" },
  { name: "Legacylock", wowClass: "WARLOCK", specialization: "Demonology", primaryRole: "RANGED_DPS", offeredRoles: ["DPS"], expected: "RANGED_DPS" },
  { name: "Legacyrogue", wowClass: "ROGUE", specialization: "Subtlety", primaryRole: "MELEE_DPS", offeredRoles: ["DPS"], expected: "MELEE_DPS" },
  { name: "Legacyarms", wowClass: "WARRIOR", specialization: "Arms", primaryRole: "MELEE_DPS", offeredRoles: ["DPS"], expected: "MELEE_DPS" },
  { name: "Legacyfrost", wowClass: "MAGE", specialization: "Frost", primaryRole: "RANGED_DPS", offeredRoles: ["DPS"], expected: "RANGED_DPS" },
  { name: "Legacyarmstwo", wowClass: "WARRIOR", specialization: "Arms", primaryRole: "MELEE_DPS", offeredRoles: ["DPS"], expected: "MELEE_DPS" },
  { name: "Legacyele", wowClass: "SHAMAN", specialization: "Elemental", primaryRole: "RANGED_DPS", offeredRoles: ["DPS"], expected: "RANGED_DPS" },
];
const HYBRID = legacyNine[2]!;
const ROGUE = legacyNine[4]!;
const FROST_MAGE = legacyNine[6]!;
const AMBIGUOUS_FREE = legacyNine.filter((fixture) => fixture.name !== "Legacyele");

async function createHistoricSignup(runId: string, fixture: Fixture): Promise<string> {
  const now = new Date().toISOString();
  const userId = await createTestUser({ name: `Legacy ${fixture.name}`, isBooster: true });
  created.userIds.push(userId);
  const characterId = await createTestCharacter({
    userId,
    name: fixture.name,
    realm: "Antonidas",
    wowClass: fixture.wowClass,
    specialization: fixture.specialization,
    primaryRole: fixture.primaryRole,
  });
  created.characterIds.push(characterId);
  for (const specialization of fixture.playableSpecs ?? []) {
    await orm.CharacterPlayableSpec.create({ id: crypto.randomUUID(), characterId, specialization, createdAt: now });
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
    await orm.RunSignupRole.create({ id: crypto.randomUUID(), signupId, role, createdAt: now });
  }
  return signupId;
}

async function createOpenRun() {
  const run = await runService.createRun(
    lead,
    anyContentRunInput({
      scheduledStartAt: new Date(Date.now() + 20 * DAY_MS + created.runIds.length * HOUR_MS).toISOString(),
      desiredTankCount: 0,
      desiredHealerCount: 0,
      desiredDpsCount: 11,
    }),
  );
  created.runIds.push(run.id);
  await runService.openRun(lead, run.id);
  return run.id;
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  const leadId = await createTestUser({ name: "Legacy Draft Lead", accountRole: "RAID_LEAD" });
  created.userIds.push(leadId);
  lead = testActor(leadId, "RAID_LEAD");
});

afterAll(async () => {
  await deleteCreatedRows(created);
});

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
  it("counts nine stored DPS selections as concrete DPS on read, then self-heals on save", async () => {
    const runId = await createOpenRun();
    const ids = new Map<string, string>();
    for (const fixture of legacyNine) {
      ids.set(fixture.name, await createHistoricSignup(runId, fixture));
    }
    let view = await rosterService.getRosterManagementView(lead, runId);
    for (const signupId of ids.values()) {
      await selectAsLegacyDps(view.roster.id, signupId);
    }

    view = await rosterService.getRosterManagementView(lead, runId);
    const selected = view.boosters.filter((row) => row.draftSelected);
    expect(selected).toHaveLength(9);
    expect(view.summary.meleeDps + view.summary.rangedDps).toBe(9);
    expect(view.summary.legacyDps).toBe(0);
    expect(view.composition.dps.selected).toBe(9);
    expect(view.validation.canPublish).toBe(true);

    for (const fixture of legacyNine) {
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
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections: [
        ...legacyNine.map((fixture) => ({
          signupId: ids.get(fixture.name)!,
          selectedRole: fixture.expected,
        })),
        { signupId: tenthId, selectedRole: "RANGED_DPS" as const },
      ],
    });

    for (const fixture of legacyNine) {
      expect(await storedRole(ids.get(fixture.name)!)).toBe(fixture.expected);
      expect(await offeredRoles(ids.get(fixture.name)!)).toEqual([...fixture.offeredRoles].sort());
    }
    expect(await storedRole(tenthId)).toBe("RANGED_DPS");
    expect(await offeredRoles(tenthId)).toEqual(["DPS"]);
    view = await rosterService.getRosterManagementView(lead, runId);
    expect(view.composition.dps.selected).toBe(10);
    expect(view.boosters.filter((row) => row.selectedRole === "DPS")).toHaveLength(0);
  });

  it("accepts a stale client that still submits selectedRole DPS for an existing legacy slot", async () => {
    const runId = await createOpenRun();
    const ids = new Map<string, string>();
    for (const fixture of legacyNine) {
      ids.set(fixture.name, await createHistoricSignup(runId, fixture));
    }
    let view = await rosterService.getRosterManagementView(lead, runId);
    for (const signupId of ids.values()) await selectAsLegacyDps(view.roster.id, signupId);
    const tenthId = await createHistoricSignup(runId, {
      name: "Stalefrost",
      wowClass: "MAGE",
      specialization: "Frost",
      primaryRole: "RANGED_DPS",
      offeredRoles: ["DPS"],
      expected: "RANGED_DPS",
    });
    view = await rosterService.getRosterManagementView(lead, runId);

    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections: [
        ...[...ids.values()].map((signupId) => ({ signupId, selectedRole: "DPS" as const })),
        { signupId: tenthId, selectedRole: "RANGED_DPS" as const },
      ],
    });

    for (const fixture of legacyNine) {
      expect(await storedRole(ids.get(fixture.name)!)).toBe(fixture.expected);
    }
    expect(await storedRole(tenthId)).toBe("RANGED_DPS");
  });

  it("lets an ambiguous stored DPS row stay selected without blocking an unrelated save", async () => {
    const runId = await createOpenRun();
    const unique = AMBIGUOUS_FREE;
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
    let view = await rosterService.getRosterManagementView(lead, runId);
    for (const signupId of ids.values()) await selectAsLegacyDps(view.roster.id, signupId);
    await selectAsLegacyDps(view.roster.id, ambiguousId);

    view = await rosterService.getRosterManagementView(lead, runId);
    expect(view.summary.meleeDps + view.summary.rangedDps).toBe(8);
    expect(view.summary.legacyDps).toBe(1);
    expect(view.composition.dps.selected).toBe(8);
    expect(view.boosters.find((row) => row.id === ambiguousId)?.draftSelected).toBe(true);
    expect(view.boosters.find((row) => row.id === ambiguousId)?.selectedRole).toBeNull();
    expect(view.groups.unassignedDps.some((row) => row.id === ambiguousId && row.draftSelected)).toBe(true);
    expect(view.validation.canPublish).toBe(false);
    expect(view.validation.blockers).toContainEqual(
      expect.objectContaining({ code: "INVALID_ROSTER_SELECTION", signupId: ambiguousId }),
    );
    expect(await storedRole(ambiguousId)).toBe("DPS");

    const extraId = await createHistoricSignup(runId, {
      name: "Extrafrost",
      wowClass: "MAGE",
      specialization: "Frost",
      primaryRole: "RANGED_DPS",
      offeredRoles: ["DPS"],
      expected: "RANGED_DPS",
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
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
    view = await rosterService.getRosterManagementView(lead, runId);
    expect(view.boosters.find((row) => row.id === ambiguousId)?.draftSelected).toBe(true);
    await expect(
      rosterService.publishRoster(lead, { runId, version: view.roster.version, acknowledgeWarnings: true }),
    ).rejects.toMatchObject({ code: "ROSTER_VALIDATION_FAILED" });

    view = await rosterService.getRosterManagementView(lead, runId);
    const keep = view.boosters.filter((row) => row.draftSelected && row.id !== ambiguousId);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections: [
        ...keep.map((row) => ({ signupId: row.id, selectedRole: row.selectedRole })),
        { signupId: ambiguousId, selectedRole: "MELEE_DPS" as const },
      ],
    });
    expect(await storedRole(ambiguousId)).toBe("MELEE_DPS");

    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
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
    const runId = await createOpenRun();
    const hunter = await createHistoricSignup(runId, legacyNine[0]!);
    const rogue = await createHistoricSignup(runId, ROGUE);
    let view = await rosterService.getRosterManagementView(lead, runId);
    await selectAsLegacyDps(view.roster.id, hunter);
    await selectAsLegacyDps(view.roster.id, rogue);
    view = await rosterService.getRosterManagementView(lead, runId);

    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections: [{ signupId: rogue, selectedRole: "DPS" }],
    });
    expect(await storedRole(hunter)).toBe("MISSING");
    expect(await storedRole(rogue)).toBe("MELEE_DPS");

    const fresh = await createHistoricSignup(runId, {
      name: "Brandnew",
      wowClass: "MAGE",
      specialization: "Frost",
      primaryRole: "RANGED_DPS",
      offeredRoles: ["DPS"],
      expected: "RANGED_DPS",
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await expect(
      rosterService.saveDraftSelection(lead, {
        runId,
        version: view.roster.version,
        selections: [
          { signupId: rogue, selectedRole: "MELEE_DPS" },
          { signupId: fresh, selectedRole: "DPS" },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_ROSTER_SELECTION" });
    expect(await storedRole(fresh)).toBe("MISSING");
  });

  it("does not send a selection notification when an already-selected DPS row self-heals", async () => {
    const runId = await createOpenRun();
    const signupId = await createHistoricSignup(runId, FROST_MAGE);
    const view = await rosterService.getRosterManagementView(lead, runId);
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

    const loaded = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: loaded.roster.version,
      selections: [{ signupId, selectedRole: "DPS" }],
    });

    const notes = await orm.UserNotification.where({ runId, signupId }).select("type").all();
    expect(notes.map((row) => (row as { type: string }).type)).toEqual(["ROSTER_SELECTED"]);
    expect(await storedRole(signupId)).toBe("RANGED_DPS");
  });

  it("does not treat a stored DPS self-heal as a brand-new selection when nobody was notified yet", async () => {
    const runId = await createOpenRun();
    const signupId = await createHistoricSignup(runId, ROGUE);
    const view = await rosterService.getRosterManagementView(lead, runId);
    await selectAsLegacyDps(view.roster.id, signupId);
    const loaded = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: loaded.roster.version,
      selections: [{ signupId, selectedRole: "DPS" }],
    });
    const notes = await orm.UserNotification.where({ runId, signupId }).select("type").all();
    expect(notes).toHaveLength(0);
    expect(await storedRole(signupId)).toBe("MELEE_DPS");
  });

  it("lets a hybrid's healed Ranged assignment be changed to Healer", async () => {
    const runId = await createOpenRun();
    const signupId = await createHistoricSignup(runId, HYBRID);
    let view = await rosterService.getRosterManagementView(lead, runId);
    await selectAsLegacyDps(view.roster.id, signupId);
    view = await rosterService.getRosterManagementView(lead, runId);
    expect(view.boosters.find((row) => row.id === signupId)?.selectedRole).toBe("RANGED_DPS");

    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections: [{ signupId, selectedRole: "DPS" }],
    });
    expect(await storedRole(signupId)).toBe("RANGED_DPS");

    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections: [{ signupId, selectedRole: "HEALER" }],
    });
    expect(await storedRole(signupId)).toBe("HEALER");
    expect(await offeredRoles(signupId)).toEqual(["DPS", "HEALER"]);
  });
});
