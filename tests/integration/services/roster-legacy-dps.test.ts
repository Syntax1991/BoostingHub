import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { anyContentRunInput } from "@tests/fixtures/test-run-input";
import { attendanceService } from "@/services/attendance.service";
import { discordSyncService } from "@/services/discord-sync.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import type { CharacterRole, WowClass } from "@/models/enums";
import { testActor } from "@tests/fixtures/actors";
import { assertIsolatedTestDatabase, createTestCharacter, createTestUser, deleteCreatedRows } from "@tests/fixtures/db-fixtures";
import { CURRENT_WEEK_RUN_START, HOUR_MS, RAID_WEEK_TEST_CLOCK, freezeSystemTime, restoreSystemTime } from "@tests/fixtures/time";

/** Runs (signups, rosters, attendance) cascade; Characters and specs go with their owners. */
const created = { runIds: [] as string[], userIds: [] as string[] };
let lead: AuthenticatedUser;
/** Owners of the historic signups; a second Booster where one User must not own both. */
let boosterId = "";
let secondBoosterId = "";

type Fixture = {
  name: string;
  userId?: string;
  wowClass: WowClass;
  specialization: string;
  primaryRole: CharacterRole;
  offeredRoles: CharacterRole[];
  playableSpecs?: string[];
};

