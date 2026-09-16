import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { venomousCreateInput } from "@/lib/test-run-input";
import { orm } from "@/lib/prisma";
import { CROSS_RUN_RESERVATION_MIN_GAP_MS } from "@/repositories/signup.repository";
import { boosterQualificationService } from "@/services/booster-qualification.service";
import { characterAvailabilityService } from "@/services/character-availability.service";
import { characterService } from "@/services/character.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";

const ids = {
  owner: "aaaaaaaa-aaaa-4aaa-8aaa-avx000000001",
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-avx000000002",
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-avx000000003",
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
    email: `${id}@avx.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function expectDomainCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected domain error ${code}`);
  } catch (error) {
    expect(isDomainError(error) && error.code).toBe(code);
  }
}

async function ensureUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]) {
  await orm.User.create({
    id,
    name,
    email: `${id}@avx.boostting.local`,
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

beforeAll(async () => {
  await ensureUser(ids.owner, "Availability Interaction Owner", "USER");
  await ensureUser(ids.lead, "Availability Interaction Lead", "RAID_LEAD");
  await ensureUser(ids.admin, "Availability Interaction Admin", "ADMIN");
});

afterAll(async () => {
  for (const id of createdBlockIds) {
    await orm.CharacterAvailabilityBlock.where({ id }).delete().catch(() => {});
  }
  for (const runId of createdRunIds) {
    await orm.RunSignup.where({ runId }).delete().catch(() => {});
    await orm.RunRaidContent.where({ runId }).delete().catch(() => {});
    await orm.Run.where({ id: runId }).delete().catch(() => {});
  }
  for (const id of createdCharacterIds) {
    await orm.CharacterAvailabilityBlock.where({ characterId: id }).delete().catch(() => {});
    await orm.Character.where({ id }).delete().catch(() => {});
  }
  await orm.BoosterQualification.where({ userId: ids.owner }).delete().catch(() => {});
});

describe("manual availability × BoostingHub reservation", () => {
  const owner = asUser(ids.owner, "Availability Interaction Owner");
  const lead = asUser(ids.lead, "Availability Interaction Lead", "RAID_LEAD");
  const admin = asUser(ids.admin, "Availability Interaction Admin", "ADMIN");

  it("keeps the 2h reservation constant and blocks signup only inside a manual interval", async () => {
    expect(CROSS_RUN_RESERVATION_MIN_GAP_MS).toBe(2 * 60 * 60 * 1000);

    const character = await characterService.createCharacter(owner, {
      name: "Avxblock",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "SHAMAN",
      specialization: "Restoration",
      itemLevel: 640,
    });
    createdCharacterIds.push(character.id);
    await boosterQualificationService.grant(admin, { userId: ids.owner, difficulty: "HEROIC" });

    const block = await characterAvailabilityService.createBlock(owner, character.id, {
      startsAt: "2026-10-02T16:00:00.000Z",
      endsAt: "2026-10-02T19:00:00.000Z",
      reason: "External boost",
    });
    createdBlockIds.push(block.id);

    const inside = await runService.createRun(
      lead,
      venomousCreateInput({ scheduledStartAt: "2026-10-02T17:30:00.000Z" }),
    );
    createdRunIds.push(inside.id);
    await runService.openRun(lead, inside.id);

    const optionsInside = await signupService.getSignupOptions(owner, inside.id);
    const blocked = optionsInside.booster.ineligible.find((row) => row.characterId === character.id);
    expect(blocked?.reason).toBe("MANUALLY_UNAVAILABLE");
    expect(blocked?.message).toContain("External boost");
    expect(optionsInside.booster.eligible.some((row) => row.characterId === character.id)).toBe(false);

    await expectDomainCode(
      signupService.createBoosterSignup(owner, {
        runId: inside.id,
        characterId: character.id,
        role: "HEALER",
        isBackup: false,
      }),
      "CHARACTER_MANUALLY_UNAVAILABLE",
    );

    // Half-open: Run exactly at endsAt is allowed — manual blocks do NOT inherit ±2h padding.
    const atEnd = await runService.createRun(
      lead,
      venomousCreateInput({ scheduledStartAt: "2026-10-02T19:00:00.000Z" }),
    );
    createdRunIds.push(atEnd.id);
    await runService.openRun(lead, atEnd.id);

    const optionsAtEnd = await signupService.getSignupOptions(owner, atEnd.id);
    expect(optionsAtEnd.booster.eligible.some((row) => row.characterId === character.id)).toBe(true);
  });

  it("leaves a sibling Character free when only one Character has a block", async () => {
    const blocked = await characterService.createCharacter(owner, {
      name: "Avxone",
      realm: "Draenor",
      region: "EU",
      wowClass: "MAGE",
      specialization: "Frost",
      itemLevel: 600,
    });
    const free = await characterService.createCharacter(owner, {
      name: "Avxtwo",
      realm: "Draenor",
      region: "EU",
      wowClass: "WARLOCK",
      specialization: "Affliction",
      itemLevel: 601,
    });
    createdCharacterIds.push(blocked.id, free.id);
    await boosterQualificationService.grant(admin, { userId: ids.owner, difficulty: "HEROIC" }).catch(() => {});

    const block = await characterAvailabilityService.createBlock(owner, blocked.id, {
      startsAt: "2026-10-03T16:00:00.000Z",
      endsAt: "2026-10-03T20:00:00.000Z",
      reason: "External boost",
    });
    createdBlockIds.push(block.id);

    const run = await runService.createRun(
      lead,
      venomousCreateInput({ scheduledStartAt: "2026-10-03T18:00:00.000Z" }),
    );
    createdRunIds.push(run.id);
    await runService.openRun(lead, run.id);

    const options = await signupService.getSignupOptions(owner, run.id);
    expect(options.booster.ineligible.find((row) => row.characterId === blocked.id)?.reason).toBe(
      "MANUALLY_UNAVAILABLE",
    );
    expect(options.booster.eligible.some((row) => row.characterId === free.id)).toBe(true);
  });
});
