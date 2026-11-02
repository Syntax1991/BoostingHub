import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { anyContentRunInput, futureTestIso } from "@/lib/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";
import { testActor } from "@/test/actors";
import { assertIsolatedTestDatabase, createTestCharacter, createTestUser, deleteCreatedRows } from "@/test/db-fixtures";
import { expectDomainError } from "@/test/domain-error";
import { offerCharacter } from "@/test/signup-offers";

/**
 * Withdraw rules and Lootbuddy entries. Booster offers themselves (create,
 * reconcile, reactivate, validation, signup window) are covered against
 * setCharacterOffers in signup-offers.service.test.ts.
 */
const created = { runIds: [] as string[], characterIds: [] as string[], userIds: [] as string[] };
let booster: AuthenticatedUser;
let other: AuthenticatedUser;
let lead: AuthenticatedUser;

async function createUser(name: string, accountRole: AuthenticatedUser["accountRole"], isBooster: boolean) {
  const id = await createTestUser({ name, accountRole, isBooster });
  created.userIds.push(id);
  return testActor(id, accountRole, { name });
}

async function createHealer(owner: AuthenticatedUser, name: string) {
  const id = await createTestCharacter({
    userId: owner.id,
    name,
    realm: "Signup Lab",
    wowClass: "PRIEST",
    specialization: "Holy",
    primaryRole: "HEALER",
  });
  created.characterIds.push(id);
  return id;
}

let startSlot = 0;
async function createOpenRun() {
  startSlot += 1;
  const run = await runService.createRun(lead, anyContentRunInput({ scheduledStartAt: futureTestIso(20 + startSlot) }));
  created.runIds.push(run.id);
  await runService.openRun(lead, run.id);
  return run.id;
}

async function statusOf(signupId: string) {
  return (await signupRepository.findById(signupId))?.status;
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  await raidRepository.ensureReferenceRaids();
  booster = await createUser("Signup Booster", "USER", true);
  other = await createUser("Signup Other", "USER", true);
  lead = await createUser("Signup Lead", "RAID_LEAD", false);
});

afterAll(async () => {
  await deleteCreatedRows(created);
});

describe("signupService lootbuddies", () => {
  it("creates loot-only and playing lootbuddy signups with verification metadata", async () => {
    const runId = await createOpenRun();
    const result = await signupService.setLootbuddies(booster, {
      runId,
      lootbuddies: [
        { wowClass: "PRIEST", mode: "LOOT_ONLY", verification: "ACCESS" },
        { wowClass: "MAGE", mode: "PLAYING", verification: "TRIAL" },
      ],
    });
    expect(result.created).toBe(2);

    const rows = (await signupRepository.listByRunAndUser(runId, booster.id)).filter(
      (row) => row.participationType === "LOOTBUDDY" && row.status === "PENDING",
    );
    expect(rows).toHaveLength(2);
    const lootOnly = rows.find((row) => row.lootbuddyMode === "LOOT_ONLY");
    const playing = rows.find((row) => row.lootbuddyMode === "PLAYING");
    expect(lootOnly).toMatchObject({ lootbuddyClass: "PRIEST", lootbuddyVerification: "ACCESS", character: null });
    expect(playing).toMatchObject({ lootbuddyClass: "MAGE", lootbuddyVerification: "TRIAL" });

    await signupService.withdrawSignup(booster, playing!.id);
    expect(await statusOf(playing!.id)).toBe("WITHDRAWN");
    expect(await statusOf(lootOnly!.id)).toBe("PENDING");
  });
});

describe("signupService.withdrawSignup", () => {
  it("lets a user withdraw an own pending signup and keeps the row", async () => {
    const runId = await createOpenRun();
    const signupId = await offerCharacter(booster, runId, await createHealer(booster, "Withdrawown"), "HEALER");

    await signupService.withdrawSignup(booster, signupId);

    expect(await statusOf(signupId)).toBe("WITHDRAWN");
  });

  it("rejects withdrawing someone else's signup", async () => {
    const runId = await createOpenRun();
    const signupId = await offerCharacter(booster, runId, await createHealer(booster, "Withdrawforeign"), "HEALER");

    await expectDomainError(signupService.withdrawSignup(other, signupId), "NOT_AUTHORIZED");
    expect(await statusOf(signupId)).toBe("PENDING");
  });

  it("rejects withdrawing a withdrawn signup", async () => {
    const runId = await createOpenRun();
    const signupId = await offerCharacter(booster, runId, await createHealer(booster, "Withdrawtwice"), "HEALER");
    await signupService.withdrawSignup(booster, signupId);

    await expectDomainError(signupService.withdrawSignup(booster, signupId), "INVALID_STATE_TRANSITION");
  });

  it("a selected signup after roster publication withdraws only with a reason", async () => {
    const runId = await createOpenRun();
    const signupId = await offerCharacter(booster, runId, await createHealer(booster, "Withdrawpicked"), "HEALER");
    let view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections: [{ signupId, selectedRole: "HEALER" }],
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, { runId, version: view.roster.version, acknowledgeWarnings: true });

    const published = (await signupService.getMyRuns(booster)).selected.find((item) => item.id === signupId);
    expect(published).toMatchObject({ canWithdraw: false, canWithdrawWithReason: true });
    await expectDomainError(signupService.withdrawSignup(booster, signupId), "WITHDRAW_REASON_REQUIRED");
    expect(await statusOf(signupId)).toBe("SELECTED");
  });
});
