/**
 * PUBLISHED remains signup-available while signupsOpen=true.
 * Late offers stay PENDING and do not mutate the live published lineup.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { anyContentRunInput } from "@tests/fixtures/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { buildSignupButtons } from "@/discord-bot/embeds/signup-embed";
import { parseCustomId } from "@/discord-bot/custom-ids";
import { discordSyncService } from "@/services/discord-sync.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";
import {
  canToggleSignupWindow,
  isSignupWindowOpen,
} from "@/domain/run-state";
import { testActor } from "@tests/fixtures/actors";
import { assertIsolatedTestDatabase, createTestCharacter, createTestUser, deleteCreatedRows } from "@tests/fixtures/db-fixtures";
import { expectDomainError } from "@tests/helpers/domain-error";
import { CURRENT_WEEK_RUN_START, HOUR_MS, RAID_WEEK_TEST_CLOCK, freezeSystemTime, restoreSystemTime } from "@tests/fixtures/time";

/** Runs (signups, rosters, notifications) cascade; Characters go with their Users. */
const created = { runIds: [] as string[], userIds: [] as string[] };
let lead: AuthenticatedUser;
let early: AuthenticatedUser;
let late: AuthenticatedUser;

function hunter(userId: string, name: string) {
  return createTestCharacter({ userId, name, realm: "Published Lab", wowClass: "HUNTER", specialization: "Beast Mastery", primaryRole: "RANGED_DPS" });
}

/** An OPEN Run of the suite's Raid Lead, `hoursLater` after the frozen week's Saturday Run slot. */
async function openRun(hoursLater: number) {
  const scheduledStartAt = new Date(Date.parse(CURRENT_WEEK_RUN_START) + hoursLater * HOUR_MS).toISOString();
  const run = await runService.createRun(lead, anyContentRunInput({ scheduledStartAt, desiredTankCount: 1, desiredHealerCount: 1, desiredDpsCount: 1 }));
  created.runIds.push(run.id);
  await runService.openRun(lead, run.id);
  return run.id;
}

let earlyChar = "";
let lateChar = "";

beforeAll(async () => {
  assertIsolatedTestDatabase();
  freezeSystemTime(RAID_WEEK_TEST_CLOCK, { advance: true });
  await raidRepository.ensureReferenceRaids();
  const leadId = await createTestUser({ name: "Published Signup Lead", accountRole: "RAID_LEAD" });
  const earlyId = await createTestUser({ name: "Early Signer", isBooster: true });
  const lateId = await createTestUser({ name: "Late Signer", isBooster: true });
  created.userIds.push(leadId, earlyId, lateId);
  lead = testActor(leadId, "RAID_LEAD");
  early = testActor(earlyId);
  late = testActor(lateId);
  earlyChar = await hunter(earlyId, "Psearlyhunt");
  lateChar = await hunter(lateId, "Pslatehunt");
}, 60_000);

afterAll(async () => {
  try {
    await deleteCreatedRows(created);
  } finally {
    restoreSystemTime();
  }
}, 60_000);

describe("signup window matrix", () => {
  it("A–G: OPEN/ROSTERING/PUBLISHED honor signupsOpen; post-Start statuses stay closed", () => {
    expect(isSignupWindowOpen("OPEN", true)).toBe(true);
    expect(isSignupWindowOpen("ROSTERING", true)).toBe(true);
    expect(isSignupWindowOpen("PUBLISHED", true)).toBe(true);
    expect(isSignupWindowOpen("PUBLISHED", false)).toBe(false);
    expect(isSignupWindowOpen("IN_PROGRESS", true)).toBe(false);
    expect(isSignupWindowOpen("COMPLETED", true)).toBe(false);
    expect(isSignupWindowOpen("CANCELLED", true)).toBe(false);
  });

  it("H: canToggleSignupWindow allows PUBLISHED", () => {
    expect(canToggleSignupWindow("PUBLISHED")).toBe(true);
    expect(canToggleSignupWindow("IN_PROGRESS")).toBe(false);
  });
});

