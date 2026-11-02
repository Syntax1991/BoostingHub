import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { mapActionError } from "@/lib/action-result";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { db, orm } from "@/lib/prisma";
import { runEditVersion } from "@/lib/run-edit-version";
import { venomousCreateInput, venomousUpdateInput, seededProductSelection } from "@tests/fixtures/test-run-input";
import type { CharacterRole, RaidDifficulty } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { lockRosterInTx, rosterRepository } from "@/repositories/roster.repository";
import { runDiscordPostRepository } from "@/repositories/run-discord-post.repository";
import { runRepository } from "@/repositories/run.repository";
import { userNotificationRepository } from "@/repositories/user-notification.repository";
import { getRunCommitmentsForCharacters } from "@/services/character-run-commitment";
import { discordSyncService } from "@/services/discord-sync.service";
import { rosterService } from "@/services/roster.service";
import { runDetailService } from "@/services/run-detail.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";
import { currentWeekFutureIso } from "@tests/fixtures/time";
import { updateRunSchema } from "@/validators/run";
import { testActor } from "@tests/fixtures/actors";
import {
  assertIsolatedTestDatabase,
  createTestUser,
  deleteCreatedRows,
} from "@tests/fixtures/db-fixtures";

/** Commitments of one Character as seen from a Run in the same raid ID as `runId` (excluding `excludeRunId`). */
async function commitmentsInRaidIdOf(runId: string, characterId: string, excludeRunId: string) {
  const run = (await orm.Run.where({ id: runId }).first()) as { scheduledStartAt: string };
  const character = (await orm.Character.where({ id: characterId }).first()) as { region: "EU" | "US" };
  return (
    await getRunCommitmentsForCharacters({
      characters: [{ id: characterId, region: character.region }],
      excludeRunId,
      targetScheduledStartAt: new Date(run.scheduledStartAt).toISOString(),
    })
  ).get(characterId);
}

/**
 * Flexible pre-start Run management: Run edits until Start (signup history
 * never locks), roster acknowledgement (runChangedSinceAck), Save / Update /
 * Publish semantics and the explicit Discord roster repost (postRevision).
 */

const created = {
  userIds: [] as string[],
  characterIds: [] as string[],
  runIds: [] as string[],
};

let lead: AuthenticatedUser;
let admin: AuthenticatedUser;
let otherLead: AuthenticatedUser;
let userA: AuthenticatedUser;
let userB: AuthenticatedUser;
let userC: AuthenticatedUser;
let notApproved: AuthenticatedUser;
let heroicHealer: AuthenticatedUser;
let revocable: AuthenticatedUser;

const CHAN = "fx-run-chan";

async function createUser(name: string, accountRole: AuthenticatedUser["accountRole"] = "USER") {
  const id = await createTestUser({ name, accountRole });
  created.userIds.push(id);
  return testActor(id, accountRole, { name });
}

/** Account-level Booster role — on the User, not scoped by difficulty. */
async function approve(userId: string, isBooster = true) {
  await orm.User.where({ id: userId }).update({ isBooster });
}

