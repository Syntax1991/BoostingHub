import { afterAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { attendanceService } from "@/services/attendance.service";
import { discordSyncService } from "@/services/discord-sync.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import type { CharacterRole, WowClass } from "@/models/enums";

const kaelId = "11111111-1111-4111-8111-111111111111";
const thorneId = "33333333-3333-4333-8333-333333333333";
const brannId = "55555555-5555-4555-8555-555555555555";

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
  const characterId = crypto.randomUUID();
  createdCharacterIds.push(characterId);
  const userId = fixture.userId ?? kaelId;
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

async function createOpenRun(desiredDpsCount = 2) {
  const run = await runService.createRun(
    thorne,
    venomousCreateInput({
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      venomousPlannedBossCount: 8,
      scheduledStartAt: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString(),
      desiredTankCount: 0,
      desiredHealerCount: 0,
      desiredDpsCount,
    }),
  );
  createdRunIds.push(run.id);
  await runService.openRun(thorne, run.id);
  return run.id;
}

function card(view: Awaited<ReturnType<typeof rosterService.getRosterManagementView>>, name: string) {
  return view.boosters.find((row) => row.character?.name === name);
}

async function offeredRoleNames(signupId: string): Promise<string[]> {
  const rows = (await orm.RunSignupRole.where({ signupId }).select("role").all()) as Array<{ role: string }>;
  return rows.map((row) => row.role).sort();
}

describe("historic generic DPS roster assignment", () => {
  afterAll(async () => {
    for (const runId of createdRunIds) {
      const notes = await orm.UserNotification.where({ runId }).select("id").all();
      for (const row of notes) {
        await orm.UserNotification.where({ id: (row as { id: string }).id }).delete();
      }
      const attendance = await orm.RunAttendance.where({ runId }).select("id").all();
      for (const row of attendance) {
        await orm.RunAttendance.where({ id: (row as { id: string }).id }).delete();
      }
      const start = await orm.RunStartSnapshot.where({ runId }).first();
      if (start) await orm.RunStartSnapshot.where({ id: (start as { id: string }).id }).delete();
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
  });

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

    const view = await rosterService.getRosterManagementView(thorne, runId);
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
    let view = await rosterService.getRosterManagementView(thorne, runId);

    await expect(
      rosterService.saveDraftSelection(thorne, {
        runId,
        version: view.roster.version,
        selections: [{ signupId, selectedRole: "DPS" }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_ROSTER_SELECTION" });

    await rosterService.setDraftSelection(thorne, {
      runId,
      signupId,
      selected: true,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(thorne, runId);
    expect(view.boosters.find((row) => row.id === signupId)?.selectedRole).toBe("RANGED_DPS");
    expect(await offeredRoleNames(signupId)).toEqual(["DPS"]);
  });

  it("requires an explicit concrete role for ambiguous historic DPS and blocks publish until chosen", async () => {
    const runId = await createOpenRun(1);
    const signupId = await createHistoricSignup(runId, {
      name: "Synblast",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      primaryRole: "HEALER",
      offeredRoles: ["HEALER", "DPS"],
    });
    const signupRow = (await orm.RunSignup.where({ id: signupId }).select("characterId").first()) as {
      characterId: string;
    };
    const beforeSpecs = await orm.CharacterPlayableSpec.where({ characterId: signupRow.characterId }).all();
    let view = await rosterService.getRosterManagementView(thorne, runId);

    await expect(
      rosterService.setDraftSelection(thorne, {
        runId,
        signupId,
        selected: true,
        version: view.roster.version,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_ROSTER_SELECTION",
      message: "Choose Melee or Ranged DPS for Synblast-Antonidas.",
    });

    await rosterService.saveDraftSelection(thorne, {
      runId,
      version: view.roster.version,
      selections: [{ signupId, selectedRole: "MELEE_DPS" }],
    });
    view = await rosterService.getRosterManagementView(thorne, runId);
    const entry = (await orm.RunRosterEntry.where({ signupId }).first()) as { id: string } | null;
    expect(entry).not.toBeNull();
    await orm.RunRosterEntry.where({ id: entry!.id }).update({ selectedRole: null });

    await expect(
      rosterService.publishRoster(thorne, {
        runId,
        version: view.roster.version,
        acknowledgeWarnings: true,
      }),
    ).rejects.toMatchObject({
      code: "ROSTER_VALIDATION_FAILED",
      message: "Choose Melee or Ranged DPS for Synblast-Antonidas.",
    });

    view = await rosterService.getRosterManagementView(thorne, runId);
    await rosterService.saveDraftSelection(thorne, {
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
      userId: brannId,
      wowClass: "SHAMAN",
      specialization: "Restoration",
      primaryRole: "HEALER",
      offeredRoles: ["HEALER", "DPS"],
    });
    let view = await rosterService.getRosterManagementView(thorne, runId);
    await rosterService.saveDraftSelection(thorne, {
      runId,
      version: view.roster.version,
      selections: [
        { signupId: frostId, selectedRole: "RANGED_DPS" },
        { signupId: shamanId, selectedRole: "MELEE_DPS" },
      ],
    });
    view = await rosterService.getRosterManagementView(thorne, runId);
    await rosterService.publishRoster(thorne, {
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

    await runService.startRun(thorne, { runId });
    const attendance = await attendanceService.getManagerAttendance(thorne, runId);
    expect(attendance.rows.find((row) => row.characterName === "Raidfrost")?.selectedRole).toBe("RANGED_DPS");
    expect(attendance.rows.find((row) => row.characterName === "Raidresto")?.selectedRole).toBe("MELEE_DPS");
  });
});
