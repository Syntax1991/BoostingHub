import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { lockoutService } from "@/services/lockout.service";
import { rosterService } from "@/services/roster.service";
import type { ConfirmedRosterWarning, RosterSelectionRisk } from "@/domain/roster-selection-risk";
import { runService } from "@/services/run.service";
import { venomousCreateInput } from "@/lib/test-run-input";
import { signupService } from "@/services/signup.service";
import { testActor } from "@/test/actors";
import { assertIsolatedTestDatabase, createTestCharacter, createTestUser, deleteCreatedRows } from "@/test/db-fixtures";
import { expectDomainError } from "@/test/domain-error";
import { freezeSystemTime, restoreSystemTime } from "@/test/time";

/**
 * Raid lockouts (raid saves) are informational only — a Character already
 * saved to the target raid/difficulty/reset remains fully eligible: it can
 * still be offered, staged, confirmed, draft-selected, and published. This
 * is a completely separate concern from cross-Run Character reservation,
 * which remains a hard block (see the last test in this file).
 */

const raidId = VENOMOUS_ABYSS_RAID_ID;
/** Runs cascade; Characters and their lockouts go with the target User. */
const created = { runIds: [] as string[], userIds: [] as string[] };
let lead: AuthenticatedUser;
let target: AuthenticatedUser;
/** A fresh saved Character per test, so no test sees another's lockouts or reservations. */
let saved = "";
let savedName = "";
let testIndex = 0;

function rosterBoosters<T extends { id: string }>(view: { boosters: T[] }): T[] {
  return view.boosters;
}

/** The Raid Lead's explicit "Select anyway" for every warning the roster card currently shows. */
function confirmWarnings(signup: { id: string; selectionRisk: RosterSelectionRisk }): ConfirmedRosterWarning[] {
  return signup.selectionRisk.warnings.map((warning) => ({
    signupId: signup.id,
    type: warning.type,
    fingerprint: warning.fingerprint,
  }));
}

function futureIso(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  await raidRepository.ensureReferenceRaids();
  const leadId = await createTestUser({ name: "Lockout Lead", accountRole: "RAID_LEAD" });
  const targetId = await createTestUser({ name: "Lockout Target", isBooster: true });
  created.userIds.push(leadId, targetId);
  lead = testActor(leadId, "RAID_LEAD");
  target = testActor(targetId);
}, 60_000);

beforeEach(async () => {
  // Character names are letters only and unique per owner.
  savedName = `Rlsaved${"abcdefghij"[testIndex++]}`;
  saved = await createTestCharacter({
    userId: target.id,
    name: savedName,
    realm: "Lockout Lab",
    wowClass: "HUNTER",
    specialization: "Beast Mastery",
    primaryRole: "RANGED_DPS",
  });
});

afterAll(() => deleteCreatedRows(created), 60_000);

