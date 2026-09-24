import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import {
  rosterSelectedSourceKey,
  userNotificationRepository,
} from "@/repositories/user-notification.repository";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";
import { attendanceService } from "@/services/attendance.service";
import { discordSyncService } from "@/services/discord-sync.service";
import { renderFinalSetupText } from "@/lib/run-start-message";
import type { CharacterRole } from "@/models/enums";

const ids = {
  lead: "n2222222-2222-4222-8222-222222222201",
  admin: "n2222222-2222-4222-8222-222222222202",
  player: "n2222222-2222-4222-8222-222222222203",
  playerB: "n2222222-2222-4222-8222-222222222204",
};

const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdSignupIds: string[] = [];
const createdAccessIds: string[] = [];

let scheduleSlot = 0;
function futureIso(days = 12) {
  const slot = scheduleSlot++;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000 + slot * 3 * 60 * 60 * 1000).toISOString();
}

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
  discordUserId: string | null = null,
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@nroster.boostting.local`,
    image: null,
    discordUserId,
    discordUsername: discordUserId ? `u${discordUserId}` : null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function createTestUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"],
  opts: { discordUserId?: string | null; dmRosterSelectedEnabled?: boolean } = {},
) {
  await orm.User.create({
    id,
    name,
    email: `${id}@nroster.boostting.local`,
    emailVerified: true,
    discordUserId: opts.discordUserId ?? null,
    discordUsername: opts.discordUserId ? `u${opts.discordUserId}` : null,
    accountRole,
    accountStatus: "ACTIVE",
    discordDmEnabled: true,
    dmRosterSelectedEnabled: opts.dmRosterSelectedEnabled ?? true,
    dmRaidInviteEnabled: true,
    dmRunCancelledEnabled: true,
    dmRunRescheduledEnabled: true,
    dmRosterRemovedEnabled: true,
    timeZone: "Europe/Berlin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function createCharacter(input: {
  userId: string;
  name: string;
  wowClass: "SHAMAN" | "PALADIN" | "HUNTER" | "PRIEST";
  specialization: string;
  primaryRole: CharacterRole;
}) {
  const id = crypto.randomUUID();
  createdCharacterIds.push(id);
  await orm.Character.create({
    id,
    userId: input.userId,
    name: input.name,
    realm: "Notify Roster",
    normalizedName: normalizeCharacterIdentity(input.name),
    normalizedRealm: normalizeCharacterIdentity("Notify Roster"),
    region: "EU",
    wowClass: input.wowClass,
    specialization: input.specialization,
    primaryRole: input.primaryRole,
    itemLevel: 700,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

async function approveAccess(userId: string) {
  const existing = await orm.BoosterQualification.where({ userId, difficulty: "HEROIC" }).first();
  if (existing) {
    createdAccessIds.push(String((existing as { id: string }).id));
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  createdAccessIds.push(id);
  await orm.BoosterQualification.create({
    id,
    userId,
    difficulty: "HEROIC",
    status: "APPROVED",
    notes: "notify roster",
    grantedAt: now,
    grantedById: ids.admin,
    revokedAt: null,
    revokedById: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function createSignup(input: {
  runId: string;
  userId: string;
  characterId: string;
  role: CharacterRole;
}) {
  const id = crypto.randomUUID();
  createdSignupIds.push(id);
  const now = new Date().toISOString();
  await orm.RunSignup.create({
    id,
    runId: input.runId,
    userId: input.userId,
    characterId: input.characterId,
    participationType: "BOOSTER",
    isBackup: false,
    status: "PENDING",
    publishedRole: null,
    lootbuddyMode: null,
    lootbuddyVerification: null,
    createdAt: now,
    updatedAt: now,
  });
  await orm.RunSignupRole.create({
    id: crypto.randomUUID(),
    signupId: id,
    role: input.role,
    createdAt: now,
  });
  return id;
}

async function cleanupRun(runId: string) {
  const notes = await orm.UserNotification.where({ runId }).select("id").all();
  for (const row of notes) {
    await orm.UserNotification.where({ id: (row as { id: string }).id }).delete();
  }
  // Started Runs (external booster Final Setup test) carry attendance + a start snapshot.
  const attendance = await orm.RunAttendance.where({ runId }).select("id").all();
  for (const row of attendance) {
    await orm.RunAttendance.where({ id: (row as { id: string }).id }).delete();
  }
  const snapshot = await orm.RunStartSnapshot.where({ runId }).first();
  if (snapshot) await orm.RunStartSnapshot.where({ runId }).delete();
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
    const signupId = (row as { id: string }).id;
    const offered = await orm.RunSignupRole.where({ signupId }).select("id").all();
    for (const offer of offered) {
      await orm.RunSignupRole.where({ id: (offer as { id: string }).id }).delete();
    }
    await orm.RunSignup.where({ id: signupId }).delete();
  }
  await orm.Run.where({ id: runId }).delete();
}

async function cleanupAll() {
  for (const runId of [...createdRunIds]) {
    try {
      await cleanupRun(runId);
    } catch {
      // ignore
    }
  }
  createdRunIds.length = 0;
  for (const userId of Object.values(ids)) {
    const notes = await orm.UserNotification.where({ userId }).select("id").all();
    for (const row of notes) {
      await orm.UserNotification.where({ id: (row as { id: string }).id }).delete();
    }
    const signups = await orm.RunSignup.where({ userId }).select("id").all();
    for (const row of signups) {
      const signupId = (row as { id: string }).id;
      const offered = await orm.RunSignupRole.where({ signupId }).select("id").all();
      for (const offer of offered) {
        await orm.RunSignupRole.where({ id: (offer as { id: string }).id }).delete();
      }
      await orm.RunSignup.where({ id: signupId }).delete();
    }
    const access = await orm.BoosterQualification.where({ userId }).select("id").all();
    for (const row of access) {
      await orm.BoosterQualification.where({ id: (row as { id: string }).id }).delete();
    }
    const chars = await orm.Character.where({ userId }).select("id").all();
    for (const row of chars) {
      await orm.Character.where({ id: (row as { id: string }).id }).delete();
    }
    try {
      await orm.User.where({ id: userId }).delete();
    } catch {
      // ignore
    }
  }
}

const lead = asUser(ids.lead, "Notify Roster Lead", "RAID_LEAD");

let charPlayer = "";
let charPlayerB = "";
let charLeadTank = "";
let charLeadDps = "";

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await cleanupAll();
  await createTestUser(ids.lead, "Notify Roster Lead", "RAID_LEAD");
  await createTestUser(ids.admin, "Notify Roster Admin", "ADMIN");
  await createTestUser(ids.player, "Notify Player", "USER", {
    discordUserId: "900000000000000001",
    dmRosterSelectedEnabled: true,
  });
  await createTestUser(ids.playerB, "Notify Player B", "USER", {
    discordUserId: "900000000000000002",
    dmRosterSelectedEnabled: false,
  });
  await approveAccess(ids.player);
  await approveAccess(ids.playerB);
  await approveAccess(ids.lead);

  charPlayer = await createCharacter({
    userId: ids.player,
    name: "NRosterA",
    wowClass: "SHAMAN",
    specialization: "Restoration",
    primaryRole: "HEALER",
  });
  charPlayerB = await createCharacter({
    userId: ids.playerB,
    name: "NRosterB",
    wowClass: "PRIEST",
    specialization: "Holy",
    primaryRole: "HEALER",
  });
  charLeadTank = await createCharacter({
    userId: ids.lead,
    name: "NLeadTank",
    wowClass: "PALADIN",
    specialization: "Protection",
    primaryRole: "TANK",
  });
  charLeadDps = await createCharacter({
    userId: ids.lead,
    name: "NLeadDps",
    wowClass: "HUNTER",
    specialization: "Beast Mastery",
    primaryRole: "DPS",
  });
});

afterAll(async () => {
  await cleanupAll();
});

async function createPublishedReadyRun(desiredHealerCount = 1) {
  const created = await runService.createRun(
    lead,
    venomousCreateInput({
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: futureIso(),
      desiredTankCount: 1,
      desiredHealerCount,
      desiredDpsCount: 1,
    }),
  );
  createdRunIds.push(created.id);
  await runService.openRun(lead, created.id);
  return created.id;
}

describe("notification roster publish events", () => {
  it("does not notify on draft selection; notifies newly selected on publish with PENDING/SKIPPED", async () => {
    const runId = await createPublishedReadyRun(2);
    const tank = await createSignup({ runId, userId: ids.lead, characterId: charLeadTank, role: "TANK" });
    const dps = await createSignup({ runId, userId: ids.lead, characterId: charLeadDps, role: "DPS" });
    const healer = await createSignup({
      runId,
      userId: ids.player,
      characterId: charPlayer,
      role: "HEALER",
    });
    const healerB = await createSignup({
      runId,
      userId: ids.playerB,
      characterId: charPlayerB,
      role: "HEALER",
    });

    let view = await rosterService.getRosterManagementView(lead, runId);
    for (const signupId of [tank, dps, healer, healerB]) {
      view = await rosterService.getRosterManagementView(lead, runId);
      await rosterService.setDraftSelection(lead, {
        runId,
        signupId,
        selected: true,
        version: view.roster.version,
      });
    }

    const beforePublish = await orm.UserNotification.where({ runId }).all();
    expect(beforePublish).toHaveLength(0);

    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, {
      runId,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });

    const after = await userNotificationRepository.listForUser(ids.player, 20);
    const rosterNotes = after.filter((row) => row.runId === runId && row.type === "ROSTER_SELECTED");
    expect(rosterNotes).toHaveLength(1);
    expect(rosterNotes[0].discordDeliveryStatus).toBe("PENDING");
    expect(rosterNotes[0].discordUserId).toBe("900000000000000001");
    expect(rosterNotes[0].sourceKey).toBe(
      rosterSelectedSourceKey(runId, (await rosterService.getRosterManagementView(lead, runId)).roster.version, healer),
    );

    const skipped = (await userNotificationRepository.listForUser(ids.playerB, 20)).filter(
      (row) => row.runId === runId && row.type === "ROSTER_SELECTED",
    );
    expect(skipped).toHaveLength(1);
    expect(skipped[0].discordDeliveryStatus).toBe("SKIPPED");
    expect(skipped[0].discordUserId).toBeNull();
  });

  it("dedupes republish for already-selected signups and notifies on reselection after drop", async () => {
    const runId = await createPublishedReadyRun(1);
    const tank = await createSignup({ runId, userId: ids.lead, characterId: charLeadTank, role: "TANK" });
    const dps = await createSignup({ runId, userId: ids.lead, characterId: charLeadDps, role: "DPS" });
    const healer = await createSignup({
      runId,
      userId: ids.player,
      characterId: charPlayer,
      role: "HEALER",
    });
    const healerAlt = await createSignup({
      runId,
      userId: ids.playerB,
      characterId: charPlayerB,
      role: "HEALER",
    });

    let view = await rosterService.getRosterManagementView(lead, runId);
    for (const signupId of [tank, dps, healer]) {
      view = await rosterService.getRosterManagementView(lead, runId);
      await rosterService.setDraftSelection(lead, {
        runId,
        signupId,
        selected: true,
        version: view.roster.version,
      });
    }
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, {
      runId,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });

    const first = (await userNotificationRepository.listForUser(ids.player, 20)).filter(
      (row) => row.runId === runId && row.type === "ROSTER_SELECTED",
    );
    expect(first).toHaveLength(1);
    const firstSource = first[0].sourceKey;

    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.preparePublishedRosterForEditing(lead, {
      runId,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, {
      runId,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });

    const afterRepublish = (await userNotificationRepository.listForUser(ids.player, 20)).filter(
      (row) => row.runId === runId && row.type === "ROSTER_SELECTED",
    );
    expect(afterRepublish).toHaveLength(1);
    expect(afterRepublish[0].sourceKey).toBe(firstSource);

    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.preparePublishedRosterForEditing(lead, {
      runId,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.setDraftSelection(lead, {
      runId,
      signupId: healer,
      selected: false,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.setDraftSelection(lead, {
      runId,
      signupId: healerAlt,
      selected: true,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, {
      runId,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });

    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.preparePublishedRosterForEditing(lead, {
      runId,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.setDraftSelection(lead, {
      runId,
      signupId: healerAlt,
      selected: false,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.setDraftSelection(lead, {
      runId,
      signupId: healer,
      selected: true,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, {
      runId,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });

    const afterReselect = (await userNotificationRepository.listForUser(ids.player, 20)).filter(
      (row) => row.runId === runId && row.type === "ROSTER_SELECTED",
    );
    expect(afterReselect.length).toBeGreaterThanOrEqual(2);
    expect(afterReselect.some((row) => row.sourceKey !== firstSource)).toBe(true);
  });

  it("creates ROSTER_REMOVED when published SELECTED becomes NOT_SELECTED", async () => {
    const runId = await createPublishedReadyRun(1);
    const tank = await createSignup({ runId, userId: ids.lead, characterId: charLeadTank, role: "TANK" });
    const dps = await createSignup({ runId, userId: ids.lead, characterId: charLeadDps, role: "DPS" });
    const healer = await createSignup({
      runId,
      userId: ids.player,
      characterId: charPlayer,
      role: "HEALER",
    });
    const healerAlt = await createSignup({
      runId,
      userId: ids.playerB,
      characterId: charPlayerB,
      role: "HEALER",
    });

    let view = await rosterService.getRosterManagementView(lead, runId);
    for (const signupId of [tank, dps, healer]) {
      view = await rosterService.getRosterManagementView(lead, runId);
      await rosterService.setDraftSelection(lead, {
        runId,
        signupId,
        selected: true,
        version: view.roster.version,
      });
    }
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, {
      runId,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });

    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.preparePublishedRosterForEditing(lead, {
      runId,
      version: view.roster.version,
    });
    // Draft deselection alone must not notify.
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.setDraftSelection(lead, {
      runId,
      signupId: healer,
      selected: false,
      version: view.roster.version,
    });
    const midDraft = (await userNotificationRepository.listForUser(ids.player, 50)).filter(
      (row) => row.runId === runId && row.type === "ROSTER_REMOVED",
    );
    expect(midDraft).toHaveLength(0);

    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.setDraftSelection(lead, {
      runId,
      signupId: healerAlt,
      selected: true,
      version: view.roster.version,
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, {
      runId,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });

    const removed = (await userNotificationRepository.listForUser(ids.player, 50)).filter(
      (row) => row.runId === runId && row.type === "ROSTER_REMOVED",
    );
    expect(removed).toHaveLength(1);
    expect(removed[0].title).toBe("Removed from roster");
    expect(removed[0].discordDeliveryStatus).toBe("PENDING");

    const stillSelected = (await userNotificationRepository.listForUser(ids.playerB, 50)).filter(
      (row) => row.runId === runId && row.type === "ROSTER_REMOVED",
    );
    expect(stillSelected).toHaveLength(0);
  });

  it("Save Roster notifies selected players once; Publish afterwards does not repeat it", async () => {
    const runId = await createPublishedReadyRun(1);
    const tank = await createSignup({ runId, userId: ids.lead, characterId: charLeadTank, role: "TANK" });
    const healer = await createSignup({ runId, userId: ids.player, characterId: charPlayer, role: "HEALER" });
    const selections = [
      { signupId: tank, selectedRole: "TANK" as const },
      { signupId: healer, selectedRole: "HEALER" as const },
    ];
    const playerRosterNotes = async () =>
      (await userNotificationRepository.listForUser(ids.player, 50)).filter((row) => row.runId === runId);

    let view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, { runId, version: view.roster.version, selections });

    let notes = await playerRosterNotes();
    expect(notes.map((row) => row.type)).toEqual(["ROSTER_SELECTED"]);
    expect(notes[0].discordDeliveryStatus).toBe("PENDING");
    expect(notes[0].message).toContain("as Healer ·");

    // Saving the same selection again does not notify again.
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, { runId, version: view.roster.version, selections });
    // Neither does publishing what was already saved.
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, { runId, version: view.roster.version, acknowledgeWarnings: true });

    notes = await playerRosterNotes();
    expect(notes.map((row) => row.type)).toEqual(["ROSTER_SELECTED"]);
  });

  it("Save Roster that drops a notified player sends one removal; re-adding notifies again", async () => {
    const runId = await createPublishedReadyRun(1);
    const tank = await createSignup({ runId, userId: ids.lead, characterId: charLeadTank, role: "TANK" });
    const healer = await createSignup({ runId, userId: ids.player, characterId: charPlayer, role: "HEALER" });
    const healerAlt = await createSignup({ runId, userId: ids.playerB, characterId: charPlayerB, role: "HEALER" });
    const base: Array<{ signupId: string; selectedRole: "TANK" | "HEALER" | "DPS" }> = [
      { signupId: tank, selectedRole: "TANK" as const },
    ];
    const save = async (extra: typeof base) => {
      const view = await rosterService.getRosterManagementView(lead, runId);
      await rosterService.saveDraftSelection(lead, { runId, version: view.roster.version, selections: [...base, ...extra] });
    };
    const playerTypes = async () =>
      (await userNotificationRepository.listForUser(ids.player, 50))
        .filter((row) => row.runId === runId)
        .sort((a, b) => a.sourceKey.localeCompare(b.sourceKey, undefined, { numeric: true }))
        .map((row) => row.type);

    await save([{ signupId: healer, selectedRole: "HEALER" }]);
    await save([{ signupId: healerAlt, selectedRole: "HEALER" }]);
    await save([{ signupId: healerAlt, selectedRole: "HEALER" }]);

    const removed = (await userNotificationRepository.listForUser(ids.player, 50)).filter(
      (row) => row.runId === runId && row.type === "ROSTER_REMOVED",
    );
    expect(removed).toHaveLength(1);
    expect(removed[0].message).toContain("no longer in the roster");

    await save([{ signupId: healer, selectedRole: "HEALER" }]);
    const selectedAgain = (await userNotificationRepository.listForUser(ids.player, 50)).filter(
      (row) => row.runId === runId && row.type === "ROSTER_SELECTED",
    );
    expect(selectedAgain).toHaveLength(2);
    expect((await playerTypes()).length).toBe(3);

    // Publishing the saved state sends nothing new to either player.
    const view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, { runId, version: view.roster.version, acknowledgeWarnings: true });
    expect((await playerTypes()).length).toBe(3);
    const altNotes = (await userNotificationRepository.listForUser(ids.playerB, 50)).filter((row) => row.runId === runId);
    expect(altNotes.map((row) => row.type).sort()).toEqual(["ROSTER_REMOVED", "ROSTER_SELECTED"]);
  });

  it("master Discord DM OFF snapshots SKIPPED even when event toggle is ON", async () => {
    await orm.User.where({ id: ids.player }).update({
      discordDmEnabled: false,
      dmRosterSelectedEnabled: true,
      updatedAt: new Date().toISOString(),
    });
    const runId = await createPublishedReadyRun(1);
    const tank = await createSignup({ runId, userId: ids.lead, characterId: charLeadTank, role: "TANK" });
    const dps = await createSignup({ runId, userId: ids.lead, characterId: charLeadDps, role: "DPS" });
    const healer = await createSignup({
      runId,
      userId: ids.player,
      characterId: charPlayer,
      role: "HEALER",
    });
    let view = await rosterService.getRosterManagementView(lead, runId);
    for (const signupId of [tank, dps, healer]) {
      view = await rosterService.getRosterManagementView(lead, runId);
      await rosterService.setDraftSelection(lead, {
        runId,
        signupId,
        selected: true,
        version: view.roster.version,
      });
    }
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, {
      runId,
      version: view.roster.version,
      acknowledgeWarnings: true,
    });
    const notes = (await userNotificationRepository.listForUser(ids.player, 20)).filter(
      (row) => row.runId === runId && row.type === "ROSTER_SELECTED",
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].discordDeliveryStatus).toBe("SKIPPED");

    await orm.User.where({ id: ids.player }).update({
      discordDmEnabled: true,
      updatedAt: new Date().toISOString(),
    });
    const afterToggle = await userNotificationRepository.findById(notes[0].id);
    expect(afterToggle?.discordDeliveryStatus).toBe("SKIPPED");
  });
});

describe("external boosters (hand-added, not registered)", () => {
  it("are saved with Save Roster, count toward targets, show in Discord roster + Final Setup, and never notify", async () => {
    const runId = await createPublishedReadyRun(1);
    const tank = await createSignup({ runId, userId: ids.lead, characterId: charLeadTank, role: "TANK" });
    const healer = await createSignup({ runId, userId: ids.player, characterId: charPlayer, role: "HEALER" });
    const selections = [
      { signupId: tank, selectedRole: "TANK" as const },
      { signupId: healer, selectedRole: "HEALER" as const },
    ];

    let view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections,
      externalBoosters: [
        { name: "@dawn", wowClass: "MAGE", role: "DPS" },
        { name: "rogue guy", wowClass: "ROGUE", role: "DPS" },
      ],
    });

    view = await rosterService.getRosterManagementView(lead, runId);
    expect(view.roster.externalBoosters.map(({ name, wowClass, role }) => ({ name, wowClass, role }))).toEqual([
      { name: "dawn", wowClass: "MAGE", role: "DPS" },
      { name: "rogue guy", wowClass: "ROGUE", role: "DPS" },
    ]);
    expect(view.composition.dps.selected).toBe(2);

    // A save that omits externalBoosters (older client) leaves them alone.
    await rosterService.saveDraftSelection(lead, { runId, version: view.roster.version, selections });
    view = await rosterService.getRosterManagementView(lead, runId);
    expect(view.roster.externalBoosters).toHaveLength(2);

    // Signup embed "picked" lists include them.
    const signupEmbed = await discordSyncService.getSignupEmbedData(runId);
    expect(signupEmbed?.members.picked.dps.map((member) => member.userName)).toEqual(["dawn", "rogue guy"]);
    expect(signupEmbed?.roleStatus.dps.picked).toBe(2);

    await rosterService.publishRoster(lead, { runId, version: view.roster.version, acknowledgeWarnings: true });

    const published = await rosterService.getPublishedRosterView(runId);
    expect(published?.externalBoosters.map((booster) => [booster.name, booster.wowClass, booster.role])).toEqual([
      ["dawn", "MAGE", "DPS"],
      ["rogue guy", "ROGUE", "DPS"],
    ]);

    const rosterEmbed = await discordSyncService.getRosterEmbedData(runId);
    expect(rosterEmbed?.groups.rangedDps.map((member) => [member.userName, member.external])).toEqual([["dawn", true]]);
    expect(rosterEmbed?.groups.meleeDps.map((member) => [member.userName, member.external])).toEqual([
      ["rogue guy", true],
    ]);
    expect(rosterEmbed?.totalSelected).toBe(4);

    await runService.startRun(lead, { runId });
    const start = await discordSyncService.getRunStartEmbedData(runId);
    expect(start?.groups.dps.map((member) => [member.userName, member.discordUserId, member.wowClass])).toEqual([
      ["dawn", null, "MAGE"],
      ["rogue guy", null, "ROGUE"],
    ]);
    const finalSetup = renderFinalSetupText({
      raidName: start!.raidName,
      difficulty: start!.difficulty,
      lootType: start!.lootType,
      raidLeadDisplayName: start!.raidLeadDisplayName,
      targets: start!.targets,
      groups: start!.groups,
    });
    expect(finalSetup).toContain("@dawn Mage");

    const externalNotes = (await orm.UserNotification.where({ runId }).all()).filter(
      (row) => !(row as { signupId: string | null }).signupId,
    );
    expect(externalNotes).toHaveLength(0);
  });

  it("an empty list removes them; invalid names are rejected", async () => {
    const runId = await createPublishedReadyRun(1);
    const tank = await createSignup({ runId, userId: ids.lead, characterId: charLeadTank, role: "TANK" });
    const selections = [{ signupId: tank, selectedRole: "TANK" as const }];

    let view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections,
      externalBoosters: [{ name: "dawn", wowClass: "MAGE", role: "DPS" }],
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await expect(
      rosterService.saveDraftSelection(lead, {
        runId,
        version: view.roster.version,
        selections,
        externalBoosters: [{ name: "<@123>", wowClass: "MAGE", role: "DPS" }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_ROSTER_SELECTION" });
    await expect(
      rosterService.saveDraftSelection(lead, {
        runId,
        version: view.roster.version,
        selections,
        externalBoosters: [{ name: "dawn", wowClass: "MAGE", role: "TANK" }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_ROSTER_SELECTION" });

    await rosterService.saveDraftSelection(lead, { runId, version: view.roster.version, selections, externalBoosters: [] });
    view = await rosterService.getRosterManagementView(lead, runId);
    expect(view.roster.externalBoosters).toEqual([]);
  });
});

describe("picked player withdraws with a reason", () => {
  const player = asUser(ids.player, "Notify Roster Player", "USER", "900000000000000001");

  async function publishedRunWithPickedHealer() {
    const runId = await createPublishedReadyRun(1);
    const tank = await createSignup({ runId, userId: ids.lead, characterId: charLeadTank, role: "TANK" });
    const healer = await createSignup({ runId, userId: ids.player, characterId: charPlayer, role: "HEALER" });
    const view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections: [
        { signupId: tank, selectedRole: "TANK" },
        { signupId: healer, selectedRole: "HEALER" },
      ],
    });
    return { runId, tank, healer };
  }

  it("draft pick: plain withdraw asks for a reason; with one the slot frees and the Raid Lead is notified", async () => {
    const { runId, healer } = await publishedRunWithPickedHealer();
    const before = await rosterService.getRosterManagementView(lead, runId);

    await expect(signupService.withdrawSignup(player, healer)).rejects.toMatchObject({ code: "WITHDRAW_REASON_REQUIRED" });
    await expect(signupService.withdrawPickedSignup(player, { signupId: healer, reason: "  " })).rejects.toMatchObject({
      code: "WITHDRAW_REASON_REQUIRED",
    });
    expect((await orm.RunSignup.where({ id: healer }).first() as { status: string }).status).toBe("PENDING");

    await signupService.withdrawPickedSignup(player, { signupId: healer, reason: "Sick, sorry" });

    const row = (await orm.RunSignup.where({ id: healer }).first()) as { status: string; withdrawReason: string };
    expect(row.status).toBe("WITHDRAWN");
    expect(row.withdrawReason).toBe("Sick, sorry");
    const after = await rosterService.getRosterManagementView(lead, runId);
    expect(after.roster.version).toBe(before.roster.version + 1);
    expect(after.composition.healers.selected).toBe(0);

    const leadNotes = (await userNotificationRepository.listForUser(ids.lead, 50)).filter(
      (note) => note.runId === runId && note.type === "ROSTER_WITHDRAWN",
    );
    expect(leadNotes).toHaveLength(1);
    expect(leadNotes[0].message).toContain("Reason: Sick, sorry");
    expect(leadNotes[0].href).toBe(`/runs/${runId}?tab=roster`);
    // The player left on their own — no "removed from roster" DM for them.
    const playerRemoved = (await userNotificationRepository.listForUser(ids.player, 50)).filter(
      (note) => note.runId === runId && note.type === "ROSTER_REMOVED",
    );
    expect(playerRemoved).toHaveLength(0);
  });

  it("Discord cancel: picked without a reason writes nothing; with a reason withdraws and queues the Raid Lead DM", async () => {
    const { runId, healer } = await publishedRunWithPickedHealer();
    let view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, { runId, version: view.roster.version, acknowledgeWarnings: true });

    await expect(signupService.withdrawFromRun(player, { runId })).rejects.toMatchObject({ code: "WITHDRAW_REASON_REQUIRED" });
    expect((await orm.RunSignup.where({ id: healer }).first() as { status: string }).status).toBe("SELECTED");

    await orm.User.where({ id: ids.lead }).update({ discordUserId: "900000000000000099", updatedAt: new Date().toISOString() });
    try {
      const result = await signupService.withdrawFromRun(player, { runId, reason: "Work came up" });
      expect(result.withdrawn).toBe(1);
      const rosterEmbed = await discordSyncService.getRosterEmbedData(runId);
      expect(rosterEmbed?.groups.healers).toHaveLength(0);

      const work = await discordSyncService.listSyncWork();
      const dm = work.notificationDms.find((item) => item.runId === runId && item.type === "ROSTER_WITHDRAWN");
      expect(dm?.discordUserId).toBe("900000000000000099");
      expect(dm?.withdrawal).toMatchObject({ playerName: "Notify Player", reason: "Work came up" });
      expect(dm?.withdrawal?.rosterUrl?.endsWith(`/runs/${runId}?tab=roster`)).toBe(true);
    } finally {
      await orm.User.where({ id: ids.lead }).update({ discordUserId: null, updatedAt: new Date().toISOString() });
    }

    view = await rosterService.getRosterManagementView(lead, runId);
    expect(view.run.status).toBe("PUBLISHED");
  });

  it("after the Run started, a picked player can no longer withdraw", async () => {
    const { runId, healer } = await publishedRunWithPickedHealer();
    const view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, { runId, version: view.roster.version, acknowledgeWarnings: true });
    await runService.startRun(lead, { runId });

    await expect(signupService.withdrawPickedSignup(player, { signupId: healer, reason: "Sick" })).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
    await expect(signupService.withdrawFromRun(player, { runId, reason: "Sick" })).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });
});

describe("replace a participant after Start", () => {
  async function startedRunWithHealer() {
    const runId = await createPublishedReadyRun(1);
    const tank = await createSignup({ runId, userId: ids.lead, characterId: charLeadTank, role: "TANK" });
    const healer = await createSignup({ runId, userId: ids.player, characterId: charPlayer, role: "HEALER" });
    const bench = await createSignup({ runId, userId: ids.playerB, characterId: charPlayerB, role: "HEALER" });
    let view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections: [
        { signupId: tank, selectedRole: "TANK" },
        { signupId: healer, selectedRole: "HEALER" },
      ],
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, { runId, version: view.roster.version, acknowledgeWarnings: true });
    // The Final Setup was already posted in the Run channel.
    await discordSyncService.recordRunChannel({ runId, channelId: `chan-${runId}` });
    await runService.startRun(lead, { runId });
    await discordSyncService.recordStartPost({ runId, channelId: `chan-${runId}`, messageId: `start-${runId}` });
    const attendance = await attendanceService.getManagerAttendance(lead, runId);
    const healerRow = attendance.rows.find((row) => row.userName === "Notify Player")!;
    return { runId, healer, bench, healerRowId: healerRow.id };
  }

  it("a signed-up replacement: original No-show, replacement Present (full cut) + Raid Invite, Final Setup re-edited", async () => {
    const { runId, healer, bench, healerRowId } = await startedRunWithHealer();
    const before = await attendanceService.getManagerAttendance(lead, runId);
    expect(before.replacementCandidates.map((candidate) => candidate.signupId)).toEqual([bench]);
    let work = await discordSyncService.listSyncWork();
    expect(work.start?.some((item) => item.runId === runId)).toBe(false);

    await attendanceService.replaceParticipant(lead, {
      attendanceId: healerRowId,
      replacement: { kind: "signup", signupId: bench },
    });

    const after = await attendanceService.getManagerAttendance(lead, runId);
    const original = after.rows.find((row) => row.id === healerRowId)!;
    expect(original.status).toBe("NO_SHOW");
    expect(original.note).toMatch(/^Replaced by Notify Player B/);
    const stepIn = after.rows.find((row) => row.userName === "Notify Player B")!;
    expect(stepIn.status).toBe("PRESENT");
    expect(stepIn.selectedRole).toBe("HEALER");
    expect(stepIn.note).toBe("Replacement for Notify Player");

    const signups = await orm.RunSignup.where({ runId }).all();
    const statusOf = (id: string) => (signups.find((row) => (row as { id: string }).id === id) as { status: string }).status;
    expect(statusOf(healer)).toBe("NOT_SELECTED");
    expect(statusOf(bench)).toBe("SELECTED");

    const invites = (await userNotificationRepository.listForUser(ids.playerB, 50)).filter(
      (note) => note.runId === runId && note.type === "RAID_INVITE",
    );
    expect(invites).toHaveLength(1);

    const start = await discordSyncService.getRunStartEmbedData(runId);
    expect(start?.groups.healers.map((member) => member.userName)).toEqual(["Notify Player B"]);
    work = await discordSyncService.listSyncWork();
    const startItem = work.start?.find((item) => item.runId === runId);
    expect(startItem?.existingMessageId).toBe(`start-${runId}`);

    // Once the edit is recorded the post is current again.
    await discordSyncService.recordStartPost({ runId, channelId: `chan-${runId}`, messageId: `start-${runId}` });
    work = await discordSyncService.listSyncWork();
    expect(work.start?.some((item) => item.runId === runId)).toBe(false);
  });

  it("an external replacement joins the Final Setup only; the no-show gets no cut", async () => {
    const { runId, healerRowId } = await startedRunWithHealer();

    await attendanceService.replaceParticipant(lead, {
      attendanceId: healerRowId,
      replacement: { kind: "external", name: "@dawn", wowClass: "PRIEST", role: "HEALER" },
    });

    const after = await attendanceService.getManagerAttendance(lead, runId);
    expect(after.rows.find((row) => row.id === healerRowId)?.status).toBe("NO_SHOW");
    expect(after.externalBoosters.map((booster) => booster.name)).toEqual(["dawn"]);
    const start = await discordSyncService.getRunStartEmbedData(runId);
    expect(start?.groups.healers.map((member) => [member.userName, member.discordUserId])).toEqual([["dawn", null]]);

    await expect(
      attendanceService.replaceParticipant(lead, {
        attendanceId: healerRowId,
        replacement: { kind: "external", name: "dawn", wowClass: "MAGE", role: "HEALER" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ROSTER_SELECTION" });
  });

  it("only while the Run is in progress, and only by a manager", async () => {
    const { runId, bench, healerRowId } = await startedRunWithHealer();
    const player = asUser(ids.player, "Notify Player");
    await expect(
      attendanceService.replaceParticipant(player, {
        attendanceId: healerRowId,
        replacement: { kind: "signup", signupId: bench },
      }),
    ).rejects.toMatchObject({ code: "ATTENDANCE_NOT_MANAGEABLE" });

    await orm.Run.where({ id: runId }).update({ status: "COMPLETED", updatedAt: new Date().toISOString() });
    await expect(
      attendanceService.replaceParticipant(lead, {
        attendanceId: healerRowId,
        replacement: { kind: "signup", signupId: bench },
      }),
    ).rejects.toMatchObject({ code: "ATTENDANCE_NOT_MANAGEABLE" });
  });
});

describe("External Boosters dialog (saved on their own)", () => {
  it("saves the full set, bumps the roster version, keeps the signup draft, and locks after Start", async () => {
    const runId = await createPublishedReadyRun(1);
    const tank = await createSignup({ runId, userId: ids.lead, characterId: charLeadTank, role: "TANK" });
    let view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: view.roster.version,
      selections: [{ signupId: tank, selectedRole: "TANK" }],
    });

    view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.saveExternalBoosters(lead, {
      runId,
      version: view.roster.version,
      externalBoosters: [
        { name: "@dawn", wowClass: "MAGE", role: "DPS" },
        { name: "holy", wowClass: "PRIEST", role: "HEALER" },
      ],
    });
    const after = await rosterService.getRosterManagementView(lead, runId);
    expect(after.roster.version).toBe(view.roster.version + 1);
    expect(after.roster.externalBoosters.map((booster) => booster.name)).toEqual(["dawn", "holy"]);
    expect(after.composition.tanks.selected).toBe(1);
    expect(after.composition.healers.selected).toBe(1);

    // Stale version and invalid input are rejected.
    await expect(
      rosterService.saveExternalBoosters(lead, { runId, version: view.roster.version, externalBoosters: [] }),
    ).rejects.toMatchObject({ code: "ROSTER_ALREADY_CHANGED" });
    await expect(
      rosterService.saveExternalBoosters(lead, {
        runId,
        version: after.roster.version,
        externalBoosters: [{ name: "@everyone", wowClass: "MAGE", role: "DPS" }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_ROSTER_SELECTION" });
    await expect(
      rosterService.saveExternalBoosters(asUser(ids.player, "Notify Player"), {
        runId,
        version: after.roster.version,
        externalBoosters: [],
      }),
    ).rejects.toBeTruthy();

    // A later Save Roster from the builder (no externalBoosters field) leaves them alone.
    await rosterService.saveDraftSelection(lead, {
      runId,
      version: after.roster.version,
      selections: [{ signupId: tank, selectedRole: "TANK" }],
    });
    view = await rosterService.getRosterManagementView(lead, runId);
    expect(view.roster.externalBoosters).toHaveLength(2);

    await rosterService.publishRoster(lead, { runId, version: view.roster.version, acknowledgeWarnings: true });
    await runService.startRun(lead, { runId });
    view = await rosterService.getRosterManagementView(lead, runId);
    await expect(
      rosterService.saveExternalBoosters(lead, { runId, version: view.roster.version, externalBoosters: [] }),
    ).rejects.toMatchObject({ code: "INVALID_ROSTER_SELECTION" });
  });
});
