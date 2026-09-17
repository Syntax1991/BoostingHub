import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { characterAvailabilityService } from "@/services/character-availability.service";
import { characterService } from "@/services/character.service";

const ids = {
  owner: "aaaaaaaa-aaaa-4aaa-8aaa-av0000000001",
  other: "aaaaaaaa-aaaa-4aaa-8aaa-av0000000002",
};

const createdCharacterIds: string[] = [];
const createdBlockIds: string[] = [];

function asUser(id: string, name: string): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@avtest.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole: "USER",
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

async function createTestUser(id: string, name: string) {
  await orm.User.create({
    id,
    name,
    email: `${id}@avtest.boostting.local`,
    emailVerified: false,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).catch(() => {});
}

beforeAll(async () => {
  await createTestUser(ids.owner, "Availability Owner");
  await createTestUser(ids.other, "Availability Other");
});

afterAll(async () => {
  for (const id of createdBlockIds) {
    await orm.CharacterAvailabilityBlock.where({ id }).delete().catch(() => {});
  }
  for (const id of createdCharacterIds) {
    await orm.CharacterAvailabilityBlock.where({ characterId: id }).delete().catch(() => {});
    await orm.Character.where({ id }).delete().catch(() => {});
  }
});

describe("characterAvailabilityService", () => {
  const owner = asUser(ids.owner, "Availability Owner");
  const other = asUser(ids.other, "Availability Other");

  it("creates, lists, updates, and deletes ownership-scoped blocks", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Availone",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "MAGE",
      specialization: "Frost",
      itemLevel: 600,
    });
    createdCharacterIds.push(character.id);

    const created = await characterAvailabilityService.createBlock(owner, character.id, {
      startsAt: "2026-09-18T17:00:00.000Z",
      endsAt: "2026-09-18T20:00:00.000Z",
      reason: "External boost",
    });
    createdBlockIds.push(created.id);
    expect(created.reason).toBe("External boost");
    expect(created.label).toContain("External boost");

    const listed = await characterAvailabilityService.listForCharacter(owner, character.id);
    expect(listed.upcoming.some((row) => row.id === created.id)).toBe(true);

    const updated = await characterAvailabilityService.updateBlock(owner, created.id, {
      startsAt: "2026-09-18T18:00:00.000Z",
      endsAt: "2026-09-18T21:00:00.000Z",
      reason: "Unavailable",
    });
    expect(new Date(updated.startsAt).toISOString()).toBe("2026-09-18T18:00:00.000Z");
    expect(updated.reason).toBe("Unavailable");

    await expectDomainCode(
      characterAvailabilityService.createBlock(other, character.id, {
        startsAt: "2026-09-19T17:00:00.000Z",
        endsAt: "2026-09-19T20:00:00.000Z",
      }),
      "CHARACTER_NOT_OWNED",
    );

    await characterAvailabilityService.deleteBlock(owner, created.id);
    createdBlockIds.splice(createdBlockIds.indexOf(created.id), 1);
    const after = await characterAvailabilityService.listForCharacter(owner, character.id);
    expect(after.upcoming).toHaveLength(0);
  });

  it("rejects end <= start and allows optional reason / overlapping blocks", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Availtwo",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "WARRIOR",
      specialization: "Arms",
      itemLevel: 601,
    });
    createdCharacterIds.push(character.id);

    await expectDomainCode(
      characterAvailabilityService.createBlock(owner, character.id, {
        startsAt: "2026-09-18T20:00:00.000Z",
        endsAt: "2026-09-18T20:00:00.000Z",
      }),
      "VALIDATION_FAILED",
    );

    const a = await characterAvailabilityService.createBlock(owner, character.id, {
      startsAt: "2026-09-18T16:00:00.000Z",
      endsAt: "2026-09-18T19:00:00.000Z",
    });
    const b = await characterAvailabilityService.createBlock(owner, character.id, {
      startsAt: "2026-09-18T17:00:00.000Z",
      endsAt: "2026-09-18T20:00:00.000Z",
      reason: null,
    });
    createdBlockIds.push(a.id, b.id);
    expect(a.reason).toBeNull();
    expect(b.reason).toBeNull();

    const listed = await characterAvailabilityService.listForCharacter(owner, character.id);
    expect(listed.upcoming).toHaveLength(2);
  });

  it("keeps past blocks in history without treating them as upcoming", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Availpast",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "PRIEST",
      specialization: "Holy",
      itemLevel: 602,
    });
    createdCharacterIds.push(character.id);

    const past = await characterAvailabilityService.createBlock(owner, character.id, {
      startsAt: "2020-01-01T10:00:00.000Z",
      endsAt: "2020-01-01T12:00:00.000Z",
      reason: "Old external boost",
    });
    createdBlockIds.push(past.id);

    const listed = await characterAvailabilityService.listForCharacter(owner, character.id);
    expect(listed.upcoming).toHaveLength(0);
    expect(listed.past.some((row) => row.id === past.id)).toBe(true);
  });

  it("batches current/upcoming external plans for /characters without mixing Characters", async () => {
    const characterA = await characterService.createCharacter(owner, {
      name: "Availbatcha",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "HUNTER",
      specialization: "Beast Mastery",
      itemLevel: 603,
    });
    const characterB = await characterService.createCharacter(owner, {
      name: "Availbatchb",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "ROGUE",
      specialization: "Assassination",
      itemLevel: 604,
    });
    createdCharacterIds.push(characterA.id, characterB.id);

    const friday = await characterAvailabilityService.createBlock(owner, characterA.id, {
      startsAt: "2026-09-18T20:00:00.000Z",
      endsAt: "2026-09-18T21:30:00.000Z",
      reason: "Phoenix",
    });
    const saturday = await characterAvailabilityService.createBlock(owner, characterA.id, {
      startsAt: "2026-09-19T14:00:00.000Z",
      endsAt: "2026-09-19T15:30:00.000Z",
      reason: "Apex",
    });
    const past = await characterAvailabilityService.createBlock(owner, characterA.id, {
      startsAt: "2020-02-01T10:00:00.000Z",
      endsAt: "2020-02-01T12:00:00.000Z",
      reason: "Expired",
    });
    createdBlockIds.push(friday.id, saturday.id, past.id);

    const now = "2026-09-17T12:00:00.000Z";
    const byCharacter = await characterAvailabilityService.listCurrentOrUpcomingByCharacterIds(
      [characterA.id, characterB.id],
      now,
    );

    expect(byCharacter.get(characterA.id)?.map((row) => row.reason)).toEqual(["Phoenix", "Apex"]);
    expect(byCharacter.get(characterB.id)).toEqual([]);
    expect(byCharacter.get(characterA.id)?.some((row) => row.reason === "Expired")).toBe(false);

    const page = await characterService.getCharacterPage(owner);
    const rowA = page.characters.find((row) => row.id === characterA.id);
    const rowB = page.characters.find((row) => row.id === characterB.id);
    expect(rowA?.externalCommitments.map((row) => row.reason)).toEqual(["Phoenix", "Apex"]);
    expect(rowB?.externalCommitments).toEqual([]);
  });

  it("rejects foreign update and delete of another user's external plan", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Availown",
      realm: "Twisting Nether",
      region: "EU",
      wowClass: "DRUID",
      specialization: "Balance",
      itemLevel: 605,
    });
    createdCharacterIds.push(character.id);

    const block = await characterAvailabilityService.createBlock(owner, character.id, {
      startsAt: "2026-09-20T16:00:00.000Z",
      endsAt: "2026-09-20T17:30:00.000Z",
      reason: "Phoenix",
    });
    createdBlockIds.push(block.id);

    await expectDomainCode(
      characterAvailabilityService.updateBlock(other, block.id, {
        startsAt: "2026-09-20T17:00:00.000Z",
        endsAt: "2026-09-20T18:00:00.000Z",
        reason: "Hacked",
      }),
      "CHARACTER_NOT_OWNED",
    );
    await expectDomainCode(
      characterAvailabilityService.deleteBlock(other, block.id),
      "CHARACTER_NOT_OWNED",
    );

    const listed = await characterAvailabilityService.listForCharacter(owner, character.id);
    expect(listed.upcoming.some((row) => row.id === block.id && row.reason === "Phoenix")).toBe(
      true,
    );
  });
});