let seq = 0;
async function createCharacter(userId: string, wowClass: "PRIEST" | "PALADIN") {
  const id = crypto.randomUUID();
  const name = `Fx${userId.slice(-3)}${seq++}`;
  const now = new Date().toISOString();
  await orm.Character.create({
    id,
    userId,
    name,
    realm: "Flex",
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity("Flex"),
    region: "EU",
    wowClass,
    specialization: wowClass === "PRIEST" ? "Holy" : "Protection",
    primaryRole: wowClass === "PRIEST" ? "HEALER" : "TANK",
    itemLevel: 700,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  created.characterIds.push(id);
  return id;
}

async function createSignup(runId: string, userId: string, characterId: string, roles: CharacterRole[]) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.RunSignup.create({
    id,
    runId,
    userId,
    characterId,
    participationType: "BOOSTER",
    isBackup: false,
    status: "PENDING",
    publishedRole: null,
    lootbuddyMode: null,
    lootbuddyVerification: null,
    createdAt: now,
    updatedAt: now,
  });
  for (const role of roles) {
    await orm.RunSignupRole.create({ id: crypto.randomUUID(), signupId: id, role, createdAt: now });
  }
  return id;
}

let slot = 0;
function futureIso() {
  return new Date(Date.now() + 20 * 24 * 3600_000 + slot++ * 3 * 3600_000).toISOString();
}

async function createOpenRun(difficulty: RaidDifficulty = "HEROIC", actor = lead) {
  const run = await runService.createRun(
    actor,
    venomousCreateInput({ scheduledStartAt: futureIso(), difficulty, desiredTankCount: 1, desiredHealerCount: 1, desiredDpsCount: 0 }),
  );
  created.runIds.push(run.id);
  await runService.openRun(actor, run.id);
  return run.id;
}

const view = (runId: string, actor = lead) => rosterService.getRosterManagementView(actor, runId);

async function saveDraft(runId: string, selections: Array<{ signupId: string; selectedRole: CharacterRole | null }>) {
  const current = await view(runId);
  await rosterService.saveDraftSelection(lead, { runId, version: current.roster.version, selections });
}

async function publish(runId: string) {
  const current = await view(runId);
  await rosterService.publishRoster(lead, { runId, version: current.roster.version, acknowledgeWarnings: true });
}

async function update(runId: string, selections: Array<{ signupId: string; selectedRole: CharacterRole | null }>) {
  const current = await view(runId);
  await rosterService.updateRoster(lead, { runId, version: current.roster.version, selections, acknowledgeWarnings: true });
}

/** The currently accepted (published) lineup, as Update Roster input. */
async function publishedSelections(runId: string) {
  return (await view(runId)).boosters
    .filter((row) => row.status === "SELECTED")
    .map((row) => ({ signupId: row.id, selectedRole: row.publishedRole }));
}

async function repost(runId: string) {
  const current = await view(runId);
  return rosterService.repostRoster(lead, { runId, version: current.roster.version, postRevision: current.roster.postRevision });
}

/**
 * One simulated bot pass over this Run's roster lane, recorded exactly like
 * the bot: edit the persistent Roster message when it exists; send only when
 * missing. POST additionally records the fulfilled postRevision.
 */
const sent: Record<string, string[]> = {};
async function botPass(runId: string): Promise<{ mode: "POST" | "REFRESH"; messageId: string } | null> {
  const item = (await discordSyncService.listSyncWork()).roster.find((row) => row.runId === runId);
  if (!item) return null;
  if (!item.existingMessageId) {
    const messageId = `${runId.slice(-4)}-M${(sent[runId]?.length ?? 0) + 1}`;
    (sent[runId] ??= []).push(messageId);
    await discordSyncService.recordRosterPost({
      runId,
      channelId: CHAN,
      messageId,
      ...(typeof item.postRevision === "number" ? { postRevision: item.postRevision } : {}),
    });
    return { mode: item.mode === "POST" ? "POST" : "REFRESH", messageId };
  }
  await discordSyncService.recordRosterPost({
    runId,
    channelId: CHAN,
    messageId: item.existingMessageId,
    ...(typeof item.postRevision === "number" ? { postRevision: item.postRevision } : {}),
  });
  return { mode: item.mode === "POST" ? "POST" : "REFRESH", messageId: item.existingMessageId };
}

async function currentRosterMessageId(runId: string) {
  return (await runDiscordPostRepository.findByRunId(runId))?.rosterMessageId ?? null;
}

let aChar = "";
let bChar = "";
let cChar = "";
let notApprovedChar = "";
let revocableChar = "";
let heroicChar = "";

/** OPEN Run with a Run channel; A (HEALER) + C (TANK) published; first roster message posted. */
async function publishedRunWithPost(difficulty: RaidDifficulty = "HEROIC") {
  const runId = await createOpenRun(difficulty);
  await discordSyncService.recordRunChannel({ runId, channelId: CHAN });
  const aSignup = await createSignup(runId, userA.id, aChar, ["HEALER"]);
  const cSignup = await createSignup(runId, userC.id, cChar, ["TANK"]);
  await saveDraft(runId, [
    { signupId: aSignup, selectedRole: "HEALER" },
    { signupId: cSignup, selectedRole: "TANK" },
  ]);
  await publish(runId);
  const first = await botPass(runId);
  return { runId, aSignup, cSignup, firstMessageId: first!.messageId };
}

async function cleanupRuns() {
  assertIsolatedTestDatabase();
  const runIds = created.runIds.splice(0);
  for (const userId of created.userIds) {
    const runs = (await orm.Run.where({ raidLeadId: userId }).select("id").all()) as Array<{ id: string }>;
    for (const run of runs) if (!runIds.includes(run.id)) runIds.push(run.id);
  }
  await deleteCreatedRows({ runIds });
}

async function cleanupAll() {
  assertIsolatedTestDatabase();
  await cleanupRuns();
  for (const userId of created.userIds) {
    await orm.UserNotification.where({ userId }).deleteAndCount();
  }
  await deleteCreatedRows({
    characterIds: created.characterIds.splice(0),
    userIds: created.userIds.splice(0),
  });
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  await raidRepository.ensureReferenceRaids();
  lead = await createUser("Fx Lead", "RAID_LEAD");
  admin = await createUser("Fx Admin", "ADMIN");
  otherLead = await createUser("Fx Other Lead", "RAID_LEAD");
  userA = await createUser("Fx A");
  userB = await createUser("Fx B");
  userC = await createUser("Fx C");
  notApproved = await createUser("Fx Not Approved");
  heroicHealer = await createUser("Fx Heroic Healer");
  revocable = await createUser("Fx Revocable");
  for (const user of [userA, userB, userC, heroicHealer, revocable]) {
    await approve(user.id);
  }
  await approve(notApproved.id, false);
  aChar = await createCharacter(userA.id, "PRIEST");
  bChar = await createCharacter(userB.id, "PRIEST");
  cChar = await createCharacter(userC.id, "PALADIN");
  notApprovedChar = await createCharacter(notApproved.id, "PRIEST");
  heroicChar = await createCharacter(heroicHealer.id, "PRIEST");
  revocableChar = await createCharacter(revocable.id, "PRIEST");
}, 60_000);

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupRuns();
});

afterAll(cleanupAll, 60_000);