async function createOpenRun(scheduledStartAt: string) {
  const id = await runService
    .createRun(
      lead,
      venomousCreateInput({
        scheduledStartAt,
        desiredTankCount: 0,
        desiredHealerCount: 0,
        desiredDpsCount: 1,
      }),
    )
    .then((run) => run.id);
  created.runIds.push(id);
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
  // One lockout per (Character, raid, difficulty, reset): a second Run in the same reset reuses it.
  const existing = await orm.CharacterRaidLockout.where({ characterId, raidId, difficulty: "HEROIC", resetIdentifier }).first();
  if (existing) return { lockoutId: (existing as { id: string }).id, resetIdentifier };
  const lockoutId = crypto.randomUUID();
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
    expect(eligibleOption?.contentSaves[0]?.raidSave).toEqual({
      raidId,
      difficulty: "HEROIC",
      resetIdentifier: lockoutService.getResetIdentifierForRun("EU", runARecord!.scheduledStartAt),
      bossesDefeated: 8,
      totalBossCount: 8,
      isComplete: true,
    });

    const result = await signupService.setCharacterOffers(target, {
      runId: runA,
      offers: [{ characterId: saved, offeredRoles: ["RANGED_DPS"] }],
    });
    expect(result).toMatchObject({ created: 1, reactivated: 0 });

    const rows = await signupRepository.listByRunAndUser(runA, target.id);
    const activeRow = rows.find((row) => row.character?.id === saved && row.status !== "WITHDRAWN");
    expect(activeRow?.offeredRoles).toEqual(["RANGED_DPS"]);

    // Still eligible and still shows the save after being offered — offering
    // is completely independent of eligibility.
    const after = await signupService.getSignupOptions(target, runA);
    expect(after.booster.eligible.some((item) => item.characterId === saved)).toBe(true);
    expect(after.booster.ineligible).toHaveLength(0);
  });

  it("a saved, draft-selected Character publishes normally — save context survives into the published roster view", async () => {
    const runA = await createOpenRun(futureIso(410));
    await markSaved(runA, saved);
    await signupService.setCharacterOffers(target, { runId: runA, offers: [{ characterId: saved, offeredRoles: ["RANGED_DPS"] }] });

    const view = await rosterService.getRosterManagementView(lead, runA);
    const candidate = rosterBoosters(view).find((item) => item.character?.id === saved);
    expect(candidate).toBeTruthy();
    expect(candidate?.contentSaves[0]?.raidSave?.bossesDefeated).toBe(8);
    expect(candidate?.issue).toBeNull();
    // A known save on an UNSAVED Run is a WARNING: selectable, but only with
    // the Raid Lead's explicit confirmation (never a blocker).
    expect(candidate?.selectionRisk.level).toBe("WARNING");
    await expectDomainError(
      rosterService.setDraftSelection(lead, { runId: runA, signupId: candidate!.id, selected: true, version: view.roster.version }),
      "ROSTER_WARNING_CONFIRMATION_REQUIRED",
    );

    await rosterService.setDraftSelection(lead, {
      runId: runA,
      signupId: candidate!.id,
      selected: true,
      version: view.roster.version,
      confirmedWarnings: confirmWarnings(candidate!),
    });

    const readyToPublish = await rosterService.getRosterManagementView(lead, runA);
    expect(readyToPublish.validation.canPublish).toBe(true);
    await expect(
      rosterService.publishRoster(lead, { runId: runA, version: readyToPublish.roster.version, acknowledgeWarnings: true }),
    ).resolves.toBeTruthy();

    const published = await rosterService.getPublishedRosterView(runA);
    expect(published?.members.some((member) => member.characterName === savedName)).toBe(true);
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
    await signupService.setCharacterOffers(target, { runId: runA, offers: [{ characterId: saved, offeredRoles: ["RANGED_DPS"] }] });
    const viewA = await rosterService.getRosterManagementView(lead, runA);
    const signupA = rosterBoosters(viewA).find((item) => item.character?.id === saved)!;
    await rosterService.setDraftSelection(lead, {
      runId: runA,
      signupId: signupA.id,
      selected: true,
      version: viewA.roster.version,
      confirmedWarnings: confirmWarnings(signupA),
    });

    // Now runB must block on the cross-run reservation reason, not lockout —
    // even though the Character is ALSO saved on runB's exact raid/difficulty/reset.
    await expectDomainError(
      signupService.setCharacterOffers(target, { runId: runB, offers: [{ characterId: saved, offeredRoles: ["RANGED_DPS"] }] }),
      "CHARACTER_ALREADY_SELECTED_OTHER_RUN",
    );

    const optionsBAfter = await signupService.getSignupOptions(target, runB);
    const ineligible = optionsBAfter.booster.ineligible.find((item) => item.characterId === saved);
    expect(ineligible?.reason).toBe("ALREADY_SELECTED_OTHER_RUN");
  });

  it("EU Monday/Tuesday Runs find HC lockouts persisted under the Wednesday regional reset start", async () => {
    // Freeze Date only: keep the Wed-reset geometry (Mon/Tue → 2026-W37) while
    // still satisfying createRun's "schedule not in the past" rule.
    freezeSystemTime("2026-09-10T12:00:00.000Z");
    try {
      const monday = await createOpenRun("2026-09-14T00:00:00.000Z"); // Mon 02:00 Berlin
      const tuesday = await createOpenRun("2026-09-15T01:00:00.000Z"); // Tue 03:00 Berlin VIP-style
      const { resetIdentifier } = await markSaved(monday, saved, 7, false);
      expect(resetIdentifier).toBe("2026-W37");
      // Same regional reset for Tuesday: the existing lockout covers it.
      expect((await markSaved(tuesday, saved, 7, false)).resetIdentifier).toBe("2026-W37");

      const mondayOptions = await signupService.getSignupOptions(target, monday);
      expect(mondayOptions.booster.eligible.find((item) => item.characterId === saved)?.contentSaves[0]?.raidSave).toEqual({
        raidId,
        difficulty: "HEROIC",
        resetIdentifier: "2026-W37",
        bossesDefeated: 7,
        totalBossCount: 8,
        isComplete: false,
      });

      await signupService.setCharacterOffers(target, {
        runId: tuesday,
        offers: [{ characterId: saved, offeredRoles: ["RANGED_DPS"] }],
      });
      const tuesdayView = await rosterService.getRosterManagementView(lead, tuesday);
      const candidate = rosterBoosters(tuesdayView).find((item) => item.character?.id === saved);
      expect(candidate?.contentSaves[0]?.raidSave?.resetIdentifier).toBe("2026-W37");
      expect(candidate?.contentSaves[0]?.raidSave?.bossesDefeated).toBe(7);
    } finally {
      restoreSystemTime();
    }
  });

  it("verified HC 0/8 surfaces on signup options and roster (not Unknown)", async () => {
    freezeSystemTime("2026-09-10T12:00:00.000Z");
    try {
      const runId = await createOpenRun("2026-09-14T00:00:00.000Z");
      await markSaved(runId, saved, 0, false);

      const options = await signupService.getSignupOptions(target, runId);
      expect(options.booster.eligible.find((item) => item.characterId === saved)?.contentSaves[0]?.raidSave?.bossesDefeated).toBe(0);

      await signupService.setCharacterOffers(target, {
        runId,
        offers: [{ characterId: saved, offeredRoles: ["RANGED_DPS"] }],
      });
      const view = await rosterService.getRosterManagementView(lead, runId);
      expect(rosterBoosters(view).find((item) => item.character?.id === saved)?.contentSaves[0]?.raidSave).toEqual({
        raidId,
        difficulty: "HEROIC",
        resetIdentifier: "2026-W37",
        bossesDefeated: 0,
        totalBossCount: 8,
        isComplete: false,
      });
    } finally {
      restoreSystemTime();
    }
  });
});
