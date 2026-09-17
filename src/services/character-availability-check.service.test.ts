import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { characterAvailabilityRepository } from "@/repositories/character-availability.repository";
import { CROSS_RUN_RESERVATION_MIN_GAP_MS } from "@/repositories/signup.repository";
import { boosterQualificationService } from "@/services/booster-qualification.service";
import { characterAvailabilityCheckService } from "@/services/character-availability-check.service";
import { characterService } from "@/services/character.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";

const ids = {
  owner: "cccccccc-cccc-4ccc-8ccc-cac000000001",
  lead: "cccccccc-cccc-4ccc-8ccc-cac000000002",
  admin: "cccccccc-cccc-4ccc-8ccc-cac000000003",
};

const createdCharacterIds: string[] = [];
const createdBlockIds: string[] = [];
const createdRunIds: string[] = [];

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@cac.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function ensureUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]) {
  await orm.User.create({
    id,
    name,
    email: `${id}@cac.boostting.local`,
    emailVerified: false,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).catch(() => {});
}

async function createOpenRun(lead: AuthenticatedUser, scheduledStartAt: string) {
  const run = await runService.createRun(
    lead,
    venomousCreateInput({
      scheduledStartAt,
      desiredTankCount: 0,
      desiredHealerCount: 1,
      desiredDpsCount: 1,
    }),
  );
  createdRunIds.push(run.id);
  await runService.openRun(lead, run.id);
  return run;
}

async function cleanupRun(runId: string) {
  const roster = await orm.RunRoster.where({ runId }).first();
  if (roster) {
    const rosterId = (roster as { id: string }).id;
    await orm.RunRosterEntry.where({ rosterId }).delete().catch(() => {});
    await orm.RunRoster.where({ id: rosterId }).delete().catch(() => {});
  }
  const signups = (await orm.RunSignup.where({ runId }).all()) as Array<{ id: string }>;
  for (const signup of signups) {
    await orm.RunSignupRole.where({ signupId: signup.id }).delete().catch(() => {});
  }
  await orm.RunSignup.where({ runId }).delete().catch(() => {});
  await orm.RunRaidContent.where({ runId }).delete().catch(() => {});
  await orm.Run.where({ id: runId }).delete().catch(() => {});
}

beforeAll(async () => {
  await ensureUser(ids.owner, "CAC Owner", "USER");
  await ensureUser(ids.lead, "CAC Lead", "RAID_LEAD");
  await ensureUser(ids.admin, "CAC Admin", "ADMIN");
});

afterAll(async () => {
  for (const id of createdBlockIds) {
    await orm.CharacterAvailabilityBlock.where({ id }).delete().catch(() => {});
  }
  for (const runId of createdRunIds) {
    await cleanupRun(runId);
  }
  for (const id of createdCharacterIds) {
    await orm.CharacterAvailabilityBlock.where({ characterId: id }).delete().catch(() => {});
    await orm.Character.where({ id }).delete().catch(() => {});
  }
  await orm.BoosterQualification.where({ userId: ids.owner }).delete().catch(() => {});
});

describe("characterAvailabilityCheckService", () => {
  const owner = asUser(ids.owner, "CAC Owner");
  const lead = asUser(ids.lead, "CAC Lead", "RAID_LEAD");
  const admin = asUser(ids.admin, "CAC Admin", "ADMIN");

  it("marks AVAILABLE with no reservation and ignores deprecated manual blocks", async () => {
    await boosterQualificationService.grant(admin, { userId: ids.owner, difficulty: "HEROIC" }).catch(() => {});
    const character = await characterService.createCharacter(owner, {
      name: "Availfree",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 700,
    });
    createdCharacterIds.push(character.id);

    const checkAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const block = await characterAvailabilityRepository.create({
      characterId: character.id,
      startsAt: new Date(Date.parse(checkAt) - 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.parse(checkAt) + 60 * 60 * 1000).toISOString(),
      reason: "Legacy external",
    });
    createdBlockIds.push(block.id);

    const result = await characterAvailabilityCheckService.checkOwnerCharacters(owner, checkAt);
    expect(result.characters.find((row) => row.characterId === character.id)).toMatchObject({
      status: "AVAILABLE_IN_BOOSTINGHUB",
      conflicts: [],
    });
  });

  it("marks COMMITTED for draft-selected and published SELECTED within <2h", async () => {
    await boosterQualificationService.grant(admin, { userId: ids.owner, difficulty: "HEROIC" }).catch(() => {});
    const character = await characterService.createCharacter(owner, {
      name: "Availbook",
      realm: "Kazzak",
      region: "EU",
      wowClass: "PRIEST",
      specialization: "Holy",
      itemLevel: 700,
    });
    createdCharacterIds.push(character.id);

    const reservedStart = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    const run = await createOpenRun(lead, reservedStart.toISOString());
    const signup = await signupService.createBoosterSignup(owner, {
      runId: run.id,
      characterId: character.id,
      role: "HEALER",
      isBackup: false,
    });

    // PENDING alone does not reserve
    let check = await characterAvailabilityCheckService.checkOwnerCharacters(
      owner,
      new Date(reservedStart.getTime() + 30 * 60 * 1000).toISOString(),
    );
    expect(check.characters.find((row) => row.characterId === character.id)?.status).toBe(
      "AVAILABLE_IN_BOOSTINGHUB",
    );

    await rosterService.saveDraftSelection(lead, {
      runId: run.id,
      version: (await rosterService.getRosterManagementView(lead, run.id)).roster.version,
      selections: [{ signupId: signup.id, selectedRole: "HEALER" }],
    });

    check = await characterAvailabilityCheckService.checkOwnerCharacters(
      owner,
      new Date(reservedStart.getTime() + 30 * 60 * 1000).toISOString(),
    );
    expect(check.characters.find((row) => row.characterId === character.id)?.status).toBe("COMMITTED");

    await rosterService.publishRoster(lead, {
      runId: run.id,
      version: (await rosterService.getRosterManagementView(lead, run.id)).roster.version,
      acknowledgeWarnings: true,
    });

    check = await characterAvailabilityCheckService.checkOwnerCharacters(
      owner,
      new Date(reservedStart.getTime() + 30 * 60 * 1000).toISOString(),
    );
    expect(check.characters.find((row) => row.characterId === character.id)?.status).toBe("COMMITTED");
  });

  it("respects exact 2h boundary before and after a reservation", async () => {
    await boosterQualificationService.grant(admin, { userId: ids.owner, difficulty: "HEROIC" }).catch(() => {});
    const character = await characterService.createCharacter(owner, {
      name: "Availbound",
      realm: "Silvermoon",
      region: "EU",
      wowClass: "MAGE",
      specialization: "Frost",
      itemLevel: 700,
    });
    createdCharacterIds.push(character.id);

    const reservedStart = Date.parse("2030-01-15T21:00:00.000Z");
    const run = await createOpenRun(lead, new Date(reservedStart).toISOString());
    const signup = await signupService.createBoosterSignup(owner, {
      runId: run.id,
      characterId: character.id,
      role: "DPS",
      isBackup: false,
    });
    await rosterService.saveDraftSelection(lead, {
      runId: run.id,
      version: (await rosterService.getRosterManagementView(lead, run.id)).roster.version,
      selections: [{ signupId: signup.id, selectedRole: "DPS" }],
    });

    const gap = CROSS_RUN_RESERVATION_MIN_GAP_MS;
    const cases: Array<{ at: number; expected: "AVAILABLE_IN_BOOSTINGHUB" | "COMMITTED" }> = [
      { at: reservedStart - gap - 60_000, expected: "AVAILABLE_IN_BOOSTINGHUB" },
      { at: reservedStart - gap, expected: "AVAILABLE_IN_BOOSTINGHUB" },
      { at: reservedStart - gap + 60_000, expected: "COMMITTED" },
      { at: reservedStart - 60_000, expected: "COMMITTED" },
      { at: reservedStart, expected: "COMMITTED" },
      { at: reservedStart + 60_000, expected: "COMMITTED" },
      { at: reservedStart + gap - 60_000, expected: "COMMITTED" },
      { at: reservedStart + gap, expected: "AVAILABLE_IN_BOOSTINGHUB" },
    ];

    for (const row of cases) {
      const result = await characterAvailabilityCheckService.checkOwnerCharacters(
        owner,
        new Date(row.at).toISOString(),
      );
      expect(
        result.characters.find((item) => item.characterId === character.id)?.status,
        `at ${new Date(row.at).toISOString()}`,
      ).toBe(row.expected);
    }
  });

  it("keeps Character scoping and marks inactive Characters INACTIVE", async () => {
    await boosterQualificationService.grant(admin, { userId: ids.owner, difficulty: "HEROIC" }).catch(() => {});
    const synlight = await characterService.createCharacter(owner, {
      name: "Synlightchk",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 700,
    });
    const synmist = await characterService.createCharacter(owner, {
      name: "Synmistchk",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "MAGE",
      specialization: "Arcane",
      itemLevel: 700,
    });
    createdCharacterIds.push(synlight.id, synmist.id);

    const reservedStart = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
    const run = await createOpenRun(lead, reservedStart.toISOString());
    const signup = await signupService.createBoosterSignup(owner, {
      runId: run.id,
      characterId: synlight.id,
      role: "HEALER",
      isBackup: false,
    });
    await rosterService.saveDraftSelection(lead, {
      runId: run.id,
      version: (await rosterService.getRosterManagementView(lead, run.id)).roster.version,
      selections: [{ signupId: signup.id, selectedRole: "HEALER" }],
    });

    await characterService.deactivateCharacter(owner, synmist.id);

    const check = await characterAvailabilityCheckService.checkOwnerCharacters(
      owner,
      new Date(reservedStart.getTime() + 30 * 60 * 1000).toISOString(),
    );
    expect(check.characters.find((row) => row.characterId === synlight.id)?.status).toBe("COMMITTED");
    expect(check.characters.find((row) => row.characterId === synmist.id)?.status).toBe("INACTIVE");
  });
});