describe("Run editing until Start", () => {
  it("DRAFT / OPEN (with signups) / ROSTERING / PUBLISHED are editable; IN_PROGRESS / COMPLETED / CANCELLED are locked; signups survive", async () => {
    const draft = await runService.createRun(lead, venomousCreateInput({ scheduledStartAt: futureIso() }));
    await runService.updateRun(lead, venomousUpdateInput(draft.id, (await runRepository.findById(draft.id))!, { difficulty: "NORMAL" }));
    expect((await runRepository.findById(draft.id))?.difficulty).toBe("NORMAL");

    const runId = await createOpenRun("NORMAL");
    const signup = await createSignup(runId, userA.id, aChar, ["HEALER"]);
    await runService.updateRun(lead, venomousUpdateInput(runId, (await runRepository.findById(runId))!, { difficulty: "HEROIC" }));
    expect((await runRepository.findById(runId))?.difficulty).toBe("HEROIC");

    await saveDraft(runId, [{ signupId: signup, selectedRole: "HEALER" }]);
    expect((await runRepository.findById(runId))?.status).toBe("ROSTERING");
    await runService.updateRun(lead, venomousUpdateInput(runId, (await runRepository.findById(runId))!, { plannedBossCount: 6 }));

    await publish(runId);
    await runService.updateRun(lead, venomousUpdateInput(runId, (await runRepository.findById(runId))!, { lootType: "VIP" }));
    expect((await runRepository.findById(runId))?.lootType).toBe("VIP");
    expect((await runRepository.findById(runId))?.status).toBe("PUBLISHED");
    expect(await orm.RunSignup.where({ runId }).all()).toHaveLength(1);

    for (const status of ["IN_PROGRESS", "COMPLETED", "CANCELLED"] as const) {
      await orm.Run.where({ id: runId }).update({ status, updatedAt: new Date().toISOString() });
      await expect(
        runService.updateRun(lead, venomousUpdateInput(runId, (await runRepository.findById(runId))!, { lootType: "UNSAVED" })),
      ).rejects.toMatchObject({ code: "RUN_EDIT_LOCKED" });
    }
    expect((await runRepository.findById(runId))?.lootType).toBe("VIP");
  });

  it("MYTHIC + SAVED stays invalid", async () => {
    const runId = await createOpenRun("HEROIC");
    await expect(
      runService.updateRun(lead, venomousUpdateInput(runId, (await runRepository.findById(runId))!, { difficulty: "MYTHIC", lootType: "SAVED" })),
    ).rejects.toMatchObject({ code: "RUN_LOOT_TYPE_INVALID" });
  });
});

describe("roster acknowledgement after Run edits (runChangedSinceAck)", () => {
  it("each roster-relevant field marks a published roster changed without bumping the version; Start waits; Update clears it", async () => {
    const { runId } = await publishedRunWithPost();
    const relevantEdits: Array<Record<string, unknown>> = [
      { ...seededProductSelection("MIDNIGHT_S2_BUNDLE"), },
      { ...seededProductSelection("VENOMOUS_ABYSS"), plannedBossCount: 5 },
      { scheduledStartAt: futureIso() },
      { lootType: "VIP" },
      { lootType: "COMMUNITY" },
      { desiredTankCount: 2 },
      { desiredHealerCount: 2 },
      { desiredDpsCount: 3 },
      { difficulty: "NORMAL" },
    ];
    for (const overrides of relevantEdits) {
      const before = await view(runId);
      expect(before.roster.hasUnpublishedChanges).toBe(false);
      await runService.updateRun(lead, venomousUpdateInput(runId, (await runRepository.findById(runId))!, overrides));
      const after = await view(runId);
      expect(after.roster.runChangedSinceAck, JSON.stringify(overrides)).toBe(true);
      expect(after.roster.hasUnpublishedChanges).toBe(true);
      expect(after.roster.version).toBe(before.roster.version);
      expect((await runRepository.findById(runId))?.status).toBe("PUBLISHED");
      await expect(runService.startRun(lead, { runId })).rejects.toMatchObject({ code: "ROSTER_UNPUBLISHED_CHANGES" });
      await update(runId, await publishedSelections(runId));
      expect((await view(runId)).roster.runChangedSinceAck).toBe(false);
    }
  });

  it("notes and the role-ping flag change nothing roster-related; an ADMIN Raid Lead change only refreshes the embed", async () => {
    const { runId } = await publishedRunWithPost();
    let before = await view(runId);
    await runService.updateRun(lead, venomousUpdateInput(runId, (await runRepository.findById(runId))!, { notes: "bring flasks", discordRolePing: false }));
    let after = await view(runId);
    expect(after.roster.runChangedSinceAck).toBe(false);
    expect(after.roster.version).toBe(before.roster.version);
    expect(await botPass(runId)).toBeNull();

    before = after;
    await runService.updateRun(admin, venomousUpdateInput(runId, (await runRepository.findById(runId))!, { raidLeadId: otherLead.id }));
    after = await rosterService.getRosterManagementView(admin, runId);
    expect(after.roster.runChangedSinceAck).toBe(false);
    expect(after.roster.version).toBe(before.roster.version + 1);
    // The title (with the lead's name) changed → the CURRENT roster message is refreshed, not reposted.
    const pass = await botPass(runId);
    expect(pass?.mode).toBe("REFRESH");
    expect(sent[runId]).toHaveLength(1);
  });
});

