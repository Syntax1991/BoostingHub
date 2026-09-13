import { afterAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { signupRepository } from "@/repositories/signup.repository";
import { signupService } from "@/services/signup.service";

const ids = {
  kael: "11111111-1111-4111-8111-111111111111",
  mira: "22222222-2222-4222-8222-222222222222",
  brann: "55555555-5555-4555-8555-555555555555",
  kaelResto: "c1111111-1111-4111-8111-111111111111",
  kaelEle: "c1111111-1111-4111-8111-111111111112",
  miraPriest: "c2222222-2222-4222-8222-222222222221",
  brannPaladin: "c5555555-5555-4555-8555-555555555551",
  brannHoly: "c5555555-5555-4555-8555-555555555552",
  weekend: "r7777777-7777-4777-8777-777777777777",
  draft: "r6666666-6666-4666-8666-666666666666",
  normal: "r4444444-4444-4444-8444-444444444444",
  published: "r5555555-5555-4555-8555-555555555555",
};

const createdIds: string[] = [];

function asUser(id: string, name: string): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@dev.boostting.local`,
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

afterAll(async () => {
  for (const id of createdIds) {
    await orm.RunSignup.where({ id }).delete();
  }
});

describe("signupService create/withdraw", () => {
  const kael = asUser(ids.kael, "Kael Stormhowl");
  const mira = asUser(ids.mira, "Mira Dawnward");
  const brann = asUser(ids.brann, "Brann Emberforge");

  it("creates a booster signup and a backup signup for different characters", async () => {
    const primary = await signupService.createBoosterSignup(kael, {
      runId: ids.weekend,
      characterId: ids.kaelEle,
      role: "DPS",
      isBackup: false,
    });
    createdIds.push(primary.id);
    expect(primary.revived).toBe(false);

    const stored = await signupRepository.findById(primary.id);
    expect(stored?.status).toBe("PENDING");
    expect(stored?.isBackup).toBe(false);
    expect(stored?.participationType).toBe("BOOSTER");

    const backup = await signupService.createBoosterSignup(kael, {
      runId: ids.weekend,
      characterId: ids.kaelResto,
      role: "HEALER",
      isBackup: true,
    });
    createdIds.push(backup.id);
    const backupRow = await signupRepository.findById(backup.id);
    expect(backupRow?.isBackup).toBe(true);
    expect(backupRow?.character?.id).toBe(ids.kaelResto);
  });

  it("rejects an exact duplicate booster combination", async () => {
    await expectDomainCode(
      signupService.createBoosterSignup(kael, {
        runId: ids.weekend,
        characterId: ids.kaelEle,
        role: "DPS",
        isBackup: false,
      }),
      "DUPLICATE_SIGNUP",
    );
  });

  it("creates loot-only and playing lootbuddy signups with verification metadata", async () => {
    const result = await signupService.setLootbuddies(mira, {
      runId: ids.normal,
      lootbuddies: [
        { wowClass: "PRIEST", mode: "LOOT_ONLY", verification: "ACCESS" },
        { wowClass: "MAGE", mode: "PLAYING", verification: "TRIAL" },
      ],
    });
    expect(result.created).toBe(2);

    const rows = (await signupRepository.listByRunAndUser(ids.normal, ids.mira)).filter(
      (row) => row.participationType === "LOOTBUDDY" && row.status === "PENDING",
    );
    for (const row of rows) createdIds.push(row.id);

    const lootOnly = rows.find((row) => row.lootbuddyMode === "LOOT_ONLY");
    const playing = rows.find((row) => row.lootbuddyMode === "PLAYING");
    expect(lootOnly?.lootbuddyClass).toBe("PRIEST");
    expect(lootOnly?.lootbuddyVerification).toBe("ACCESS");
    expect(lootOnly?.character).toBeNull();
    expect(playing?.lootbuddyClass).toBe("MAGE");
    expect(playing?.lootbuddyVerification).toBe("TRIAL");
    expect(playing?.id).not.toBe(lootOnly?.id);

    await signupService.withdrawSignup(mira, playing!.id);
    const restored = await signupRepository.findById(playing!.id);
    expect(restored?.status).toBe("WITHDRAWN");
  });

  it("allows identical class+mode lootbuddy entries as distinct signup ids", async () => {
    const result = await signupService.setLootbuddies(mira, {
      runId: ids.weekend,
      lootbuddies: [
        { wowClass: "MAGE", mode: "LOOT_ONLY" },
        { wowClass: "MAGE", mode: "LOOT_ONLY" },
      ],
    });
    expect(result.created).toBe(2);
    const rows = (await signupRepository.listByRunAndUser(ids.weekend, ids.mira)).filter(
      (row) => row.participationType === "LOOTBUDDY" && row.status === "PENDING",
    );
    for (const row of rows) createdIds.push(row.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).not.toBe(rows[1]!.id);
  });

  it("rejects booster signup when the user has no characters / character not owned", async () => {
    await expectDomainCode(
      signupService.createBoosterSignup(kael, {
        runId: ids.weekend,
        characterId: ids.miraPriest,
        role: "HEALER",
        isBackup: false,
      }),
      "CHARACTER_NOT_OWNED",
    );
  });

  it("rejects a closed/non-signable run", async () => {
    await expectDomainCode(
      signupService.createBoosterSignup(kael, {
        runId: ids.draft,
        characterId: ids.kaelEle,
        role: "DPS",
        isBackup: false,
      }),
      "SIGNUP_CLOSED",
    );
  });

  it("lets a user withdraw an own pending signup and keeps the row", async () => {
    const created = await signupService.createBoosterSignup(brann, {
      runId: ids.weekend,
      characterId: ids.brannHoly,
      role: "HEALER",
      isBackup: false,
    });
    createdIds.push(created.id);
    await signupService.withdrawSignup(brann, created.id);
    const stored = await signupRepository.findById(created.id);
    expect(stored?.status).toBe("WITHDRAWN");
  });

  it("rejects withdrawing someone else's signup", async () => {
    const mine = await signupService.getMyRuns(kael);
    const foreign = mine.selected.find((item) => item.runId === ids.published);
    expect(foreign).toBeTruthy();
    await expectDomainCode(signupService.withdrawSignup(mira, foreign!.id), "NOT_AUTHORIZED");
  });

  it("rejects self-withdraw of a selected signup after roster publication", async () => {
    const mine = await signupService.getMyRuns(kael);
    const published = mine.selected.find((item) => item.runId === ids.published);
    expect(published?.canWithdraw).toBe(false);
    await expectDomainCode(
      signupService.withdrawSignup(kael, published!.id),
      "INVALID_STATE_TRANSITION",
    );
  });

  it("rejects withdrawing a withdrawn signup", async () => {
    const mine = await signupService.getMyRuns(mira);
    const withdrawn = mine.withdrawn.find((item) => item.runId === ids.weekend);
    expect(withdrawn).toBeTruthy();
    await expectDomainCode(
      signupService.withdrawSignup(mira, withdrawn!.id),
      "INVALID_STATE_TRANSITION",
    );
  });

  it("can offer two different Brann characters on the same open run", async () => {
    const tank = await signupService.createBoosterSignup(brann, {
      runId: ids.weekend,
      characterId: ids.brannPaladin,
      role: "TANK",
      isBackup: false,
    });
    createdIds.push(tank.id);
    const healer = await signupService.createBoosterSignup(brann, {
      runId: ids.weekend,
      characterId: ids.brannHoly,
      role: "HEALER",
      isBackup: false,
    });
    if (!createdIds.includes(healer.id)) {
      createdIds.push(healer.id);
    }
    expect(healer.revived).toBe(true);
    expect(tank.id).not.toBe(healer.id);
  });
});
