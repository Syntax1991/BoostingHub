/**
 * PUBLISHED remains signup-available while signupsOpen=true.
 * Late offers stay PENDING and do not mutate the live published lineup.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
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
} from "@/services/run-state";

const ids = {
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-ps0000000001",
  early: "aaaaaaaa-aaaa-4aaa-8aaa-ps0000000002",
  late: "aaaaaaaa-aaaa-4aaa-8aaa-ps0000000003",
};
const createdUserIds = Object.values(ids);
const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];

function asUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"] = "USER"): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@pstest.boostting.local`,
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
    email: `${id}@pstest.boostting.local`,
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
    else if (table === "RunSignupRole") await orm.RunSignupRole.where({ id }).delete();
    else if (table === "RunSignup") await orm.RunSignup.where({ id }).delete();
    else if (table === "Run") await orm.Run.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

async function createCharacter(userId: string, name: string) {
  const id = crypto.randomUUID();
  createdCharacterIds.push(id);
  await orm.Character.create({
    id,
    userId,
    name,
    realm: "Published Lab",
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity("Published Lab"),
    region: "EU",
    wowClass: "HUNTER",
    specialization: "Beast Mastery",
    primaryRole: "DPS",
    itemLevel: 700,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

async function cleanupRun(runId: string) {
  await orm.UserNotification.where({ runId }).delete().catch(() => {});
  await orm.RunAttendance.where({ runId }).delete().catch(() => {});
  await orm.RunStartSnapshot.where({ runId }).delete().catch(() => {});
  await orm.RunDiscordPost.where({ runId }).delete().catch(() => {});
  const roster = await orm.RunRoster.where({ runId }).first();
  if (roster) {
    const rosterId = (roster as { id: string }).id;
    await orm.RunRosterEntry.where({ rosterId }).delete().catch(() => {});
    await orm.RunExternalBooster.where({ rosterId }).delete().catch(() => {});
    await orm.RunRoster.where({ id: rosterId }).delete().catch(() => {});
  }
  const signups = await orm.RunSignup.where({ runId }).select("id").all();
  for (const row of signups) {
    const signupId = (row as { id: string }).id;
    await orm.RunSignupRole.where({ signupId }).delete().catch(() => {});
    await deleteIfPresent("RunSignup", signupId);
  }
  await deleteIfPresent("Run", runId);
}

const lead = asUser(ids.lead, "Published Signup Lead", "RAID_LEAD");
const early = asUser(ids.early, "Early Signer", "USER");
const late = asUser(ids.late, "Late Signer", "USER");

let earlyChar = "";
let lateChar = "";

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  for (const userId of createdUserIds) {
    const runs = await orm.Run.where({ raidLeadId: userId }).select("id").all();
    for (const row of runs) {
      await cleanupRun((row as { id: string }).id);
    }
    const chars = await orm.Character.where({ userId }).select("id").all();
    for (const row of chars) {
      await deleteIfPresent("Character", (row as { id: string }).id);
    }
    await deleteIfPresent("User", userId);
  }

  await createTestUser(ids.lead, "Published Signup Lead", "RAID_LEAD");
  await createTestUser(ids.early, "Early Signer", "USER");
  await createTestUser(ids.late, "Late Signer", "USER");
  await orm.User.where({ id: ids.early }).update({ isBooster: true });
  await orm.User.where({ id: ids.late }).update({ isBooster: true });
  earlyChar = await createCharacter(ids.early, "Psearlyhunt");
  lateChar = await createCharacter(ids.late, "Pslatehunt");
}, 60_000);

afterAll(async () => {
  for (const runId of createdRunIds) {
    await cleanupRun(runId);
  }
  for (const id of createdCharacterIds) {
    await deleteIfPresent("Character", id);
  }
  for (const id of createdUserIds) {
    await deleteIfPresent("User", id);
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
    const runId = await runService
      .createRun(
        lead,
        venomousCreateInput({
          difficulty: "HEROIC",
          lootType: "UNSAVED",
          venomousPlannedBossCount: 8,
          scheduledStartAt: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString(),
          desiredTankCount: 1,
          desiredHealerCount: 1,
          desiredDpsCount: 1,
        }),
      )
      .then((run) => run.id);
    createdRunIds.push(runId);
    await runService.openRun(lead, runId);

    await signupService.setCharacterOffers(early, {
      runId,
      offers: [{ characterId: earlyChar, offeredRoles: ["DPS"] }],
    });
    const earlyRows = await signupRepository.listByRunAndUser(runId, ids.early);
    const earlySignupId = earlyRows.find((row) => row.status === "PENDING")!.id;

    let view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections: [{ signupId: earlySignupId, selectedRole: "DPS" }],
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
      offers: [{ characterId: lateChar, offeredRoles: ["DPS"] }],
    });
    expect(booster.created + booster.reactivated).toBe(1);
    const lateBooster = (await signupRepository.listByRunAndUser(runId, ids.late)).find(
      (row) => row.participationType === "BOOSTER" && row.status !== "WITHDRAWN",
    );
    expect(lateBooster?.status).toBe("PENDING");

    // M — Lootbuddy signup after publish
    const loot = await signupService.setLootbuddies(late, {
      runId,
      lootbuddies: [{ wowClass: "WARLOCK", mode: "PLAYING" }],
    });
    expect(loot.created).toBe(1);

    // N — Quick Signup on a second published open run
    const quickRunId = await runService
      .createRun(
        lead,
        venomousCreateInput({
          difficulty: "HEROIC",
          lootType: "UNSAVED",
          venomousPlannedBossCount: 8,
          scheduledStartAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
          desiredTankCount: 1,
          desiredHealerCount: 1,
          desiredDpsCount: 1,
        }),
      )
      .then((run) => run.id);
    createdRunIds.push(quickRunId);
    await runService.openRun(lead, quickRunId);
    await runRepository.updateFields(quickRunId, { status: "PUBLISHED", signupsOpen: true });
    const quick = await signupService.quickSignupBoosters(late, { runId: quickRunId });
    expect(quick.added).toBeGreaterThan(0);

    // O — closed PUBLISHED rejects new offers
    await runService.setSignupWindow(lead, runId, false);
    await expectDomainCode(
      signupService.setLootbuddies(early, {
        runId,
        lootbuddies: [{ wowClass: "MAGE", mode: "LOOT_ONLY" }],
      }),
      "SIGNUP_CLOSED",
    );
    await expectDomainCode(signupService.quickSignupBoosters(early, { runId }), "SIGNUP_CLOSED");
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
        { signupId: earlySignupId, selectedRole: "DPS" },
        { signupId: lateBooster!.id, selectedRole: "DPS" },
      ],
    });
    const selectedFinal = (await signupRepository.listByRunId(runId)).filter((row) => row.status === "SELECTED");
    expect(selectedFinal.map((row) => row.id).sort()).toEqual([earlySignupId, lateBooster!.id].sort());

    // U — Discord Signup buttons enabled while PUBLISHED + open
    const openEmbed = await discordSyncService.getSignupEmbedData(runId);
    expect(openEmbed?.signupWindowOpen).toBe(true);
    expect(openEmbed?.runStatus).toBe("PUBLISHED");
    const openButtons = buildSignupButtons(openEmbed!).toJSON().components as Array<{
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
    await expectDomainCode(runService.setSignupWindow(lead, runId, true), "RUN_INVALID_TRANSITION");
    await expectDomainCode(
      signupService.setLootbuddies(early, {
        runId,
        lootbuddies: [{ wowClass: "PRIEST", mode: "PLAYING" }],
      }),
      "SIGNUP_CLOSED",
    );
    await expectDomainCode(signupService.quickSignupBoosters(early, { runId }), "SIGNUP_CLOSED");

    // V — Discord buttons disabled after Start
    const closedEmbed = await discordSyncService.getSignupEmbedData(runId);
    expect(closedEmbed?.signupWindowOpen).toBe(false);
    expect(closedEmbed?.runStatus).toBe("IN_PROGRESS");
    const closedButtons = buildSignupButtons(closedEmbed!).toJSON().components as Array<{
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