describe("NORMAL → HEROIC on a published roster", () => {
  it("keeps signups, lineup and account-level booster approval, recalculates access, blocks Start and Update until a revoked booster is replaced, then Update edits the same message and Start succeeds", async () => {
    const runId = await createOpenRun("NORMAL");
    await discordSyncService.recordRunChannel({ runId, channelId: CHAN });
    const tankSignup = await createSignup(runId, userC.id, cChar, ["TANK"]);
    const normalSignup = await createSignup(runId, revocable.id, revocableChar, ["HEALER"]);
    await saveDraft(runId, [
      { signupId: tankSignup, selectedRole: "TANK" },
      { signupId: normalSignup, selectedRole: "HEALER" },
    ]);
    await publish(runId);
    const m1 = (await botPass(runId))!.messageId;

    await runService.updateRun(lead, venomousUpdateInput(runId, (await runRepository.findById(runId))!, { difficulty: "HEROIC" }));

    // The Booster role is account-level: the difficulty change alone keeps every booster approved.
    let current = await view(runId);
    expect(current.boosters.find((row) => row.id === tankSignup)).toMatchObject({ boosterApproved: true });
    expect(current.boosters.find((row) => row.id === normalSignup)).toMatchObject({ boosterApproved: true });

    // Revoking the healer's Booster role is what now makes the lineup invalid.
    await orm.User.where({ id: revocable.id }).update({ isBooster: false });

    current = await view(runId);
    const normalRow = current.boosters.find((row) => row.id === normalSignup)!;
    expect(normalRow).toMatchObject({ status: "SELECTED", draftSelected: true, boosterApproved: false });
    expect(normalRow.issue).toBe("Owner no longer has the Booster role.");
    expect(current.roster.runChangedSinceAck).toBe(true);
    expect(current.roster.hasUnpublishedChanges).toBe(true);
    await expect(runService.startRun(lead, { runId })).rejects.toMatchObject({ code: "ROSTER_UNPUBLISHED_CHANGES" });

    // Update with the revoked healer is refused; nothing changes.
    await expect(update(runId, await publishedSelections(runId))).rejects.toMatchObject({ code: "ROSTER_VALIDATION_FAILED" });
    current = await view(runId);
    expect(current.roster.runChangedSinceAck).toBe(true);
    expect(current.boosters.find((row) => row.id === normalSignup)?.status).toBe("SELECTED");

    // Replace with an approved healer and Update once.
    const heroicSignup = await createSignup(runId, heroicHealer.id, heroicChar, ["HEALER"]);
    await update(runId, [
      { signupId: tankSignup, selectedRole: "TANK" },
      { signupId: heroicSignup, selectedRole: "HEALER" },
    ]);
    current = await view(runId);
    expect(current.roster.runChangedSinceAck).toBe(false);
    expect(current.roster.hasUnpublishedChanges).toBe(false);
    expect(current.boosters.find((row) => row.id === normalSignup)?.status).toBe("NOT_SELECTED");
    expect(await orm.RunSignup.where({ id: normalSignup }).first()).toBeTruthy(); // signup kept

    const pass = await botPass(runId);
    expect(pass).toEqual({ mode: "REFRESH", messageId: m1 });
    expect(sent[runId]).toEqual([m1]);

    await runService.startRun(lead, { runId });
    const run = await runRepository.findById(runId);
    expect(run).toMatchObject({ status: "IN_PROGRESS", difficulty: "HEROIC" });
    const attended = (await orm.RunAttendance.where({ runId }).include("rosterEntry").all()).map(
      (row) => ((row as Record<string, unknown>).rosterEntry as Record<string, unknown>).signupId,
    );
    expect(attended.sort()).toEqual([tankSignup, heroicSignup].sort());
  });
});

