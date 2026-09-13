import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { lockoutService } from "@/services/lockout.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";

/**
 * Raid lockouts (raid saves) are informational only — a Character already
 * saved to the target raid/difficulty/reset remains fully eligible: it can
 * still be offered, staged, confirmed, draft-selected, and published. This
 * is a completely separate concern from cross-Run Character reservation,
 * which remains a hard block (see the last test in this file).
 */

const raidId = VENOMOUS_ABYSS_RAID_ID;
const ids = {
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-rl0000000001",
  target: "aaaaaaaa-aaaa-4aaa-8aaa-rl0000000002",
};
const createdUserIds = Object.values(ids);
const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdQualificationIds: string[] = [];
const createdLockoutIds: string[] = [];

function asUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"] = "USER"): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@rltest.boostting.local`,
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
    if (error instanceof Error && error.message === `Expected domain error ${code}`) {
      throw error;
    }
    expect(isDomainError(error) && error.code).toBe(code);
  }
}

async function createTestUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]) {
  await orm.User.create({
    id,
    name,
    email: `${id}@rltest.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function deleteIfPresent(table: string, id: string) {
  try {
    if (table === "User") await orm.User.where({ id }).delete();
    else if (table === "Character") await orm.Character.where({ id }).delete();
    else if (table === "RunSignup") await orm.RunSignup.where({ id }).delete();
    else if (table === "Run") await orm.Run.where({ id }).delete();
    else if (table === "BoosterQualification") await orm.BoosterQualification.where({ id }).delete();
    else if (table === "CharacterRaidLockout") await orm.CharacterRaidLockout.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

function futureIso(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

async function cleanupRun(runId: string) {
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
    await deleteIfPresent("RunSignup", (row as { id: string }).id);
  }
  await deleteIfPresent("Run", runId);
}

const lead = asUser(ids.lead, "Lockout Lead", "RAID_LEAD");
const target = asUser(ids.target, "Lockout Target", "USER");

let saved = "";

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  for (const userId of createdUserIds) {
    const runs = await orm.Run.where({ raidLeadId: userId }).select("id").all();
    for (const row of runs) {
      await cleanupRun((row as { id: string }).id);
    }
    const quals = await orm.BoosterQualification.where({ userId }).select("id").all();
    for (const row of quals) {
      await deleteIfPresent("BoosterQualification", (row as { id: string }).id);
    }
    const chars = await orm.Character.where({ userId }).select("id").all();
    for (const row of chars) {
      await deleteIfPresent("Character", (row as { id: string }).id);
    }
    await deleteIfPresent("User", userId);
  }

  await createTestUser(ids.lead, "Lockout Lead", "RAID_LEAD");
  await createTestUser(ids.target, "Lockout Target", "USER");

  saved = crypto.randomUUID();
  createdCharacterIds.push(saved);
  await orm.Character.create({
    id: saved,
    userId: ids.target,
    name: "Rlsaved",
    realm: "Lockout Lab",
    normalizedName: normalizeCharacterIdentity("Rlsaved"),
    normalizedRealm: normalizeCharacterIdentity("Lockout Lab"),
    region: "EU",
    wowClass: "HUNTER",
    specialization: "Beast Mastery",
    primaryRole: "DPS",
    itemLevel: 700,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const qualId = crypto.randomUUID();
  createdQualificationIds.push(qualId);
  await orm.BoosterQualification.create({
    id: qualId,
    userId: ids.target,
    difficulty: "HEROIC",
    status: "APPROVED",
    notes: null,
    grantedAt: new Date().toISOString(),
    grantedById: null,
    revokedAt: null,
    revokedById: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}, 60_000);

afterAll(async () => {
  for (const runId of createdRunIds) {
    await cleanupRun(runId);
  }
  for (const id of createdLockoutIds) {
    await deleteIfPresent("CharacterRaidLockout", id);
  }
  for (const id of createdQualificationIds) {
    await deleteIfPresent("BoosterQualification", id);
  }
  for (const id of createdCharacterIds) {
    await deleteIfPresent("Character", id);
  }
  for (const id of createdUserIds) {
    await deleteIfPresent("User", id);
  }
}, 60_000);

async function createOpenRun(scheduledStartAt: string) {
  const id = await runService
    .createRun(lead, {
      raidId,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt,
      desiredTankCount: 0,
      desiredHealerCount: 0,
      desiredDpsCount: 1,
    })
    .then((run) => run.id);
  createdRunIds.push(id);
  await runService.openRun(lead, id);
  return id;
}

async function markSaved(runId: string, characterId: string, bossesDefeated = 8, isComplete = true) {
  const run = await runRepository.findById(runId);
  const character = await orm.Character.where({ id: characterId }).first();
  const region = (character as { region?: string } | null)?.region === "US" ? "US" : "EU";
  const resetIdentifier = lockoutService.getResetIdentifierForRun(
    region,
    run?.scheduledStartAt ?? futureIso(1),
  );
  // Tests reuse the same Character/raid/difficulty across several Runs that
  // may land in the same reset week — CharacterRaidLockout is unique on
  // (characterId, raidId, difficulty, resetIdentifier), so clear any prior
  // row for this exact key first rather than colliding with it.
  await orm.CharacterRaidLockout.where({ characterId, raidId, difficulty: "HEROIC", resetIdentifier }).delete().catch(() => {});
  const lockoutId = crypto.randomUUID();
  createdLockoutIds.push(lockoutId);
  await orm.CharacterRaidLockout.create({
    id: lockoutId,
    characterId,
    raidId,
    difficulty: "HEROIC",
    resetIdentifier,
    bossesDefeated,
    isComplete,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return { lockoutId, resetIdentifier };
}

describe("raid lockouts are informational — full signup/roster/publish chain", () => {
  it("a fully-saved Character (HC 8/8) is eligible, offerable, and confirms successfully — no LOCKOUT_CONFLICT", async () => {
    const runA = await createOpenRun(futureIso(400));
    await markSaved(runA, saved);

    const before = await signupService.getSignupOptions(target, runA);
    const eligibleOption = before.booster.eligible.find((item) => item.characterId === saved);
    expect(eligibleOption).toBeTruthy();
    const runARecord = await runRepository.findById(runA);
    expect(eligibleOption?.raidSave).toEqual({
      raidId,
      difficulty: "HEROIC",
      resetIdentifier: lockoutService.getResetIdentifierForRun("EU", runARecord!.scheduledStartAt),
      bossesDefeated: 8,
      totalBossCount: 8,
      isComplete: true,
    });

    const result = await signupService.setCharacterOffers(target, {
      runId: runA,
      offers: [{ characterId: saved, role: "DPS" }],
    });
    expect(result.created + result.reactivated).toBeGreaterThan(0);

    const rows = await signupRepository.listByRunAndUser(runA, ids.target);
    const activeRow = rows.find((row) => row.character?.id === saved && row.status !== "WITHDRAWN");
    expect(activeRow?.role).toBe("DPS");

    // Still eligible and still shows the save after being offered — offering
    // is completely independent of eligibility.
    const after = await signupService.getSignupOptions(target, runA);
    expect(after.booster.eligible.some((item) => item.characterId === saved)).toBe(true);
    expect(after.booster.ineligible).toHaveLength(0);
  });

  it("a saved, draft-selected Character publishes normally — save context survives into the published roster view", async () => {
    const runA = await createOpenRun(futureIso(410));
    await markSaved(runA, saved);
    await signupService.setCharacterOffers(target, { runId: runA, offers: [{ characterId: saved, role: "DPS" }] });

    const view = await rosterService.getRosterManagementView(lead, runA);
    const candidate = view.groups.dps.find((item) => item.character?.id === saved);
    expect(candidate).toBeTruthy();
    expect(candidate?.raidSave?.bossesDefeated).toBe(8);
    expect(candidate?.issue).toBeNull();

    await rosterService.setDraftSelection(lead, { runId: runA, signupId: candidate!.id, selected: true, version: view.roster.version });

    const readyToPublish = await rosterService.getRosterManagementView(lead, runA);
    expect(readyToPublish.validation.canPublish).toBe(true);
    await expect(
      rosterService.publishRoster(lead, { runId: runA, version: readyToPublish.roster.version, acknowledgeWarnings: true }),
    ).resolves.toBeTruthy();

    const published = await rosterService.getPublishedRosterView(runA);
    expect(published?.members.some((member) => member.characterName === "Rlsaved")).toBe(true);
  });

  it("keeps raid save and cross-Run reservation as separate concerns: saved-but-free is eligible, saved-and-reserved-elsewhere is still ALREADY_SELECTED_OTHER_RUN (never LOCKOUT_CONFLICT)", async () => {
    const sched = futureIso(420);
    const runA = await createOpenRun(sched);
    const runB = await createOpenRun(sched); // colliding time
    await markSaved(runA, saved);
    await markSaved(runB, saved);

    // Saved but not reserved anywhere yet — eligible on both.
    const optionsA = await signupService.getSignupOptions(target, runA);
    const optionsB = await signupService.getSignupOptions(target, runB);
    expect(optionsA.booster.eligible.some((item) => item.characterId === saved)).toBe(true);
    expect(optionsB.booster.eligible.some((item) => item.characterId === saved)).toBe(true);

    // Reserve on runA via draft selection.
    await signupService.setCharacterOffers(target, { runId: runA, offers: [{ characterId: saved, role: "DPS" }] });
    const viewA = await rosterService.getRosterManagementView(lead, runA);
    const signupA = viewA.groups.dps.find((item) => item.character?.id === saved)!;
    await rosterService.setDraftSelection(lead, { runId: runA, signupId: signupA.id, selected: true, version: viewA.roster.version });

    // Now runB must block on the cross-run reservation reason, not lockout —
    // even though the Character is ALSO saved on runB's exact raid/difficulty/reset.
    await expectDomainCode(
      signupService.setCharacterOffers(target, { runId: runB, offers: [{ characterId: saved, role: "DPS" }] }),
      "CHARACTER_ALREADY_SELECTED_OTHER_RUN",
    );

    const optionsBAfter = await signupService.getSignupOptions(target, runB);
    const ineligible = optionsBAfter.booster.ineligible.find((item) => item.characterId === saved);
    expect(ineligible?.reason).toBe("ALREADY_SELECTED_OTHER_RUN");
  });

  it("EU Monday/Tuesday Runs find HC lockouts persisted under the Wednesday regional reset start", async () => {
    const monday = await createOpenRun("2026-09-14T00:00:00.000Z"); // Mon 02:00 Berlin
    const tuesday = await createOpenRun("2026-09-15T01:00:00.000Z"); // Tue 03:00 Berlin VIP-style
    const { resetIdentifier } = await markSaved(monday, saved, 7, false);
    expect(resetIdentifier).toBe("2026-W37");
    // Same regional key for Tuesday — reusing markSaved would recreate the same unique row.
    await markSaved(tuesday, saved, 7, false);

    const mondayOptions = await signupService.getSignupOptions(target, monday);
    expect(mondayOptions.booster.eligible.find((item) => item.characterId === saved)?.raidSave).toEqual({
      raidId,
      difficulty: "HEROIC",
      resetIdentifier: "2026-W37",
      bossesDefeated: 7,
      totalBossCount: 8,
      isComplete: false,
    });

    await signupService.setCharacterOffers(target, {
      runId: tuesday,
      offers: [{ characterId: saved, role: "DPS" }],
    });
    const tuesdayView = await rosterService.getRosterManagementView(lead, tuesday);
    const candidate = tuesdayView.groups.dps.find((item) => item.character?.id === saved);
    expect(candidate?.raidSave?.resetIdentifier).toBe("2026-W37");
    expect(candidate?.raidSave?.bossesDefeated).toBe(7);
  });

  it("verified HC 0/8 surfaces on signup options and roster (not Unknown)", async () => {
    const runId = await createOpenRun("2026-09-14T00:00:00.000Z");
    await markSaved(runId, saved, 0, false);

    const options = await signupService.getSignupOptions(target, runId);
    expect(options.booster.eligible.find((item) => item.characterId === saved)?.raidSave?.bossesDefeated).toBe(0);

    await signupService.setCharacterOffers(target, {
      runId,
      offers: [{ characterId: saved, role: "DPS" }],
    });
    const view = await rosterService.getRosterManagementView(lead, runId);
    expect(view.groups.dps.find((item) => item.character?.id === saved)?.raidSave).toEqual({
      raidId,
      difficulty: "HEROIC",
      resetIdentifier: "2026-W37",
      bossesDefeated: 0,
      totalBossCount: 8,
      isComplete: false,
    });
  });
});
