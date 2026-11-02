import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orm } from "@/lib/prisma";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import type { AccountRole, CharacterRole, WowClass } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { rosterRepository } from "@/repositories/roster.repository";
import { rosterBuilderService } from "@/services/roster-builder.service";
import { testActor } from "@tests/fixtures/actors";
import { assertIsolatedTestDatabase, createTestCharacter, createTestUser, deleteCreatedRows } from "@tests/fixtures/db-fixtures";
import { DAY_MS } from "@tests/fixtures/time";

/**
 * Every test gets its own Run, users, Characters and signups (fresh ids), written
 * as rows so a test can put them straight into the state it needs.
 */
type FixtureIds = {
  admin: string;
  lead: string;
  boosterA: string;
  boosterB: string;
  user: string;
  run: string;
  signupHealer: string;
  signupMelee: string;
  signupRanged: string;
};
let ids: FixtureIds;
let created: { runIds: string[]; characterIds: string[]; userIds: string[] };

const admin = () => testActor(ids.admin, "ADMIN");
const lead = () => testActor(ids.lead, "RAID_LEAD");

async function createUser(name: string, accountRole: AccountRole, isBooster: boolean) {
  const id = await createTestUser({ name, accountRole, isBooster });
  created.userIds.push(id);
  return id;
}

async function createCharacter(input: {
  userId: string;
  name: string;
  wowClass: WowClass;
  specialization: string;
  primaryRole: CharacterRole;
  itemLevel: number;
}) {
  const id = await createTestCharacter({ ...input, realm: "Blackrock" });
  created.characterIds.push(id);
  return id;
}

async function createSignup(input: { userId: string; characterId: string; roles: CharacterRole[] }) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.RunSignup.create({
    id,
    runId: ids.run,
    userId: input.userId,
    characterId: input.characterId,
    participationType: "BOOSTER",
    isBackup: false,
    status: "PENDING",
    publishedRole: null,
    createdAt: now,
    updatedAt: now,
  });
  for (const role of input.roles) {
    await orm.RunSignupRole.create({ id: crypto.randomUUID(), signupId: id, role, createdAt: now });
  }
  return id;
}

async function createRun(raidLeadId: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.Run.create({
    id,
    title: "RB Test Run",
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    scheduledStartAt: new Date(Date.now() + 3 * DAY_MS).toISOString(),
    status: "OPEN",
    signupsOpen: true,
    desiredTankCount: 0,
    desiredHealerCount: 1,
    desiredDpsCount: 2,
    desiredLootbuddyCount: 0,
    raidLeadId,
    notes: null,
    createdAt: now,
    updatedAt: now,
  });
  created.runIds.push(id);
  await orm.RunRaidContent.create({
    id: crypto.randomUUID(),
    runId: id,
    raidId: VENOMOUS_ABYSS_RAID_ID,
    sortOrder: 1,
    plannedBossCount: 8,
    createdAt: now,
  });
  return id;
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  await raidRepository.ensureReferenceRaids();
});

beforeEach(async () => {
  created = { runIds: [], characterIds: [], userIds: [] };
  const adminId = await createUser("RB Admin", "ADMIN", false);
  const leadId = await createUser("RB Lead", "RAID_LEAD", true);
  const boosterA = await createUser("RB Booster A", "USER", true);
  const boosterB = await createUser("RB Booster B", "USER", true);
  const user = await createUser("RB User", "USER", false);
  const charHealer = await createCharacter({
    userId: boosterA,
    name: "RbHealer",
    wowClass: "PRIEST",
    specialization: "Holy",
    primaryRole: "HEALER",
    itemLevel: 334,
  });
  const charMelee = await createCharacter({
    userId: boosterB,
    name: "RbMelee",
    wowClass: "WARRIOR",
    specialization: "Arms",
    primaryRole: "MELEE_DPS",
    itemLevel: 333,
  });
  const charRanged = await createCharacter({
    userId: leadId,
    name: "RbRanged",
    wowClass: "MAGE",
    specialization: "Fire",
    primaryRole: "RANGED_DPS",
    itemLevel: 331,
  });
  const run = await createRun(leadId);
  ids = { admin: adminId, lead: leadId, boosterA, boosterB, user, run, signupHealer: "", signupMelee: "", signupRanged: "" };
  ids.signupHealer = await createSignup({ userId: boosterA, characterId: charHealer, roles: ["HEALER"] });
  ids.signupMelee = await createSignup({ userId: boosterB, characterId: charMelee, roles: ["MELEE_DPS"] });
  ids.signupRanged = await createSignup({ userId: leadId, characterId: charRanged, roles: ["RANGED_DPS"] });
});