describe("Save / Update / Publish and the Discord roster message", () => {
  it("first Save refreshes the Roster message; first Publish edits the same message (postRevision 0 → 1)", async () => {
    const runId = await createOpenRun();
    await discordSyncService.recordRunChannel({ runId, channelId: CHAN });
    const aSignup = await createSignup(runId, userA.id, aChar, ["HEALER"]);
    await saveDraft(runId, [{ signupId: aSignup, selectedRole: "HEALER" }]);
    let current = await view(runId);
    expect(current.roster.publishedAt).toBeNull();
    expect(current.run.status).not.toBe("PUBLISHED");
    expect(current.roster.postRevision).toBe(0);
    // Draft picks maintain the separate Roster Discord message (REFRESH until Publish).
    const draftPass = await botPass(runId);
    expect(draftPass?.mode).toBe("REFRESH");
    expect(await currentRosterMessageId(runId)).toBe(draftPass?.messageId);
    const draftMessageId = draftPass!.messageId;

    await publish(runId);
    current = await view(runId);
    expect(current.run.status).toBe("PUBLISHED");
    expect(current.roster.publishedAt).not.toBeNull();
    expect(current.roster.runChangedSinceAck).toBe(false);
    expect(current.roster.postRevision).toBe(1);
    const first = await botPass(runId);
    expect(first).toEqual({ mode: "POST", messageId: draftMessageId });
    expect(await currentRosterMessageId(runId)).toBe(draftMessageId);
    expect((await runDiscordPostRepository.findByRunId(runId))?.lastRosterPostRevision).toBe(1);
    expect(await botPass(runId)).toBeNull(); // poll after recording: nothing more
  });

  it("Update edits M1 in place — three times — and never posts; Save on a published roster also only refreshes", async () => {
    const { runId, aSignup, cSignup, firstMessageId } = await publishedRunWithPost();
    const bSignup = await createSignup(runId, userB.id, bChar, ["HEALER"]);

    for (const healer of [bSignup, aSignup, bSignup]) {
      const before = await view(runId);
      await update(runId, [
        { signupId: cSignup, selectedRole: "TANK" },
        { signupId: healer, selectedRole: "HEALER" },
      ]);
      const after = await view(runId);
      expect(after.roster.version).toBe(before.roster.version + 1);
      expect(after.roster.hasUnpublishedChanges).toBe(false);
      expect(after.run.status).toBe("PUBLISHED");
      expect(after.boosters.find((row) => row.id === healer)?.status).toBe("SELECTED");
      expect(await botPass(runId)).toEqual({ mode: "REFRESH", messageId: firstMessageId });
    }

    await saveDraft(runId, [{ signupId: cSignup, selectedRole: "TANK" }]);
    expect(await botPass(runId)).toEqual({ mode: "REFRESH", messageId: firstMessageId });
    expect(sent[runId]).toEqual([firstMessageId]);
    expect(await currentRosterMessageId(runId)).toBe(firstMessageId);
  });

  it("Update is atomic: a refused Update leaves the published roster, the draft and the dirty state untouched", async () => {
    const { runId, aSignup, cSignup } = await publishedRunWithPost();
    await runService.updateRun(lead, venomousUpdateInput(runId, (await runRepository.findById(runId))!, { lootType: "VIP" }));
    const normalSignup = await createSignup(runId, notApproved.id, notApprovedChar, ["HEALER"]);
    const before = await view(runId);
    await expect(
      update(runId, [
        { signupId: cSignup, selectedRole: "TANK" },
        { signupId: normalSignup, selectedRole: "HEALER" },
      ]),
    ).rejects.toMatchObject({ code: "ROSTER_VALIDATION_FAILED" });
    const after = await view(runId);
    expect(after.roster.version).toBe(before.roster.version);
    expect(after.roster.runChangedSinceAck).toBe(true);
    expect(after.boosters.find((row) => row.id === aSignup)).toMatchObject({ status: "SELECTED", draftSelected: true });
    expect(after.boosters.find((row) => row.id === normalSignup)).toMatchObject({ status: "PENDING", draftSelected: false });
  });

  it("explicit Publish edits the same Roster message in place; Update keeps that id; republish never appends history", async () => {
    const { runId, cSignup, firstMessageId } = await publishedRunWithPost();
    const notificationsBefore = (await userNotificationRepository.listForUser(userA.id, 100)).length;
    const lineupBefore = await publishedSelections(runId);

    expect(await repost(runId)).toEqual({ postRevision: 2 });
    let pass = await botPass(runId);
    expect(pass).toEqual({ mode: "POST", messageId: firstMessageId });
    expect(await currentRosterMessageId(runId)).toBe(firstMessageId);
    expect(await botPass(runId)).toBeNull();
    // A republish changes no membership/roles and notifies nobody.
    expect(await publishedSelections(runId)).toEqual(lineupBefore);
    expect((await userNotificationRepository.listForUser(userA.id, 100)).length).toBe(notificationsBefore);

    const bSignup = await createSignup(runId, userB.id, bChar, ["HEALER"]);
    await update(runId, [
      { signupId: cSignup, selectedRole: "TANK" },
      { signupId: bSignup, selectedRole: "HEALER" },
    ]);
    expect(await botPass(runId)).toEqual({ mode: "REFRESH", messageId: firstMessageId });

    expect(await repost(runId)).toEqual({ postRevision: 3 });
    pass = await botPass(runId);
    expect(pass).toEqual({ mode: "POST", messageId: firstMessageId });
    expect(await currentRosterMessageId(runId)).toBe(firstMessageId);
    expect(sent[runId]).toHaveLength(1); // only the original create — Publish never appends
    await update(runId, await publishedSelections(runId));
    expect(await botPass(runId)).toEqual({ mode: "REFRESH", messageId: firstMessageId });
  });

  it("Publish cannot bypass unpublished changes: a dirty published roster must be updated first", async () => {
    const { runId } = await publishedRunWithPost();
    await runService.updateRun(lead, venomousUpdateInput(runId, (await runRepository.findById(runId))!, { lootType: "VIP" }));
    await expect(repost(runId)).rejects.toMatchObject({ code: "ROSTER_UNPUBLISHED_CHANGES" });
    expect((await view(runId)).roster.runChangedSinceAck).toBe(true);
    await update(runId, await publishedSelections(runId));
    expect(await repost(runId)).toEqual({ postRevision: 2 });
  });

  it("double-submitted Publish with the same expected postRevision advances it once and syncs once", async () => {
    const { runId, firstMessageId } = await publishedRunWithPost();
    const current = await view(runId);
    const request = () =>
      rosterService.repostRoster(lead, { runId, version: current.roster.version, postRevision: current.roster.postRevision });
    const results = await Promise.allSettled([request(), request()]);
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(results.find((row) => row.status === "rejected")).toMatchObject({ reason: { code: "ROSTER_ALREADY_CHANGED" } });
    expect((await view(runId)).roster.postRevision).toBe(2);
    expect(await botPass(runId)).toEqual({ mode: "POST", messageId: firstMessageId });
    expect(await botPass(runId)).toBeNull();
    expect(sent[runId]).toEqual([firstMessageId]);
  });

  it("legacy roster message (postRevision 0, fulfilled null) is never auto-POSTed; refresh edits it; Publish edits the same id", async () => {
    const { runId } = await publishedRunWithPost();
    await orm.RunRoster.where({ runId }).update({ postRevision: 0, updatedAt: new Date().toISOString() });
    await orm.RunDiscordPost.where({ runId }).update({ lastRosterPostRevision: null, rosterMessageId: "legacy-msg", updatedAt: new Date().toISOString() });
    expect(await botPass(runId)).toBeNull();

    await update(runId, await publishedSelections(runId)); // version bump
    expect(await botPass(runId)).toEqual({ mode: "REFRESH", messageId: "legacy-msg" });

    expect(await repost(runId)).toEqual({ postRevision: 1 });
    const pass = await botPass(runId);
    expect(pass).toEqual({ mode: "POST", messageId: "legacy-msg" });
    expect(await currentRosterMessageId(runId)).toBe("legacy-msg");
  });

  it("Run edit + Update and Add Booster + Update keep the message id; an explicit Publish afterwards still edits the same id", async () => {
    const { runId, firstMessageId } = await publishedRunWithPost();
    await runService.updateRun(lead, venomousUpdateInput(runId, (await runRepository.findById(runId))!, { desiredDpsCount: 2 }));
    expect(await botPass(runId)).toBeNull(); // the edit alone does not touch Discord
    await update(runId, await publishedSelections(runId));
    expect(await botPass(runId)).toEqual({ mode: "REFRESH", messageId: firstMessageId });

    const version = (await view(runId)).roster.version;
    await rosterService.addRegisteredParticipant(lead, { runId, version, userId: userB.id, characterId: bChar, role: "HEALER" });
    expect((await view(runId)).roster.hasUnpublishedChanges).toBe(true);
    expect((await botPass(runId))?.mode).not.toBe("POST");
    const draft = (await view(runId)).boosters.filter((row) => row.draftSelected).map((row) => ({ signupId: row.id, selectedRole: row.selectedRole }));
    await update(runId, draft);
    expect(await botPass(runId)).toEqual({ mode: "REFRESH", messageId: firstMessageId });
    expect(sent[runId]).toEqual([firstMessageId]);

    await repost(runId);
    expect(await botPass(runId)).toEqual({ mode: "POST", messageId: firstMessageId });
    expect(sent[runId]).toEqual([firstMessageId]);
  });

  it("commitments: a repost does not change them; Update reconciles RESERVED → COMMITTED", async () => {
    const { runId } = await publishedRunWithPost();
    const other = await createOpenRun("HEROIC", lead);
    const version = (await view(runId)).roster.version;
    await rosterService.addRegisteredParticipant(lead, { runId, version, userId: userB.id, characterId: bChar, role: "HEALER" });
    const reserved = (await commitmentsInRaidIdOf(runId, bChar, other));
    expect(reserved?.find((row) => row.runId === runId)?.state).toBe("RESERVED");
    const draft = (await view(runId)).boosters.filter((row) => row.draftSelected).map((row) => ({ signupId: row.id, selectedRole: row.selectedRole }));
    await update(runId, draft);
    const committed = (await commitmentsInRaidIdOf(runId, bChar, other));
    expect(committed?.find((row) => row.runId === runId)?.state).toBe("COMMITTED");
    await repost(runId);
    expect((await commitmentsInRaidIdOf(runId, bChar, other))).toEqual(committed);
  });

  it("Signup-provisioned empty Roster: create once, clear picks edits empty state, never deletes or duplicates", async () => {
    // CURRENT week so Signup→Roster empty maintenance is not ARCHIVE-gated.
    const run = await runService.createRun(
      lead,
      venomousCreateInput({
        scheduledStartAt: currentWeekFutureIso({ hoursAhead: 6 }),
        difficulty: "HEROIC",
        desiredTankCount: 1,
        desiredHealerCount: 1,
        desiredDpsCount: 0,
      }),
    );
    const runId = run.id;
    await runService.openRun(lead, runId);
    await discordSyncService.recordRunChannel({ runId, channelId: CHAN });
    await discordSyncService.recordSignupPost({ runId, channelId: CHAN, messageId: `${runId.slice(-4)}-signup` });

    const empty = await botPass(runId);
    expect(empty?.mode).toBe("REFRESH");
    const rosterId = empty!.messageId;
    expect(await currentRosterMessageId(runId)).toBe(rosterId);
    expect(await botPass(runId)).toBeNull();

    const aSignup = await createSignup(runId, userA.id, aChar, ["HEALER"]);
    await saveDraft(runId, [{ signupId: aSignup, selectedRole: "HEALER" }]);
    expect(await botPass(runId)).toEqual({ mode: "REFRESH", messageId: rosterId });

    await saveDraft(runId, []);
    expect(await botPass(runId)).toEqual({ mode: "REFRESH", messageId: rosterId });
    expect(await currentRosterMessageId(runId)).toBe(rosterId);
    expect(sent[runId]).toEqual([rosterId]);
    const data = await discordSyncService.getRosterEmbedData(runId);
    expect(data?.totalSelected).toBe(0);
  });
});

