import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import type { CharacterRole, WowClass } from "@/models/enums";
import {
  characterRepository,
  type CharacterUpdateInput,
} from "@/repositories/character.repository";

/**
 * Regression: `Collection.delete()` removes only the FIRST matching row. The
 * replace-all helpers (playable specs, offspec roles) and the WCL performance
 * reset filter by characterId alone, so with two or more existing rows they
 * left rows behind — and re-saving an unchanged set hit the
 * (characterId, specialization) / (characterId, role) unique constraint.
 */

const ids = {
  owner: "dddddddd-dddd-4ddd-8ddd-ce0000000001",
  specs: "dddddddd-dddd-4ddd-8ddd-ce0000000002",
  wclTarget: "dddddddd-dddd-4ddd-8ddd-ce0000000003",
  wclControl: "dddddddd-dddd-4ddd-8ddd-ce0000000004",
  roles: "dddddddd-dddd-4ddd-8ddd-ce0000000005",
};
const characterIds = [ids.specs, ids.roles, ids.wclTarget, ids.wclControl];

const REALM = "Multi Delete Lab";

async function cleanup() {
  // Character deletion cascades to specs, offspec roles and WCL performance.
  for (const id of characterIds) {
    await orm.Character.where({ id })
      .delete()
      .catch(() => {});
  }
  await orm.User.where({ id: ids.owner })
    .delete()
    .catch(() => {});
}

async function createCharacter(
  id: string,
  name: string,
  wowClass: WowClass,
  specialization: string,
  primaryRole: CharacterRole,
  extra: { playableSpecs?: string[]; offspecRoles?: CharacterRole[] } = {},
) {
  await characterRepository.create({
    id,
    userId: ids.owner,
    name,
    realm: REALM,
    region: "EU",
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity(REALM),
    wowClass,
    specialization,
    primaryRole,
    itemLevel: 700,
    isActive: true,
    ...extra,
  });
}

function paladinUpdate(
  name: string,
  playableSpecs: string[],
  offspecRoles: CharacterRole[],
): CharacterUpdateInput {
  return {
    name,
    realm: REALM,
    region: "EU",
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity(REALM),
    specialization: "Retribution",
    primaryRole: "MELEE_DPS",
    playableSpecs,
    offspecRoles,
  };
}

async function storedSpecs(characterId: string) {
  const rows = (await orm.CharacterPlayableSpec.where({ characterId }).all()) as Array<{
    specialization: string;
  }>;
  return rows.map((row) => row.specialization).sort();
}

async function storedOffspecRoles(characterId: string) {
  const rows = (await orm.CharacterOffspecRole.where({ characterId }).all()) as Array<{
    role: string;
  }>;
  return rows.map((row) => row.role).sort();
}

async function createWclRow(characterId: string, metricKey: string) {
  const now = new Date().toISOString();
  await orm.CharacterWclPerformance.create({
    id: crypto.randomUUID(),
    characterId,
    zoneId: 99,
    encounterId: 0,
    difficulty: 4,
    metricKey,
    bestPct: 90,
    avgPct: 80,
    fetchedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

beforeAll(async () => {
  await cleanup();
  const now = new Date().toISOString();
  await orm.User.create({
    id: ids.owner,
    name: "Multi Delete Owner",
    email: `${ids.owner}@multidelete.boostting.local`,
    emailVerified: true,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
}, 60_000);

afterAll(async () => {
  await cleanup();
}, 60_000);

describe("characterRepository replace-all helpers", () => {
  it("replaces several playable specs, also when re-saving the same set", async () => {
    await createCharacter(ids.specs, "Mdspecs", "PALADIN", "Retribution", "MELEE_DPS", {
      playableSpecs: ["Holy", "Protection"],
    });
    expect(await storedSpecs(ids.specs)).toEqual(["Holy", "Protection"]);

    // Unchanged re-save: every existing row must go before the re-create.
    await characterRepository.update(
      ids.specs,
      paladinUpdate("Mdspecs", ["Holy", "Protection"], []),
    );
    await characterRepository.update(
      ids.specs,
      paladinUpdate("Mdspecs", ["Holy", "Protection"], []),
    );
    expect(await storedSpecs(ids.specs)).toEqual(["Holy", "Protection"]);

    // Shrinking the set leaves no stale rows behind.
    await characterRepository.update(ids.specs, paladinUpdate("Mdspecs", ["Protection"], []));
    expect(await storedSpecs(ids.specs)).toEqual(["Protection"]);
    await characterRepository.update(ids.specs, paladinUpdate("Mdspecs", [], []));
    expect(await storedSpecs(ids.specs)).toEqual([]);
  });

  it("replaces several offspec roles, also when re-saving the same set", async () => {
    await createCharacter(ids.roles, "Mdroles", "PALADIN", "Retribution", "MELEE_DPS", {
      offspecRoles: ["TANK", "HEALER"],
    });
    expect(await storedOffspecRoles(ids.roles)).toEqual(["HEALER", "TANK"]);

    await characterRepository.update(ids.roles, paladinUpdate("Mdroles", [], ["TANK", "HEALER"]));
    await characterRepository.update(ids.roles, paladinUpdate("Mdroles", [], ["TANK", "HEALER"]));
    expect(await storedOffspecRoles(ids.roles)).toEqual(["HEALER", "TANK"]);

    await characterRepository.update(ids.roles, paladinUpdate("Mdroles", [], ["HEALER"]));
    expect(await storedOffspecRoles(ids.roles)).toEqual(["HEALER"]);
    await characterRepository.update(ids.roles, paladinUpdate("Mdroles", [], []));
    expect(await storedOffspecRoles(ids.roles)).toEqual([]);
  });
});

describe("characterRepository.repairBlizzardIdentity", () => {
  it("drops every cached WCL performance row of the Character and nothing else", async () => {
    await createCharacter(ids.wclTarget, "Mdwcltarget", "MAGE", "Fire", "RANGED_DPS");
    await createCharacter(ids.wclControl, "Mdwclcontrol", "MAGE", "Frost", "RANGED_DPS");
    for (const metricKey of ["dps", "dps:Fire", "dps:Frost"]) {
      await createWclRow(ids.wclTarget, metricKey);
    }
    await createWclRow(ids.wclControl, "dps");

    await characterRepository.repairBlizzardIdentity(ids.wclTarget, {
      name: "Mdwcltarget",
      realm: REALM,
      normalizedName: normalizeCharacterIdentity("Mdwcltarget"),
      normalizedRealm: normalizeCharacterIdentity(REALM),
      blizzardCharacterId: `md-${crypto.randomUUID()}`,
      blizzardRealmId: `md-${crypto.randomUUID()}`,
    });

    expect(
      await orm.CharacterWclPerformance.where({ characterId: ids.wclTarget }).all(),
    ).toHaveLength(0);
    expect(
      await orm.CharacterWclPerformance.where({ characterId: ids.wclControl }).all(),
    ).toHaveLength(1);
  });
});