async function createHistoricSignup(runId: string, fixture: Fixture): Promise<string> {
  const now = new Date().toISOString();
  const userId = fixture.userId ?? boosterId;
  const characterId = await createTestCharacter({
    userId,
    name: fixture.name,
    realm: "Antonidas",
    wowClass: fixture.wowClass,
    specialization: fixture.specialization,
    primaryRole: fixture.primaryRole,
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

/** An OPEN Run a few hours after the previous one, so no two of them reserve the same Character slot. */
async function createOpenRun(desiredDpsCount = 2) {
  const scheduledStartAt = new Date(Date.parse(CURRENT_WEEK_RUN_START) + created.runIds.length * 3 * HOUR_MS).toISOString();
  const run = await runService.createRun(
    lead,
    anyContentRunInput({ scheduledStartAt, desiredTankCount: 0, desiredHealerCount: 0, desiredDpsCount }),
  );
  created.runIds.push(run.id);
  await runService.openRun(lead, run.id);
  return run.id;
}

function card(view: Awaited<ReturnType<typeof rosterService.getRosterManagementView>>, name: string) {
  return view.boosters.find((row) => row.character?.name === name);
}

async function offeredRoleNames(signupId: string): Promise<string[]> {
  const rows = (await orm.RunSignupRole.where({ signupId }).select("role").all()) as Array<{ role: string }>;
  return rows.map((row) => row.role).sort();
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  freezeSystemTime(RAID_WEEK_TEST_CLOCK, { advance: true });
  const leadId = await createTestUser({ name: "Legacy Lead", accountRole: "RAID_LEAD" });
  boosterId = await createTestUser({ name: "Legacy Booster", isBooster: true });
  secondBoosterId = await createTestUser({ name: "Legacy Second Booster", isBooster: true });
  created.userIds.push(leadId, boosterId, secondBoosterId);
  lead = testActor(leadId, "RAID_LEAD");
});

afterAll(async () => {
  try {
    await deleteCreatedRows(created);
  } finally {
    restoreSystemTime();
  }
});

describe("historic generic DPS roster assignment", () => {
  it("buckets resolved historic DPS and leaves only ambiguous rows unassigned", async () => {
    const runId = await createOpenRun();
    const fixtures: Fixture[] = [
      { name: "Frostbite", wowClass: "MAGE", specialization: "Frost", primaryRole: "RANGED_DPS", offeredRoles: ["DPS"] },
      { name: "Markshot", wowClass: "HUNTER", specialization: "Marksmanship", primaryRole: "RANGED_DPS", offeredRoles: ["DPS"] },
      { name: "Shadowmend", wowClass: "PRIEST", specialization: "Shadow", primaryRole: "RANGED_DPS", offeredRoles: ["DPS"] },
      { name: "Demolock", wowClass: "WARLOCK", specialization: "Demonology", primaryRole: "RANGED_DPS", offeredRoles: ["DPS"] },
      { name: "Stabby", wowClass: "ROGUE", specialization: "Subtlety", primaryRole: "MELEE_DPS", offeredRoles: ["DPS"] },
      { name: "Armsman", wowClass: "WARRIOR", specialization: "Arms", primaryRole: "MELEE_DPS", offeredRoles: ["DPS"] },
      { name: "Eleboom", wowClass: "SHAMAN", specialization: "Elemental", primaryRole: "RANGED_DPS", offeredRoles: ["DPS"] },
      { name: "Enhboom", wowClass: "SHAMAN", specialization: "Enhancement", primaryRole: "MELEE_DPS", offeredRoles: ["DPS"] },
      {
        name: "RestoEle",
        wowClass: "SHAMAN",
        specialization: "Restoration",
        primaryRole: "HEALER",
        offeredRoles: ["HEALER", "DPS"],
        playableSpecs: ["Elemental"],
      },
      {
        name: "RestoBoth",
        wowClass: "SHAMAN",
        specialization: "Restoration",
        primaryRole: "HEALER",
        offeredRoles: ["HEALER", "DPS"],
        playableSpecs: ["Elemental", "Enhancement"],
      },
      {
        name: "RestoNone",
        wowClass: "SHAMAN",
        specialization: "Restoration",
        primaryRole: "HEALER",
        offeredRoles: ["HEALER", "DPS"],
      },
      {
        name: "RestoDruid",
        wowClass: "DRUID",
        specialization: "Restoration",
        primaryRole: "HEALER",
        offeredRoles: ["DPS"],
      },
      {
        name: "Holyadin",
        wowClass: "PALADIN",
        specialization: "Holy",
        primaryRole: "HEALER",
        offeredRoles: ["DPS"],
      },
      {
        name: "ModernResto",
        wowClass: "SHAMAN",
        specialization: "Restoration",
        primaryRole: "HEALER",
        offeredRoles: ["HEALER", "RANGED_DPS"],
        playableSpecs: ["Elemental"],
      },
    ];
    for (const fixture of fixtures) {
      await createHistoricSignup(runId, fixture);
    }

    const view = await rosterService.getRosterManagementView(lead, runId);
    const names = (rows: Array<{ character: { name: string } | null }>) =>
      rows.map((row) => row.character?.name).sort();

    expect(names(view.groups.rangedDps)).toEqual(
      ["Demolock", "Eleboom", "Frostbite", "Markshot", "ModernResto", "RestoEle", "Shadowmend"].sort(),
    );
    expect(names(view.groups.meleeDps)).toEqual(["Armsman", "Enhboom", "Holyadin", "Stabby"].sort());
    expect(names(view.groups.unassignedDps)).toEqual(["RestoBoth", "RestoDruid", "RestoNone"].sort());
    expect(names(view.groups.legacyDps)).toEqual(["RestoBoth", "RestoDruid", "RestoNone"].sort());
    expect(view.groups.meleeDps.some((row) => row.character?.name === "Frostbite")).toBe(false);
    expect(view.groups.rangedDps.some((row) => row.character?.name === "Stabby")).toBe(false);

    expect(card(view, "Frostbite")?.assignableRoles).toEqual(["RANGED_DPS"]);
    expect(card(view, "RestoEle")?.assignableRoles).toEqual(["HEALER", "RANGED_DPS"]);
    expect(card(view, "RestoBoth")?.assignableRoles).toEqual(["HEALER", "MELEE_DPS", "RANGED_DPS"]);
    expect(card(view, "RestoNone")?.assignableRoles).toEqual(["HEALER", "MELEE_DPS", "RANGED_DPS"]);
    expect(card(view, "RestoDruid")?.assignableRoles).toEqual(["MELEE_DPS", "RANGED_DPS"]);
    expect(card(view, "Holyadin")?.assignableRoles).toEqual(["MELEE_DPS"]);
    expect(card(view, "ModernResto")?.assignableRoles).toEqual(["HEALER", "RANGED_DPS"]);
    expect(view.groups.unassignedDps.find((row) => row.character?.name === "RestoNone")?.unassignedDps).toBe(true);
    expect(view.groups.healers.some((row) => row.character?.name === "RestoNone")).toBe(true);
    expect(view.groups.meleeDps.some((row) => row.character?.name === "RestoNone")).toBe(false);
    expect(view.groups.rangedDps.some((row) => row.character?.name === "RestoNone")).toBe(false);
  });

  it("picks a resolved historic DPS signup and still rejects generic DPS", async () => {
    const runId = await createOpenRun(1);
    const signupId = await createHistoricSignup(runId, {
      name: "Pickfrost",
      wowClass: "MAGE",
      specialization: "Frost",
      primaryRole: "RANGED_DPS",
      offeredRoles: ["DPS"],
    });
    let view = await rosterService.getRosterManagementView(lead, runId);

    await expect(
      rosterService.saveDraftSelection(lead, {
        runId,
        version: view.roster.version,
        selections: [{ signupId, selectedRole: "DPS" }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_ROSTER_SELECTION" });

    await rosterService.setDraftSelection(lead, {
      runId,
      signupId,
      selected: true,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    expect(view.boosters.find((row) => row.id === signupId)?.selectedRole).toBe("RANGED_DPS");
    expect(await offeredRoleNames(signupId)).toEqual(["DPS"]);
  });

  it("requires an explicit concrete role for ambiguous historic DPS and blocks publish until chosen", async () => {
    const runId = await createOpenRun(1);
    const signupId = await createHistoricSignup(runId, {
      name: "Testblast",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      primaryRole: "HEALER",
      offeredRoles: ["HEALER", "DPS"],
    });
    const signupRow = (await orm.RunSignup.where({ id: signupId }).select("characterId").first()) as {
      characterId: string;
    };
    const beforeSpecs = await orm.CharacterPlayableSpec.where({ characterId: signupRow.characterId }).all();
    let view = await rosterService.getRosterManagementView(lead, runId);

    await expect(
      rosterService.setDraftSelection(lead, {
        runId,
        signupId,
        selected: true,
        version: view.roster.version,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_ROSTER_SELECTION",
      message: "Choose Melee or Ranged DPS for Testblast-Antonidas.",
    });

    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections: [{ signupId, selectedRole: "MELEE_DPS" }],
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    const entry = (await orm.RunRosterEntry.where({ signupId }).first()) as { id: string } | null;
    expect(entry).not.toBeNull();
    await orm.RunRosterEntry.where({ id: entry!.id }).update({ selectedRole: null });

    await expect(
      rosterService.publishRoster(lead, {
        runId,
        version: view.roster.version,
        acknowledgeWarnings: true,
      }),
    ).rejects.toMatchObject({
      code: "ROSTER_VALIDATION_FAILED",
      message: "Choose Melee or Ranged DPS for Testblast-Antonidas.",
    });

    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections: [{ signupId, selectedRole: "RANGED_DPS" }],
    });
    expect(await offeredRoleNames(signupId)).toEqual(["DPS", "HEALER"]);
    const afterSpecs = await orm.CharacterPlayableSpec.where({ characterId: signupRow.characterId }).all();
    expect(afterSpecs).toHaveLength(beforeSpecs.length);
  });

  it("publishes a concrete role into Discord and attendance without rewriting the historic offer", async () => {
    const runId = await createOpenRun(2);
    const frostId = await createHistoricSignup(runId, {
      name: "Raidfrost",
      wowClass: "MAGE",
      specialization: "Frost",
      primaryRole: "RANGED_DPS",
      offeredRoles: ["DPS"],
    });
    const shamanId = await createHistoricSignup(runId, {
      name: "Raidresto",
      userId: secondBoosterId,
      wowClass: "SHAMAN",
      specialization: "Restoration",
      primaryRole: "HEALER",
      offeredRoles: ["HEALER", "DPS"],
    });
    let view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections: [
        { signupId: frostId, selectedRole: "RANGED_DPS" },
        { signupId: shamanId, selectedRole: "MELEE_DPS" },
      ],
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, {
      runId,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });

    const frost = await orm.RunSignup.where({ id: frostId }).select("publishedRole").first();
    const shaman = await orm.RunSignup.where({ id: shamanId }).select("publishedRole").first();
    expect((frost as { publishedRole: string }).publishedRole).toBe("RANGED_DPS");
    expect((shaman as { publishedRole: string }).publishedRole).toBe("MELEE_DPS");
    expect(await offeredRoleNames(frostId)).toEqual(["DPS"]);
    expect(await offeredRoleNames(shamanId)).toEqual(["DPS", "HEALER"]);

    const embed = await discordSyncService.getRosterEmbedData(runId);
    expect(embed?.groups.rangedDps.map((member) => member.characterName)).toContain("Raidfrost");
    expect(embed?.groups.meleeDps.map((member) => member.characterName)).toContain("Raidresto");
    expect(embed?.groups.unspecifiedDps.map((member) => member.characterName)).not.toContain("Raidresto");
    expect(embed?.groups.unspecifiedDps.map((member) => member.characterName)).not.toContain("Raidfrost");

    await runService.startRun(lead, { runId });
    const attendance = await attendanceService.getManagerAttendance(lead, runId);
    expect(attendance.rows.find((row) => row.characterName === "Raidfrost")?.selectedRole).toBe("RANGED_DPS");
    expect(attendance.rows.find((row) => row.characterName === "Raidresto")?.selectedRole).toBe("MELEE_DPS");
  });
});