describe("Add Booster", () => {
  it("works on a legacy published roster whose draft was never seeded: A/C preserved, D added, atomically", async () => {
    const { runId, aSignup, cSignup } = await publishedRunWithPost();
    // Emulate a legacy roster: published, draft empty, version 1.
    const roster = await rosterRepository.findByRunId(runId);
    await orm.RunRosterEntry.where({ rosterId: roster!.id }).deleteAll();
    await orm.RunRoster.where({ id: roster!.id }).update({ version: 1, updatedAt: new Date().toISOString() });
    expect((await view(runId)).roster.needsPublishSeed).toBe(true);

    await rosterService.addRegisteredParticipant(lead, { runId, version: 1, userId: userB.id, characterId: bChar, role: "HEALER" });
    const current = await view(runId);
    const draftIds = current.boosters.filter((row) => row.draftSelected).map((row) => row.id);
    const bSignup = current.boosters.find((row) => row.userId === userB.id)!.id;
    expect(draftIds.sort()).toEqual([aSignup, cSignup, bSignup].sort());
    expect(current.run.status).toBe("PUBLISHED");
    expect(current.roster.hasUnpublishedChanges).toBe(true);

    await update(runId, current.boosters.filter((row) => row.draftSelected).map((row) => ({ signupId: row.id, selectedRole: row.selectedRole })));
    const accepted = await view(runId);
    expect(accepted.boosters.filter((row) => row.status === "SELECTED").map((row) => row.id).sort()).toEqual(
      [aSignup, cSignup, bSignup].sort(),
    );
  });

  it("a failing seeded add leaves nothing behind (no signup, no seed)", async () => {
    const { runId } = await publishedRunWithPost();
    const roster = await rosterRepository.findByRunId(runId);
    await orm.RunRosterEntry.where({ rosterId: roster!.id }).deleteAll();
    await orm.RunRoster.where({ id: roster!.id }).update({ version: 1, updatedAt: new Date().toISOString() });
    const validate = signupService.validateManagedBoosterCandidate.bind(signupService);
    vi.spyOn(signupService, "validateManagedBoosterCandidate").mockImplementation(async (input) => {
      const result = await validate(input);
      const current = await rosterRepository.findByRunId(runId);
      await rosterRepository.replaceExternalBoosters(current!.id, current!.version, []);
      return result;
    });
    await expect(
      rosterService.addRegisteredParticipant(lead, { runId, version: 1, userId: userB.id, characterId: bChar, role: "HEALER" }),
    ).rejects.toMatchObject({ code: "ROSTER_ALREADY_CHANGED" });
    expect(await orm.RunSignup.where({ runId, userId: userB.id }).all()).toHaveLength(0);
    expect(await orm.RunRosterEntry.where({ rosterId: roster!.id }).all()).toHaveLength(0);
  });

  it("works in ROSTERING after a difficulty change: approved boosters stay addable, a non-approved one is refused on any difficulty", async () => {
    const runId = await createOpenRun("NORMAL");
    const aSignup = await createSignup(runId, userA.id, aChar, ["HEALER"]);
    await saveDraft(runId, [{ signupId: aSignup, selectedRole: "HEALER" }]);
    expect((await runRepository.findById(runId))?.status).toBe("ROSTERING");
    let version = (await view(runId)).roster.version;
    await rosterService.addRegisteredParticipant(lead, { runId, version, userId: userC.id, characterId: cChar, role: "TANK" });

    await runService.updateRun(lead, venomousUpdateInput(runId, (await runRepository.findById(runId))!, { difficulty: "HEROIC" }));
    version = (await view(runId)).roster.version;
    await expect(
      rosterService.addRegisteredParticipant(lead, { runId, version, userId: notApproved.id, characterId: notApprovedChar, role: "HEALER" }),
    ).rejects.toMatchObject({ code: "BOOSTER_ACCESS_REQUIRED" });
    await rosterService.addRegisteredParticipant(lead, { runId, version, userId: userB.id, characterId: bChar, role: "HEALER" });
    expect((await view(runId)).boosters.some((row) => row.userId === userB.id && row.boosterApproved)).toBe(true);
  });

  it("is refused once the Run has started", async () => {
    const { runId } = await publishedRunWithPost();
    await runService.startRun(lead, { runId });
    const version = (await view(runId)).roster.version;
    await expect(
      rosterService.addRegisteredParticipant(lead, { runId, version, userId: userB.id, characterId: bChar, role: "HEALER" }),
    ).rejects.toMatchObject({ code: "INVALID_ROSTER_SELECTION" });
  });
});