afterEach(async () => {
  await deleteCreatedRows(created);
});

describe("rosterBuilderService", () => {
  it("proposes only from Run signups and fills aggregate DPS", async () => {
    const result = await rosterBuilderService.proposeRoster(admin(), ids.run);
    expect(result.fullyStaffed).toBe(false);
    expect(result.shortages).toMatchObject({ healers: 1, dps: 2 });
    expect(result.applySelections).toHaveLength(3);
    expect(result.applySelections).toEqual(
      expect.arrayContaining([
        { signupId: ids.signupHealer, selectedRole: "HEALER" },
        { signupId: ids.signupMelee, selectedRole: "MELEE_DPS" },
        { signupId: ids.signupRanged, selectedRole: "RANGED_DPS" },
      ]),
    );
  });

  it("keeps existing draft picks locked and only fills remaining", async () => {
    const roster = await rosterRepository.ensure(ids.run);
    await rosterRepository.replaceSelectedSignupIds(roster.id, roster.version, [
      { signupId: ids.signupHealer, selectedRole: "HEALER" },
    ]);
    const result = await rosterBuilderService.proposeRoster(admin(), ids.run);
    expect(result.shortages.healers).toBe(0);
    expect(result.shortages.dps).toBe(2);
    expect(result.proposed.some((row) => row.signupId === ids.signupHealer && row.locked)).toBe(true);
    expect(result.applySelections.map((row) => row.signupId).sort()).toEqual([ids.signupMelee, ids.signupRanged].sort());
  });

  it("applies proposal through saveDraftSelection and revalidates stale input", async () => {
    const proposal = await rosterBuilderService.proposeRoster(lead(), ids.run);
    expect(proposal.applySelections.length).toBe(3);

    await rosterBuilderService.applyRosterProposal(lead(), {
      runId: ids.run,
      expectedVersion: proposal.rosterVersion,
      selections: proposal.applySelections,
    });

    const roster = await rosterRepository.findByRunId(ids.run);
    expect(roster?.selectedSignupIds.sort()).toEqual([ids.signupHealer, ids.signupMelee, ids.signupRanged].sort());

    await expect(
      rosterBuilderService.applyRosterProposal(lead(), {
        runId: ids.run,
        expectedVersion: proposal.rosterVersion,
        selections: proposal.applySelections,
      }),
    ).rejects.toMatchObject({ code: "ROSTER_ALREADY_CHANGED" });
  });

  describe("Fill gaps / Build on the editor draft (baseSelections)", () => {
    it("Fill gaps keeps the unsaved draft's picks and fills only the missing composition — read-only", async () => {
      const before = await rosterRepository.ensure(ids.run);
      const result = await rosterBuilderService.proposeRoster(lead(), ids.run, {
        baseSelections: [{ signupId: ids.signupHealer, selectedRole: "HEALER" }],
      });
      expect(result.shortages).toMatchObject({ tanks: 0, healers: 0, dps: 2 });
      expect(result.proposed.find((row) => row.signupId === ids.signupHealer)?.locked).toBe(true);
      expect(result.applySelections.map((row) => row.signupId).sort()).toEqual([ids.signupMelee, ids.signupRanged].sort());
      expect(result.fullSelections.map((row) => row.signupId).sort()).toEqual(
        [ids.signupHealer, ids.signupMelee, ids.signupRanged].sort(),
      );
      // Draft only: nothing persisted, no status change.
      const after = await rosterRepository.findByRunId(ids.run);
      expect(after?.version).toBe(before.version);
      expect(after?.selectedSignupIds).toEqual([]);
      const run = (await orm.Run.where({ id: ids.run }).select("status").first()) as { status: string };
      expect(run.status).toBe("OPEN");
    });

    it("uses the given draft, not the saved one", async () => {
      const roster = await rosterRepository.ensure(ids.run);
      await rosterRepository.replaceSelectedSignupIds(roster.id, roster.version, [
        { signupId: ids.signupHealer, selectedRole: "HEALER" },
      ]);
      const result = await rosterBuilderService.proposeRoster(lead(), ids.run, {
        baseSelections: [
          { signupId: ids.signupMelee, selectedRole: "MELEE_DPS" },
          { signupId: ids.signupRanged, selectedRole: "RANGED_DPS" },
        ],
      });
      // DPS full from the draft; only the Healer gap is filled, by the only Healer signup.
      expect(result.shortages).toMatchObject({ healers: 1, dps: 0 });
      expect(result.applySelections).toEqual([{ signupId: ids.signupHealer, selectedRole: "HEALER" }]);
    });

    it("incompatible roles are never proposed: a Healer-only signup does not fill a DPS gap", async () => {
      const result = await rosterBuilderService.proposeRoster(lead(), ids.run, {
        baseSelections: [{ signupId: ids.signupMelee, selectedRole: "MELEE_DPS" }],
      });
      expect(result.applySelections).toHaveLength(2);
      expect(result.applySelections).toEqual(
        expect.arrayContaining([
          { signupId: ids.signupHealer, selectedRole: "HEALER" },
          { signupId: ids.signupRanged, selectedRole: "RANGED_DPS" },
        ]),
      );
    });

    it("a full draft is fully staffed — nothing new proposed", async () => {
      const result = await rosterBuilderService.proposeRoster(lead(), ids.run, {
        baseSelections: [
          { signupId: ids.signupHealer, selectedRole: "HEALER" },
          { signupId: ids.signupMelee, selectedRole: "MELEE_DPS" },
          { signupId: ids.signupRanged, selectedRole: "RANGED_DPS" },
        ],
      });
      expect(result.fullyStaffed).toBe(true);
      expect(result.applySelections).toEqual([]);
    });

    it("Build from signups (empty base) proposes the whole draft from current signups only", async () => {
      const roster = await rosterRepository.ensure(ids.run);
      await rosterRepository.replaceSelectedSignupIds(roster.id, roster.version, [
        { signupId: ids.signupHealer, selectedRole: "HEALER" },
      ]);
      const result = await rosterBuilderService.proposeRoster(lead(), ids.run, { baseSelections: [] });
      expect(result.proposed.every((row) => !row.locked)).toBe(true);
      expect(result.fullSelections.map((row) => row.signupId).sort()).toEqual(
        [ids.signupHealer, ids.signupMelee, ids.signupRanged].sort(),
      );
    });

    describe("published roster: a re-selected NOT_SELECTED pick stays locked", () => {
      const extra = { signupHealer2: "", signupLootA: "", signupLootB: "" };

      async function createLootbuddy(userId: string, status: "PENDING" | "NOT_SELECTED") {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        await orm.RunSignup.create({
          id,
          runId: ids.run,
          userId,
          characterId: null,
          participationType: "LOOTBUDDY",
          isBackup: false,
          status,
          publishedRole: null,
          lootbuddyClass: "MAGE",
          lootbuddyMode: "LOOT_ONLY",
          lootbuddyVerification: "NONE",
          createdAt: now,
          updatedAt: now,
        });
        return id;
      }

      beforeEach(async () => {
        const boosterC = await createUser("RB Booster C", "USER", true);
        // A strictly better Healer competitor: higher item level, primary Healer.
        const charHealer2 = await createCharacter({
          userId: boosterC,
          name: "RbHealerTwo",
          wowClass: "PRIEST",
          specialization: "Holy",
          primaryRole: "HEALER",
          itemLevel: 345,
        });
        extra.signupHealer2 = await createSignup({ userId: boosterC, characterId: charHealer2, roles: ["HEALER"] });
        extra.signupLootA = await createLootbuddy(ids.boosterA, "NOT_SELECTED");
        extra.signupLootB = await createLootbuddy(ids.boosterB, "PENDING");
        await orm.RunSignup.where({ id: ids.signupHealer }).update({ status: "NOT_SELECTED" });
        await orm.Run.where({ id: ids.run }).update({ status: "PUBLISHED", desiredLootbuddyCount: 1 });
      });

      it("Fill gaps keeps the NOT_SELECTED Healer locked and never proposes the better competitor in its place", async () => {
        const result = await rosterBuilderService.proposeRoster(lead(), ids.run, {
          baseSelections: [{ signupId: ids.signupHealer, selectedRole: "HEALER" }],
        });
        expect(result.shortages.healers).toBe(0);
        expect(result.proposed.find((row) => row.signupId === ids.signupHealer)).toMatchObject({
          locked: true,
          selectedRole: "HEALER",
        });
        expect(result.applySelections.some((row) => row.signupId === ids.signupHealer)).toBe(false);
        expect(result.fullSelections.some((row) => row.signupId === extra.signupHealer2)).toBe(false);
        expect(result.fullSelections).toContainEqual({ signupId: ids.signupHealer, selectedRole: "HEALER" });
        // Only the real gaps are filled: two DPS and one of the two eligible Lootbuddies.
        const added = result.applySelections.map((row) => row.signupId);
        expect(added.filter((id) => id === ids.signupMelee || id === ids.signupRanged).sort()).toEqual(
          [ids.signupMelee, ids.signupRanged].sort(),
        );
        expect(added.filter((id) => id === extra.signupLootA || id === extra.signupLootB)).toHaveLength(1);
        expect(added).toHaveLength(3);
      });

      it("Fill gaps keeps a NOT_SELECTED Lootbuddy locked and does not swap in another Lootbuddy", async () => {
        const result = await rosterBuilderService.proposeRoster(lead(), ids.run, {
          baseSelections: [{ signupId: extra.signupLootA, selectedRole: null }],
        });
        expect(result.shortages.lootbuddies).toBe(0);
        expect(result.proposed.find((row) => row.signupId === extra.signupLootA)?.locked).toBe(true);
        expect(result.fullSelections).toContainEqual({ signupId: extra.signupLootA, selectedRole: null });
        expect(result.fullSelections.some((row) => row.signupId === extra.signupLootB)).toBe(false);
      });

      it("a WITHDRAWN signup in the draft is still dropped and its slot is filled", async () => {
        await orm.RunSignup.where({ id: ids.signupHealer }).update({ status: "WITHDRAWN" });
        const result = await rosterBuilderService.proposeRoster(lead(), ids.run, {
          baseSelections: [{ signupId: ids.signupHealer, selectedRole: "HEALER" }],
        });
        expect(result.shortages.healers).toBe(1);
        expect(result.fullSelections.some((row) => row.signupId === ids.signupHealer)).toBe(false);
        expect(result.applySelections).toContainEqual({ signupId: extra.signupHealer2, selectedRole: "HEALER" });
      });
    });

    it("stale / withdrawn / foreign ids in the draft are dropped, and the result is deterministic", async () => {
      await orm.RunSignup.where({ id: ids.signupMelee }).update({ status: "WITHDRAWN" });
      const input = {
        baseSelections: [
          { signupId: ids.signupMelee, selectedRole: "MELEE_DPS" as const },
          { signupId: crypto.randomUUID(), selectedRole: "HEALER" as const },
        ],
      };
      const first = await rosterBuilderService.proposeRoster(lead(), ids.run, input);
      const second = await rosterBuilderService.proposeRoster(lead(), ids.run, input);
      expect(first.fullSelections.some((row) => row.signupId === ids.signupMelee)).toBe(false);
      expect(first.fullSelections).toEqual(second.fullSelections);
      expect(first.fullSelections.map((row) => row.signupId).sort()).toEqual([ids.signupHealer, ids.signupRanged].sort());
    });
  });

  it("blocks USER from proposing", async () => {
    await expect(rosterBuilderService.proposeRoster(testActor(ids.user, "USER"), ids.run)).rejects.toMatchObject({
      code: "RUN_NOT_MANAGEABLE",
    });
  });
});
