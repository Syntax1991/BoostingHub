import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { db, orm } from "@/lib/prisma";
import { venomousCreateInput, venomousUpdateInput } from "@/lib/test-run-input";
import type { CharacterRole, RaidDifficulty } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { lockRosterInTx, rosterRepository } from "@/repositories/roster.repository";
import { runDiscordPostRepository } from "@/repositories/run-discord-post.repository";
import { runRepository } from "@/repositories/run.repository";
import { userNotificationRepository } from "@/repositories/user-notification.repository";
import { getRunCommitmentsForCharacters } from "@/services/character-run-commitment";
import { discordSyncService } from "@/services/discord-sync.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";

/**
 * Flexible pre-start Run management: Run edits until Start (signup history
 * never locks), roster acknowledgement (runChangedSinceAck), Save / Update /
 * Publish semantics and the explicit Discord roster repost (postRevision).
 */

const P = "aaaaaaaa-aaaa-4aaa-8aaa-fx";
const ids = {
  lead: `${P}0000000001`,
  admin: `${P}0000000002`,
  otherLead: `${P}0000000003`,
  a: `${P}0000000004`,
  b: `${P}0000000005`,
  c: `${P}0000000006`,
  normalOnly: `${P}0000000007`,
  heroicHealer: `${P}0000000008`,
};
const allUserIds = Object.values(ids);
const CHAN = "fx-run-chan";

function asUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@fx.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}
const lead = asUser(ids.lead, "Fx Lead", "RAID_LEAD");
const admin = asUser(ids.admin, "Fx Admin", "ADMIN");

async function createTestUser(id: string, name: string, role: AuthenticatedUser["accountRole"] = "USER") {
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name,
    email: `${id}@fx.boostting.local`,
    emailVerified: true,
    discordUserId: null,
    discordUsername: null,
    accountRole: role,
    accountStatus: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
}