describe("Run edit vs Start", () => {
  it("edit first: the edit commits, the roster is changed, Start refuses", async () => {
    const { runId } = await publishedRunWithPost();
    await runService.updateRun(lead, venomousUpdateInput(runId, (await runRepository.findById(runId))!, { lootType: "VIP" }));
    await expect(runService.startRun(lead, { runId })).rejects.toMatchObject({ code: "ROSTER_UNPUBLISHED_CHANGES" });
    expect((await runRepository.findById(runId))?.status).toBe("PUBLISHED");
  });

  it("Start first: an edit queued behind the Start lock sees IN_PROGRESS and fails — metadata unchanged", async () => {
    const { runId } = await publishedRunWithPost();
    const roster = await rosterRepository.findByRunId(runId);
    let releaseStart!: () => void;
    const startMayCommit = new Promise<void>((resolve) => (releaseStart = resolve));
    let signalLocked!: () => void;
    const lockHeld = new Promise<void>((resolve) => (signalLocked = resolve));
    const startTx = db.transaction(async (tx) => {
      const txOrm = tx.orm.public;
      await lockRosterInTx(txOrm, roster!.id);
      signalLocked();
      await startMayCommit;
      await txOrm.Run.where({ id: runId }).update({ status: "IN_PROGRESS", updatedAt: new Date().toISOString() });
    });
    await lockHeld;

    const atomic = runRepository.updatePreStartAtomic.bind(runRepository);
    let reachedWrite!: () => void;
    const writeQueued = new Promise<void>((resolve) => (reachedWrite = resolve));
    vi.spyOn(runRepository, "updatePreStartAtomic").mockImplementation((...args) => {
      reachedWrite();
      return atomic(...args);
    });
    const edit = runService.updateRun(lead, venomousUpdateInput(runId, (await runRepository.findById(runId))!, { lootType: "VIP" }));
    await writeQueued;
    await new Promise((resolve) => setTimeout(resolve, 200));
    releaseStart();
    await startTx;

    await expect(edit).rejects.toMatchObject({ code: "RUN_EDIT_LOCKED" });
    expect((await runRepository.findById(runId))?.lootType).toBe("UNSAVED");
  });
});

