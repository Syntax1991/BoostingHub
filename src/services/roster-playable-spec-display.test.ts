import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { formatCharacterRosterMetadata } from "@/lib/character-roster-metadata";
import { futureTestIso } from "@/lib/test-run-input";
import { countRolesByBucket } from "@/lib/roster-role-buckets";
import { isConcreteCharacterRole } from "@/lib/character-roles";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { rosterService } from "@/services/roster.service";
import { signupService } from "@/services/signup.service";
import { venomousCreateInput } from "@/lib/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import { runService } from "@/services/run.service";

const ids = {
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-ops000000001",
  booster: "aaaaaaaa-aaaa-4aaa-8aaa-ops000000002",
};
const createdUserIds = Object.values(ids);
const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdSignupIds: string[] = [];

function asUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"] = "USER"): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@ops.test.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function createTestUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]) {
  await orm.User.create({
    id,
    name,
    email: `${id}@ops.test.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function createCharacter(
  userId: string,
  options: {
    specialization: string;
    primaryRole: "HEALER" | "MELEE_DPS" | "RANGED_DPS";
    playableSpecs?: string[];
    itemLevel?: number;
    name?: string;
  },
) {
  const id = crypto.randomUUID();
  createdCharacterIds.push(id);
  const now = new Date().toISOString();
  const name = options.name ?? `Offspec${createdCharacterIds.length}`;
  const realm = "Offspec Lab";
  await orm.Character.create({
    id,
    userId,
    name,
    realm,
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity(realm),
    region: "EU",
    wowClass: "SHAMAN",
    specialization: options.specialization,
    primaryRole: options.primaryRole,
    itemLevel: options.itemLevel ?? 325,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  for (const specialization of options.playableSpecs ?? []) {
    await orm.CharacterPlayableSpec.create({
      id: crypto.randomUUID(),
      characterId: id,
      specialization,
      createdAt: now,
    });
  }
  return id;
}

async function cleanupRun(runId: string) {
  const roster = await orm.RunRoster.where({ runId }).first();
  if (roster) {
    const rosterId = (roster as { id: string }).id;
    for (const entry of await orm.RunRosterEntry.where({ rosterId }).all()) {
      await orm.RunRosterEntry.where({ id: (entry as { id: string }).id }).delete();
    }
    await orm.RunRoster.where({ id: rosterId }).delete();
  }
  for (const row of await orm.RunSignup.where({ runId }).select("id").all()) {
    const signupId = (row as { id: string }).id;
    for (const offer of await orm.RunSignupRole.where({ signupId }).select("id").all()) {
      await orm.RunSignupRole.where({ id: (offer as { id: string }).id }).delete();
    }
    await orm.RunSignup.where({ id: signupId }).delete();
  }
  await orm.Run.where({ id: runId }).delete();
}

function allBoosters(view: Awaited<ReturnType<typeof rosterService.getRosterManagementView>>) {
  return view.boosters;
}

describe("roster playable spec display (data + semantics)", () => {
  const lead = asUser(ids.lead, "Raid Lead", "RAID_LEAD");
  const booster = asUser(ids.booster, "Resto Booster");

  beforeAll(async () => {
    await raidRepository.ensureReferenceRaids();
    await createTestUser(ids.lead, "Raid Lead", "RAID_LEAD");
    await createTestUser(ids.booster, "Resto Booster", "USER");
    await orm.User.where({ id: ids.booster }).update({ isBooster: true });
  }, 60_000);

  afterAll(async () => {
    for (const runId of [...createdRunIds].reverse()) {
      await cleanupRun(runId);
    }
    for (const characterId of createdCharacterIds) {
      await orm.CharacterPlayableSpec.where({ characterId }).delete();
      await orm.Character.where({ id: characterId }).delete();
    }
    for (const userId of createdUserIds) {
      await orm.User.where({ id: userId }).delete();
    }
  });

  it("5–6. exposes offspec names without widening offeredRoles (HEALER + RANGED only)", async () => {
    const characterId = await createCharacter(ids.booster, {
      specialization: "Restoration",
      primaryRole: "HEALER",
      playableSpecs: ["Elemental", "Enhancement"],
    });
    const run = await runService.createRun(lead, venomousCreateInput({ scheduledStartAt: futureTestIso() }));
    createdRunIds.push(run.id);
    await runService.openRun(lead, run.id);

    await signupService.setCharacterOffers(booster, {
      runId: run.id,
      offers: [{ characterId, offeredRoles: ["HEALER", "RANGED_DPS"] }],
    });
    const viewAfterSignup = await rosterService.getRosterManagementView(lead, run.id);
    const signup = allBoosters(viewAfterSignup).find((item) => item.character?.id === characterId)!;
    createdSignupIds.push(signup.id);

    const view = await rosterService.getRosterManagementView(lead, run.id);
    const row = allBoosters(view).find((item) => item.id === signup.id)!;
    expect(row.offeredRoles).toEqual(["HEALER", "RANGED_DPS"]);
    expect(row.character?.playableSpecs).toEqual(["Elemental", "Enhancement"]);
    expect(formatCharacterRosterMetadata(row.character!)).toBe(
      "325 ilvl · Restoration · Offspecs: Elemental, Enhancement",
    );
    expect(row.offeredRoles.includes("MELEE_DPS")).toBe(false);
    expect(row.offeredRoles.filter(isConcreteCharacterRole)).not.toContain("MELEE_DPS");
  });

  it("7. legacy DPS signup stays legacy despite Character offspec configuration", async () => {
    const characterId = await createCharacter(ids.booster, {
      specialization: "Restoration",
      primaryRole: "HEALER",
      playableSpecs: ["Elemental"],
    });
    const run = await runService.createRun(lead, venomousCreateInput({ scheduledStartAt: futureTestIso() }));
    createdRunIds.push(run.id);
    await runService.openRun(lead, run.id);

    const now = new Date().toISOString();
    const signupId = crypto.randomUUID();
    createdSignupIds.push(signupId);
    await orm.RunSignup.create({
      id: signupId,
      runId: run.id,
      userId: ids.booster,
      characterId,
      participationType: "BOOSTER",
      isBackup: false,
      status: "PENDING",
      publishedRole: null,
      lootbuddyMode: null,
      lootbuddyVerification: null,
      createdAt: now,
      updatedAt: now,
    });
    await orm.RunSignupRole.create({
      id: crypto.randomUUID(),
      signupId,
      role: "DPS",
      createdAt: now,
    });

    const view = await rosterService.getRosterManagementView(lead, run.id);
    const row = allBoosters(view).find((item) => item.id === signupId)!;
    expect(row.offeredRoles).toEqual(["DPS"]);
    expect(formatCharacterRosterMetadata(row.character!)).toContain("Offspec: Elemental");
  });

  it("8. roster bucket counts ignore Character offspecs — only offered/assigned roles", async () => {
    const characterId = await createCharacter(ids.booster, {
      specialization: "Restoration",
      primaryRole: "HEALER",
      playableSpecs: ["Elemental", "Enhancement"],
    });
    const run = await runService.createRun(lead, venomousCreateInput({ scheduledStartAt: futureTestIso() }));
    createdRunIds.push(run.id);
    await runService.openRun(lead, run.id);

    await signupService.setCharacterOffers(booster, {
      runId: run.id,
      offers: [{ characterId, offeredRoles: ["HEALER", "RANGED_DPS"] }],
    });

    const view = await rosterService.getRosterManagementView(lead, run.id);
    const row = allBoosters(view).find((item) => item.character?.id === characterId)!;
    const buckets = countRolesByBucket(row.offeredRoles);
    expect(buckets.healers).toBe(1);
    expect(buckets.rangedDps).toBe(1);
    expect(buckets.meleeDps).toBe(0);
    expect(buckets.legacyDps).toBe(0);
  });
});