async function approve(userId: string, difficulty: RaidDifficulty) {
  const now = new Date().toISOString();
  await orm.BoosterQualification.create({
    id: crypto.randomUUID(),
    userId,
    difficulty,
    status: "APPROVED",
    notes: "fx",
    grantedAt: now,
    grantedById: null,
    revokedAt: null,
    revokedById: null,
    createdAt: now,
    updatedAt: now,
  });
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
 * the bot: POST → a NEW message id + the fulfilled postRevision; REFRESH →
 * the existing message is edited (same id). Returns what happened.
 */
const sent: Record<string, string[]> = {};
async function botPass(runId: string): Promise<{ mode: "POST" | "REFRESH"; messageId: string } | null> {
  const item = (await discordSyncService.listSyncWork()).roster.find((row) => row.runId === runId);
  if (!item) return null;
  if (item.mode === "POST" || !item.existingMessageId) {
    const messageId = `${runId.slice(-4)}-M${(sent[runId]?.length ?? 0) + 1}`;
    (sent[runId] ??= []).push(messageId);
    await discordSyncService.recordRosterPost({
      runId,
      channelId: CHAN,
      messageId,
      ...(item.mode === "POST" && typeof item.postRevision === "number" ? { postRevision: item.postRevision } : {}),
    });
    return { mode: item.mode === "POST" ? "POST" : "REFRESH", messageId };
  }
  await discordSyncService.recordRosterPost({ runId, channelId: CHAN, messageId: item.existingMessageId });
  return { mode: "REFRESH", messageId: item.existingMessageId };
}

async function currentRosterMessageId(runId: string) {
  return (await runDiscordPostRepository.findByRunId(runId))?.rosterMessageId ?? null;
}

let aChar = "";
let bChar = "";
let cChar = "";
let normalChar = "";
let heroicChar = "";

/** OPEN Run with a Run channel; A (HEALER) + C (TANK) published; first roster message posted. */
async function publishedRunWithPost(difficulty: RaidDifficulty = "HEROIC") {
  const runId = await createOpenRun(difficulty);
  await discordSyncService.recordRunChannel({ runId, channelId: CHAN });
  const aSignup = await createSignup(runId, ids.a, aChar, ["HEALER"]);
  const cSignup = await createSignup(runId, ids.c, cChar, ["TANK"]);
  await saveDraft(runId, [
    { signupId: aSignup, selectedRole: "HEALER" },
    { signupId: cSignup, selectedRole: "TANK" },
  ]);
  await publish(runId);
  const first = await botPass(runId);
  return { runId, aSignup, cSignup, firstMessageId: first!.messageId };
}

/** Best-effort bulk delete for cleanup (`deleteAll` returns a thenable without `.catch`). */
async function wipe(op: () => PromiseLike<unknown>) {
  try {
    await op();
  } catch {
    // Already gone or blocked by a row cleaned up later — cleanup is best effort.
  }
}

async function cleanupRuns() {
  for (const raidLeadId of [ids.lead, ids.otherLead, ids.admin]) {
    const runs = await orm.Run.where({ raidLeadId }).select("id").all();
    for (const row of runs as Array<{ id: string }>) {
      const runId = row.id;
      await wipe(() => orm.UserNotification.where({ runId }).deleteAll());
      await wipe(() => orm.RunDiscordAnnouncement.where({ runId }).deleteAll());
      await wipe(() => orm.RunAttendance.where({ runId }).deleteAll());
      await wipe(() => orm.RunStartSnapshot.where({ runId }).deleteAll());
      await wipe(() => orm.RunDiscordPost.where({ runId }).deleteAll());
      const roster = (await orm.RunRoster.where({ runId }).first()) as { id: string } | null;
      if (roster) {
        await wipe(() => orm.RunRosterEntry.where({ rosterId: roster.id }).deleteAll());
        await wipe(() => orm.RunExternalBooster.where({ rosterId: roster.id }).deleteAll());
        await wipe(() => orm.RunRoster.where({ id: roster.id }).deleteAll());
      }
      const signups = await orm.RunSignup.where({ runId }).select("id").all();
      for (const signup of signups as Array<{ id: string }>) {
        await wipe(() => orm.RunSignupRole.where({ signupId: signup.id }).deleteAll());
      }
      await wipe(() => orm.RunSignup.where({ runId }).deleteAll());
      await wipe(() => orm.RunRaidContent.where({ runId }).deleteAll());
      await wipe(() => orm.Run.where({ id: runId }).deleteAll());
    }
  }
}

async function cleanupAll() {
  await cleanupRuns();
  for (const userId of allUserIds) {
    await wipe(() => orm.UserNotification.where({ userId }).deleteAll());
    await wipe(() => orm.ActivityEvent.where({ userId }).deleteAll());
    await wipe(() => orm.BoosterQualification.where({ userId }).deleteAll());
    await wipe(() => orm.Character.where({ userId }).deleteAll());
    await wipe(() => orm.User.where({ id: userId }).deleteAll());
  }
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await cleanupAll();
  await createTestUser(ids.lead, "Fx Lead", "RAID_LEAD");
  await createTestUser(ids.admin, "Fx Admin", "ADMIN");
  await createTestUser(ids.otherLead, "Fx Other Lead", "RAID_LEAD");
  for (const [key, name] of [
    ["a", "Fx A"],
    ["b", "Fx B"],
    ["c", "Fx C"],
    ["normalOnly", "Fx Normal Only"],
    ["heroicHealer", "Fx Heroic Healer"],
  ] as const) {
    await createTestUser(ids[key], name);
  }
  for (const userId of [ids.a, ids.b, ids.c, ids.heroicHealer]) {
    await approve(userId, "HEROIC");
    await approve(userId, "NORMAL");
  }
  await approve(ids.normalOnly, "NORMAL");
  aChar = await createCharacter(ids.a, "PRIEST");
  bChar = await createCharacter(ids.b, "PRIEST");
  cChar = await createCharacter(ids.c, "PALADIN");
  normalChar = await createCharacter(ids.normalOnly, "PRIEST");
  heroicChar = await createCharacter(ids.heroicHealer, "PRIEST");
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
    const signup = await createSignup(runId, ids.a, aChar, ["HEALER"]);
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
      { contentPreset: "MIDNIGHT_S2_BUNDLE" },
      { contentPreset: "VENOMOUS_ABYSS", plannedBossCount: 5 },
      { scheduledStartAt: futureIso() },
      { lootType: "VIP" },
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
    await runService.updateRun(admin, venomousUpdateInput(runId, (await runRepository.findById(runId))!, { raidLeadId: ids.otherLead }));
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
  it("keeps signups and the stored lineup, recalculates access, blocks Start and Update until fixed, then Update edits the same message and Start succeeds", async () => {
    const runId = await createOpenRun("NORMAL");
    await discordSyncService.recordRunChannel({ runId, channelId: CHAN });
    const tankSignup = await createSignup(runId, ids.c, cChar, ["TANK"]);
    const normalSignup = await createSignup(runId, ids.normalOnly, normalChar, ["HEALER"]);
    await saveDraft(runId, [
      { signupId: tankSignup, selectedRole: "TANK" },
      { signupId: normalSignup, selectedRole: "HEALER" },
    ]);
    await publish(runId);
    const m1 = (await botPass(runId))!.messageId;

    await runService.updateRun(lead, venomousUpdateInput(runId, (await runRepository.findById(runId))!, { difficulty: "HEROIC" }));

    let current = await view(runId);
    const normalRow = current.boosters.find((row) => row.id === normalSignup)!;
    expect(normalRow).toMatchObject({ status: "SELECTED", draftSelected: true, boosterApproved: false });
    expect(current.roster.runChangedSinceAck).toBe(true);
    expect(current.roster.hasUnpublishedChanges).toBe(true);
    await expect(runService.startRun(lead, { runId })).rejects.toMatchObject({ code: "ROSTER_UNPUBLISHED_CHANGES" });

    // Update with the Normal-only healer is refused; nothing changes.
    await expect(update(runId, await publishedSelections(runId))).rejects.toMatchObject({ code: "ROSTER_VALIDATION_FAILED" });
    current = await view(runId);
    expect(current.roster.runChangedSinceAck).toBe(true);
    expect(current.boosters.find((row) => row.id === normalSignup)?.status).toBe("SELECTED");

    // Replace with a Heroic-approved healer and Update once.
    const heroicSignup = await createSignup(runId, ids.heroicHealer, heroicChar, ["HEALER"]);
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
  it("first Save persists without posting; first Publish posts M1 (postRevision 0 → 1)", async () => {
    const runId = await createOpenRun();
    await discordSyncService.recordRunChannel({ runId, channelId: CHAN });
    const aSignup = await createSignup(runId, ids.a, aChar, ["HEALER"]);
    await saveDraft(runId, [{ signupId: aSignup, selectedRole: "HEALER" }]);
    let current = await view(runId);
    expect(current.roster.publishedAt).toBeNull();
    expect(current.run.status).not.toBe("PUBLISHED");
    expect(current.roster.postRevision).toBe(0);
    expect(await botPass(runId)).toBeNull();

    await publish(runId);
    current = await view(runId);
    expect(current.run.status).toBe("PUBLISHED");
    expect(current.roster.publishedAt).not.toBeNull();
    expect(current.roster.runChangedSinceAck).toBe(false);
    expect(current.roster.postRevision).toBe(1);
    const first = await botPass(runId);
    expect(first?.mode).toBe("POST");
    expect(await currentRosterMessageId(runId)).toBe(first?.messageId);
    expect((await runDiscordPostRepository.findByRunId(runId))?.lastRosterPostRevision).toBe(1);
    expect(await botPass(runId)).toBeNull(); // poll after recording: nothing more
  });

  it("Update edits M1 in place — three times — and never posts; Save on a published roster also only refreshes", async () => {
    const { runId, aSignup, cSignup, firstMessageId } = await publishedRunWithPost();
    const bSignup = await createSignup(runId, ids.b, bChar, ["HEALER"]);

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
    const normalSignup = await createSignup(runId, ids.normalOnly, normalChar, ["HEALER"]);
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

  it("explicit Publish reposts: M2, then Update edits M2, then Publish again → M3; old posts are no longer tracked", async () => {
    const { runId, cSignup, firstMessageId } = await publishedRunWithPost();
    const notificationsBefore = (await userNotificationRepository.listForUser(ids.a, 100)).length;
    const lineupBefore = await publishedSelections(runId);

    expect(await repost(runId)).toEqual({ postRevision: 2 });
    let pass = await botPass(runId);
    expect(pass?.mode).toBe("POST");
    const m2 = pass!.messageId;
    expect(m2).not.toBe(firstMessageId);
    expect(await currentRosterMessageId(runId)).toBe(m2);
    expect(await botPass(runId)).toBeNull();
    // A repost changes no membership/roles and notifies nobody.
    expect(await publishedSelections(runId)).toEqual(lineupBefore);
    expect((await userNotificationRepository.listForUser(ids.a, 100)).length).toBe(notificationsBefore);

    const bSignup = await createSignup(runId, ids.b, bChar, ["HEALER"]);
    await update(runId, [
      { signupId: cSignup, selectedRole: "TANK" },
      { signupId: bSignup, selectedRole: "HEALER" },
    ]);
    expect(await botPass(runId)).toEqual({ mode: "REFRESH", messageId: m2 });

    expect(await repost(runId)).toEqual({ postRevision: 3 });
    pass = await botPass(runId);
    expect(pass?.mode).toBe("POST");
    expect(await currentRosterMessageId(runId)).toBe(pass!.messageId);
    expect(sent[runId]).toHaveLength(3); // M1, M2, M3 — each only from an explicit Publish
    await update(runId, await publishedSelections(runId));
    expect(await botPass(runId)).toEqual({ mode: "REFRESH", messageId: pass!.messageId });
  });

  it("Publish cannot bypass unpublished changes: a dirty published roster must be updated first", async () => {
    const { runId } = await publishedRunWithPost();
    await runService.updateRun(lead, venomousUpdateInput(runId, (await runRepository.findById(runId))!, { lootType: "VIP" }));
    await expect(repost(runId)).rejects.toMatchObject({ code: "ROSTER_UNPUBLISHED_CHANGES" });
    expect((await view(runId)).roster.runChangedSinceAck).toBe(true);
    await update(runId, await publishedSelections(runId));
    expect(await repost(runId)).toEqual({ postRevision: 2 });
  });

  it("double-submitted Publish with the same expected postRevision advances it once and posts once", async () => {
    const { runId } = await publishedRunWithPost();
    const current = await view(runId);
    const request = () =>
      rosterService.repostRoster(lead, { runId, version: current.roster.version, postRevision: current.roster.postRevision });
    const results = await Promise.allSettled([request(), request()]);
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(results.find((row) => row.status === "rejected")).toMatchObject({ reason: { code: "ROSTER_ALREADY_CHANGED" } });
    expect((await view(runId)).roster.postRevision).toBe(2);
    expect((await botPass(runId))?.mode).toBe("POST");
    expect(await botPass(runId)).toBeNull();
    expect(sent[runId]).toHaveLength(2);
  });

  it("legacy roster message (postRevision 0, fulfilled null) is never reposted automatically; refresh edits it; only Publish posts anew", async () => {
    const { runId } = await publishedRunWithPost();
    await orm.RunRoster.where({ runId }).update({ postRevision: 0, updatedAt: new Date().toISOString() });
    await orm.RunDiscordPost.where({ runId }).update({ lastRosterPostRevision: null, rosterMessageId: "legacy-msg", updatedAt: new Date().toISOString() });
    expect(await botPass(runId)).toBeNull();

    await update(runId, await publishedSelections(runId)); // version bump
    expect(await botPass(runId)).toEqual({ mode: "REFRESH", messageId: "legacy-msg" });

    expect(await repost(runId)).toEqual({ postRevision: 1 });
    const pass = await botPass(runId);
    expect(pass?.mode).toBe("POST");
    expect(await currentRosterMessageId(runId)).toBe(pass!.messageId);
  });

  it("Run edit + Update and Add Booster + Update keep the message id; an explicit Publish afterwards creates a new one", async () => {
    const { runId, firstMessageId } = await publishedRunWithPost();
    await runService.updateRun(lead, venomousUpdateInput(runId, (await runRepository.findById(runId))!, { desiredDpsCount: 2 }));
    expect(await botPass(runId)).toBeNull(); // the edit alone does not touch Discord
    await update(runId, await publishedSelections(runId));
    expect(await botPass(runId)).toEqual({ mode: "REFRESH", messageId: firstMessageId });

    const version = (await view(runId)).roster.version;
    await rosterService.addRegisteredParticipant(lead, { runId, version, userId: ids.b, characterId: bChar, role: "HEALER" });
    expect((await view(runId)).roster.hasUnpublishedChanges).toBe(true);
    expect((await botPass(runId))?.mode).not.toBe("POST");
    const draft = (await view(runId)).boosters.filter((row) => row.draftSelected).map((row) => ({ signupId: row.id, selectedRole: row.selectedRole }));
    await update(runId, draft);
    expect(await botPass(runId)).toEqual({ mode: "REFRESH", messageId: firstMessageId });
    expect(sent[runId]).toEqual([firstMessageId]);

    await repost(runId);
    expect((await botPass(runId))?.mode).toBe("POST");
    expect(sent[runId]).toHaveLength(2);
  });

  it("commitments: a repost does not change them; Update reconciles RESERVED → COMMITTED", async () => {
    const { runId } = await publishedRunWithPost();
    const other = await createOpenRun("HEROIC", lead);
    const version = (await view(runId)).roster.version;
    await rosterService.addRegisteredParticipant(lead, { runId, version, userId: ids.b, characterId: bChar, role: "HEALER" });
    const reserved = (await getRunCommitmentsForCharacters({ characterIds: [bChar], excludeRunId: other })).get(bChar);
    expect(reserved?.find((row) => row.runId === runId)?.state).toBe("RESERVED");
    const draft = (await view(runId)).boosters.filter((row) => row.draftSelected).map((row) => ({ signupId: row.id, selectedRole: row.selectedRole }));
    await update(runId, draft);
    const committed = (await getRunCommitmentsForCharacters({ characterIds: [bChar], excludeRunId: other })).get(bChar);
    expect(committed?.find((row) => row.runId === runId)?.state).toBe("COMMITTED");
    await repost(runId);
    expect((await getRunCommitmentsForCharacters({ characterIds: [bChar], excludeRunId: other })).get(bChar)).toEqual(committed);
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

    await rosterService.addRegisteredParticipant(lead, { runId, version: 1, userId: ids.b, characterId: bChar, role: "HEALER" });
    const current = await view(runId);
    const draftIds = current.boosters.filter((row) => row.draftSelected).map((row) => row.id);
    const bSignup = current.boosters.find((row) => row.userId === ids.b)!.id;
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
      rosterService.addRegisteredParticipant(lead, { runId, version: 1, userId: ids.b, characterId: bChar, role: "HEALER" }),
    ).rejects.toMatchObject({ code: "ROSTER_ALREADY_CHANGED" });
    expect(await orm.RunSignup.where({ runId, userId: ids.b }).all()).toHaveLength(0);
    expect(await orm.RunRosterEntry.where({ rosterId: roster!.id }).all()).toHaveLength(0);
  });

  it("works in ROSTERING and uses the CURRENT difficulty (Normal-only player refused on a Run changed to Heroic)", async () => {
    const runId = await createOpenRun("NORMAL");
    const aSignup = await createSignup(runId, ids.a, aChar, ["HEALER"]);
    await saveDraft(runId, [{ signupId: aSignup, selectedRole: "HEALER" }]);
    expect((await runRepository.findById(runId))?.status).toBe("ROSTERING");
    let version = (await view(runId)).roster.version;
    await rosterService.addRegisteredParticipant(lead, { runId, version, userId: ids.c, characterId: cChar, role: "TANK" });

    await runService.updateRun(lead, venomousUpdateInput(runId, (await runRepository.findById(runId))!, { difficulty: "HEROIC" }));
    version = (await view(runId)).roster.version;
    await expect(
      rosterService.addRegisteredParticipant(lead, { runId, version, userId: ids.normalOnly, characterId: normalChar, role: "HEALER" }),
    ).rejects.toMatchObject({ code: "BOOSTER_ACCESS_DIFFICULTY_MISMATCH" });
  });

  it("is refused once the Run has started", async () => {
    const { runId } = await publishedRunWithPost();
    await runService.startRun(lead, { runId });
    const version = (await view(runId)).roster.version;
    await expect(
      rosterService.addRegisteredParticipant(lead, { runId, version, userId: ids.b, characterId: bChar, role: "HEALER" }),
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
      const txOrm = ((tx.orm as { public?: typeof orm }).public ?? (tx.orm as unknown as typeof orm)) as typeof orm;
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