describe("published-run signups", () => {
  it("I–V: late offers stay PENDING; Start freezes; Discord buttons follow the window", async () => {
    const runId = await openRun(0);

    await signupService.setCharacterOffers(early, {
      runId,
      offers: [{ characterId: earlyChar, offeredRoles: ["RANGED_DPS"] }],
    });
    const earlyRows = await signupRepository.listByRunAndUser(runId, early.id);
    const earlySignupId = earlyRows.find((row) => row.status === "PENDING")!.id;

    let view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections: [{ signupId: earlySignupId, selectedRole: "RANGED_DPS" }],
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, {
      runId,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });

    let run = await runRepository.findById(runId);
    expect(run?.status).toBe("PUBLISHED");
    expect(run?.signupsOpen).toBe(true);

    // I/J — close / reopen on PUBLISHED
    await runService.setSignupWindow(lead, runId, false);
    expect((await runRepository.findById(runId))?.signupsOpen).toBe(false);
    await runService.setSignupWindow(lead, runId, true);
    expect((await runRepository.findById(runId))?.signupsOpen).toBe(true);

    const selectedBefore = (await signupRepository.listByRunId(runId)).filter((row) => row.status === "SELECTED");
    expect(selectedBefore.map((row) => row.id)).toEqual([earlySignupId]);
    const rosterBefore = await rosterService.getPublishedRosterView(runId);
    expect(rosterBefore).not.toBeNull();
    const selectedIdsBefore = new Set(rosterBefore!.members.map((member) => member.signupId));

    // L — Booster signup after publish
    const booster = await signupService.setCharacterOffers(late, {
      runId,
      offers: [{ characterId: lateChar, offeredRoles: ["RANGED_DPS"] }],
    });
    expect(booster.created + booster.reactivated).toBe(1);
    const lateBooster = (await signupRepository.listByRunAndUser(runId, late.id)).find(
      (row) => row.participationType === "BOOSTER" && row.status !== "WITHDRAWN",
    );
    expect(lateBooster?.status).toBe("PENDING");

    // Late PENDING joins Signups by role; the published SELECTED pick is on the
    // roster, not in the unpicked pool — but both Users still count as signed.
    const afterLateEmbed = await discordSyncService.getSignupEmbedData(runId);
    expect(afterLateEmbed?.uniqueSignupCount).toBe(2);
    expect(afterLateEmbed?.members.signed.dps.some((m) => m.signupId === earlySignupId)).toBe(false);
    expect(afterLateEmbed?.members.signed.dps.some((m) => m.signupId === lateBooster!.id)).toBe(true);

    // M — Lootbuddy signup after publish
    const loot = await signupService.setLootbuddies(late, {
      runId,
      lootbuddies: [{ wowClass: "WARLOCK", mode: "PLAYING" }],
    });
    expect(loot.created).toBe(1);

    // N — Quick Signup on a second published open run
    // A day later: no reservation clash with the first Run.
    const quickRunId = await openRun(24);
    await runRepository.updateFields(quickRunId, { status: "PUBLISHED", signupsOpen: true });
    const quick = await signupService.quickSignupBoosters(late, { runId: quickRunId });
    // The late signer's only Character.
    expect(quick.added).toBe(1);

    // O — closed PUBLISHED rejects new offers
    await runService.setSignupWindow(lead, runId, false);
    await expectDomainError(
      signupService.setLootbuddies(early, {
        runId,
        lootbuddies: [{ wowClass: "MAGE", mode: "LOOT_ONLY" }],
      }),
      "SIGNUP_CLOSED",
    );
    await expectDomainError(signupService.quickSignupBoosters(early, { runId }), "SIGNUP_CLOSED");
    await runService.setSignupWindow(lead, runId, true);

    // P — published lineup unchanged by the late PENDING offer
    const selectedAfter = (await signupRepository.listByRunId(runId)).filter((row) => row.status === "SELECTED");
    expect(selectedAfter.map((row) => row.id)).toEqual([earlySignupId]);
    const rosterAfter = await rosterService.getPublishedRosterView(runId);
    expect(new Set(rosterAfter!.members.map((member) => member.signupId))).toEqual(selectedIdsBefore);

    // Q — late offer appears as a roster candidate
    view = await rosterService.getRosterManagementView(lead, runId);
    const candidate = view.boosters.find((signup) => signup.id === lateBooster!.id);
    expect(candidate?.status).toBe("PENDING");
    expect(candidate?.draftSelected).toBe(false);

    // R — Update Roster can later select the late signup
    view = await rosterService.getRosterManagementView(lead, runId);
    if (view.roster.needsPublishSeed) {
      await rosterService.preparePublishedRosterForEditing(lead, { runId, version: view.roster.version });
      view = await rosterService.getRosterManagementView(lead, runId);
    }
    await rosterService.updateRoster(lead, {
      runId,
      version: view.roster.version,
      acknowledgeWarnings: true,
      selections: [
        { signupId: earlySignupId, selectedRole: "RANGED_DPS" },
        { signupId: lateBooster!.id, selectedRole: "RANGED_DPS" },
      ],
    });
    const selectedFinal = (await signupRepository.listByRunId(runId)).filter((row) => row.status === "SELECTED");
    expect(selectedFinal.map((row) => row.id).sort()).toEqual([earlySignupId, lateBooster!.id].sort());

    // U — Discord Signup buttons enabled while PUBLISHED + open
    const openEmbed = await discordSyncService.getSignupEmbedData(runId);
    expect(openEmbed?.signupWindowOpen).toBe(true);
    expect(openEmbed?.runStatus).toBe("PUBLISHED");
    const openButtons = buildSignupButtons(openEmbed!).flatMap((row) => row.toJSON().components) as Array<{
      custom_id: string;
      disabled?: boolean;
    }>;
    const openByAction = new Map(openButtons.map((c) => [parseCustomId(c.custom_id)?.action, c]));
    expect(openByAction.get("signup")?.disabled).toBeFalsy();
    expect(openByAction.get("quick-signup")?.disabled).toBeFalsy();
    expect(openByAction.get("lootbuddy")?.disabled).toBeFalsy();

    // S — Start freezes signups
    await runService.startRun(lead, { runId });
    run = await runRepository.findById(runId);
    expect(run?.status).toBe("IN_PROGRESS");
    expect(run?.signupsOpen).toBe(false);

    // K / T — reopen and new offers rejected after Start
    await expectDomainError(runService.setSignupWindow(lead, runId, true), "RUN_INVALID_TRANSITION");
    await expectDomainError(
      signupService.setLootbuddies(early, {
        runId,
        lootbuddies: [{ wowClass: "PRIEST", mode: "PLAYING" }],
      }),
      "SIGNUP_CLOSED",
    );
    await expectDomainError(signupService.quickSignupBoosters(early, { runId }), "SIGNUP_CLOSED");

    // V — Discord buttons disabled after Start
    const closedEmbed = await discordSyncService.getSignupEmbedData(runId);
    expect(closedEmbed?.signupWindowOpen).toBe(false);
    expect(closedEmbed?.runStatus).toBe("IN_PROGRESS");
    const closedButtons = buildSignupButtons(closedEmbed!).flatMap((row) => row.toJSON().components) as Array<{
      custom_id: string;
      disabled?: boolean;
    }>;
    const closedByAction = new Map(closedButtons.map((c) => [parseCustomId(c.custom_id)?.action, c]));
    expect(closedByAction.get("signup")?.disabled).toBe(true);
    expect(closedByAction.get("quick-signup")?.disabled).toBe(true);
    expect(closedByAction.get("lootbuddy")?.disabled).toBe(true);
    expect(closedByAction.get("cancel")?.disabled).toBeFalsy();
  }, 120_000);
});