describe("stale Edit Run forms", () => {
  async function formOpenedOn(runId: string) {
    const run = (await runRepository.findById(runId))!;
    return { run, expectedEditVersion: (await runDetailService.getRunDetail(lead, runId)).editor!.editVersion };
  }

  it("a form opened before another manager's edit is refused, writes nothing, and works again after reloading", async () => {
    const runId = await createOpenRun("NORMAL");
    const stale = await formOpenedOn(runId);
    await runService.updateRun(admin, venomousUpdateInput(runId, stale.run, { notes: "from the other manager" }));
    const eventsBefore = (await orm.RunDomainEvent.where({ runId }).all()).length;

    const attempt = runService.updateRun(
      lead,
      venomousUpdateInput(runId, stale.run, {
        expectedEditVersion: stale.expectedEditVersion,
        notes: "stale notes",
        scheduledStartAt: currentWeekFutureIso({ hoursAhead: 30 }),
        desiredDpsCount: stale.run.desiredDpsCount + 1,
      }),
    );
    await expect(attempt).rejects.toMatchObject({ code: "RUN_EDIT_STALE", status: 409 });
    const failure = mapActionError(await attempt.catch((error: unknown) => error));
    expect(failure).toMatchObject({ ok: false, code: "RUN_EDIT_STALE" });
    expect(failure.message).toContain("reload");

    const unchanged = (await runRepository.findById(runId))!;
    expect(unchanged.notes).toBe("from the other manager");
    expect(unchanged.scheduledStartAt).toBe(stale.run.scheduledStartAt);
    expect(unchanged.scheduleRevision).toBe(stale.run.scheduleRevision);
    expect(unchanged.desiredDpsCount).toBe(stale.run.desiredDpsCount);
    expect((await orm.RunDomainEvent.where({ runId }).all()).length).toBe(eventsBefore);

    const fresh = await formOpenedOn(runId);
    expect(fresh.expectedEditVersion).not.toBe(stale.expectedEditVersion);
    await runService.updateRun(
      lead,
      venomousUpdateInput(runId, fresh.run, { expectedEditVersion: fresh.expectedEditVersion, notes: "fresh notes" }),
    );
    expect((await runRepository.findById(runId))?.notes).toBe("fresh notes");
  });

  it("two simultaneous saves of one form version: one wins, the other is refused", async () => {
    const runId = await createOpenRun("NORMAL");
    const form = await formOpenedOn(runId);
    const results = await Promise.allSettled(
      ["first", "second"].map((notes) =>
        runService.updateRun(lead, venomousUpdateInput(runId, form.run, { expectedEditVersion: form.expectedEditVersion, notes })),
      ),
    );
    const rejected = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: "RUN_EDIT_STALE" });
    expect((await runRepository.findById(runId))?.notes).toBe(results[0].status === "fulfilled" ? "first" : "second");
  });

  it("the check also covers a Run without a roster row, under the lock", async () => {
    const runId = await createOpenRun("NORMAL");
    await orm.RunRoster.where({ runId }).deleteAndCount();
    const run = (await runRepository.findById(runId))!;
    const expectedEditVersion = runEditVersion(run);
    const results = await Promise.allSettled(
      ["first", "second"].map((notes) =>
        runService.updateRun(lead, venomousUpdateInput(runId, run, { expectedEditVersion, notes })),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });

  it("changes outside the form do not invalidate it", async () => {
    const runId = await createOpenRun("NORMAL");
    const form = await formOpenedOn(runId);
    await runService.setSignupWindow(admin, runId, false);
    await runService.setSignupWindow(admin, runId, true);
    await createSignup(runId, userC.id, cChar, ["TANK"]);
    await runService.updateRun(
      lead,
      venomousUpdateInput(runId, form.run, { expectedEditVersion: form.expectedEditVersion, notes: "still valid" }),
    );
    expect((await runRepository.findById(runId))?.notes).toBe("still valid");
  });

  it("lifecycle rules stay first: a form left open past a cancellation is locked, not stale", async () => {
    const runId = await createOpenRun("NORMAL");
    const form = await formOpenedOn(runId);
    await runService.cancelRun(admin, runId);
    await expect(
      runService.updateRun(lead, venomousUpdateInput(runId, form.run, { expectedEditVersion: form.expectedEditVersion, notes: "late" })),
    ).rejects.toMatchObject({ code: "RUN_EDIT_LOCKED" });
  });

  it("the action input requires the form's version", () => {
    const shape = updateRunSchema.safeParse({
      runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      difficulty: "NORMAL",
      lootType: "UNSAVED",
      scheduledStartAt: currentWeekFutureIso({ hoursAhead: 30 }),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    expect(shape.success).toBe(false);
    expect(shape.error?.issues[0]?.path).toEqual(["expectedEditVersion"]);
  });
});

describe("Discord signup post and channel after Run edits", () => {
  it("edits the existing signup message in place (no re-announce) and renames the same Run channel", async () => {
    const runId = await createOpenRun("NORMAL");
    await discordSyncService.recordRunChannel({ runId, channelId: CHAN });
    await discordSyncService.recordSignupPost({ runId, channelId: CHAN, messageId: "fx-signup-msg" });
    const channelBefore = (await discordSyncService.listSyncWork()).channels.find((row) => row.runId === runId);

    await runService.updateRun(lead, venomousUpdateInput(runId, (await runRepository.findById(runId))!, { difficulty: "HEROIC" }));

    const work = await discordSyncService.listSyncWork();
    const signup = work.signups.find((row) => row.runId === runId);
    expect(signup).toMatchObject({ existingMessageId: "fx-signup-msg", existingRunChannelId: CHAN, announceOnCreate: false });
    const channel = work.channels.find((row) => row.runId === runId);
    expect(channel?.existingRunChannelId).toBe(CHAN);
    expect(channel?.desiredChannelName).not.toBe(channelBefore?.desiredChannelName);
  });
});
