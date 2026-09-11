import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { runDiscordPostRepository } from "@/repositories/run-discord-post.repository";
import { runRepository } from "@/repositories/run.repository";
import { discordSyncService } from "@/services/discord-sync.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import type { ParticipationType, CharacterRole } from "@/models/enums";

const raidId = WOW_RAID_CATALOG[0].id;
const ids = {
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-ds0000000001",
  tank: "aaaaaaaa-aaaa-4aaa-8aaa-ds0000000002",
  healer: "aaaaaaaa-aaaa-4aaa-8aaa-ds0000000003",
  melee: "aaaaaaaa-aaaa-4aaa-8aaa-ds0000000004",
  ranged: "aaaaaaaa-aaaa-4aaa-8aaa-ds0000000005",
  loot: "aaaaaaaa-aaaa-4aaa-8aaa-ds0000000006",
  extra: "aaaaaaaa-aaaa-4aaa-8aaa-ds0000000007",
};
const createdUserIds = Object.values(ids);
const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdQualificationIds: string[] = [];

function asUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"] = "USER"): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@dstest.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function createTestUser(
  id: string,
  name: string,
  discordUserId: string | null,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
) {
  await orm.User.create({
    id,
    name,
    email: `${id}@dstest.boostting.local`,
    emailVerified: true,
    discordUserId,
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
    else if (table === "RunDiscordPost") await orm.RunDiscordPost.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

function futureIso(days = 10) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function grantQualification(userId: string) {
  const id = crypto.randomUUID();
  createdQualificationIds.push(id);
  await orm.BoosterQualification.create({
    id,
    userId,
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
}

async function createCharacter(
  userId: string,
  name: string,
  wowClass: "PALADIN" | "PRIEST" | "WARRIOR" | "MAGE" | "HUNTER",
  specialization: string,
  primaryRole: "TANK" | "HEALER" | "DPS",
) {
  const id = crypto.randomUUID();
  createdCharacterIds.push(id);
  await orm.Character.create({
    id,
    userId,
    name,
    realm: "Discord Lab",
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity("Discord Lab"),
    region: "EU",
    wowClass,
    specialization,
    primaryRole,
    itemLevel: 700,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

async function createSignup(input: {
  runId: string;
  userId: string;
  characterId: string;
  participationType: ParticipationType;
  role: CharacterRole | null;
}) {
  const id = crypto.randomUUID();
  await orm.RunSignup.create({
    id,
    runId: input.runId,
    userId: input.userId,
    characterId: input.characterId,
    participationType: input.participationType,
    role: input.role,
    isBackup: false,
    status: "PENDING",
    lootbuddyMode: input.participationType === "LOOTBUDDY" ? "PLAYING" : null,
    lootbuddyVerification: input.participationType === "LOOTBUDDY" ? "NONE" : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

async function cleanupRun(runId: string) {
  await deleteIfPresent("RunDiscordPost", runId);
  await orm.RunDiscordPost.where({ runId }).delete().catch(() => {});
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

const lead = asUser(ids.lead, "Discord Lead", "RAID_LEAD");

let runId = "";
let draftRunId = "";
let tankChar = "";
let healerChar = "";
let meleeChar = "";
let rangedChar = "";
let lootChar = "";

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

  await createTestUser(ids.lead, "Discord Lead", null, "RAID_LEAD");
  await createTestUser(ids.tank, "Discord Tank", "111111111111111111");
  await createTestUser(ids.healer, "Discord Healer", null);
  await createTestUser(ids.melee, "Discord Melee", "222222222222222222");
  await createTestUser(ids.ranged, "Discord Ranged", "333333333333333333");
  await createTestUser(ids.loot, "Discord Loot", "444444444444444444");
  await createTestUser(ids.extra, "Discord Extra", null);

  tankChar = await createCharacter(ids.tank, "Dstank", "PALADIN", "Protection", "TANK");
  healerChar = await createCharacter(ids.healer, "Dsheal", "PRIEST", "Holy", "HEALER");
  meleeChar = await createCharacter(ids.melee, "Dsmelee", "WARRIOR", "Fury", "DPS");
  rangedChar = await createCharacter(ids.ranged, "Dsranged", "MAGE", "Fire", "DPS");
  lootChar = await createCharacter(ids.loot, "Dsloot", "HUNTER", "Beast Mastery", "DPS");

  await grantQualification(ids.tank);
  await grantQualification(ids.healer);
  await grantQualification(ids.melee);
  await grantQualification(ids.ranged);

  runId = await runService
    .createRun(lead, {
      raidId,
      difficulty: "HEROIC",
      scheduledStartAt: futureIso(),
      desiredTankCount: 1,
      desiredHealerCount: 1,
      desiredDpsCount: 2,
    })
    .then((run) => run.id);
  createdRunIds.push(runId);
  await runService.openRun(lead, runId);

  draftRunId = await runService
    .createRun(lead, {
      raidId,
      difficulty: "HEROIC",
      scheduledStartAt: futureIso(),
      desiredTankCount: 1,
      desiredHealerCount: 1,
      desiredDpsCount: 2,
    })
    .then((run) => run.id);
  createdRunIds.push(draftRunId);
}, 60_000);

afterAll(async () => {
  for (const id of createdRunIds) {
    await cleanupRun(id);
  }
  for (const id of createdQualificationIds) {
    await orm.BoosterQualification.where({ id }).delete().catch(() => {});
  }
  for (const id of createdCharacterIds) {
    await deleteIfPresent("Character", id);
  }
  for (const id of createdUserIds) {
    await deleteIfPresent("User", id);
  }
}, 60_000);

describe("discordSyncService.getSignupEmbedData", () => {
  it("counts distinct Users, never RunSignup rows", async () => {
    await createSignup({ runId, userId: ids.tank, characterId: tankChar, participationType: "BOOSTER", role: "TANK" });
    await createSignup({ runId, userId: ids.healer, characterId: healerChar, participationType: "BOOSTER", role: "HEALER" });

    const data = await discordSyncService.getSignupEmbedData(runId);
    expect(data?.uniqueSignupCount).toBe(2);
    expect(data?.signupWindowOpen).toBe(true);
    expect(data?.runStatus).toBe("OPEN");
  });

  it("returns null for an unknown run", async () => {
    const data = await discordSyncService.getSignupEmbedData("r0000000-0000-4000-8000-000000000000");
    expect(data).toBeNull();
  });

  it("drops a User from the count once their only offer is WITHDRAWN, and never counts a NOT_SELECTED-only User", async () => {
    // A dedicated run so mutating these signups cannot affect the shared runId
    // that later tests in this file (and getRosterEmbedData) depend on.
    const countRunId = await runService
      .createRun(lead, {
        raidId,
        difficulty: "HEROIC",
        scheduledStartAt: futureIso(),
        desiredTankCount: 1,
        desiredHealerCount: 1,
        desiredDpsCount: 2,
      })
      .then((run) => run.id);
    createdRunIds.push(countRunId);
    await runService.openRun(lead, countRunId);

    const tankSignupId = await createSignup({
      runId: countRunId,
      userId: ids.tank,
      characterId: tankChar,
      participationType: "BOOSTER",
      role: "TANK",
    });
    const healerSignupId = await createSignup({
      runId: countRunId,
      userId: ids.healer,
      characterId: healerChar,
      participationType: "BOOSTER",
      role: "HEALER",
    });

    expect((await discordSyncService.getSignupEmbedData(countRunId))?.uniqueSignupCount).toBe(2);

    await orm.RunSignup.where({ id: tankSignupId }).update({ status: "WITHDRAWN" });
    expect((await discordSyncService.getSignupEmbedData(countRunId))?.uniqueSignupCount).toBe(1);

    await orm.RunSignup.where({ id: healerSignupId }).update({ status: "NOT_SELECTED" });
    expect((await discordSyncService.getSignupEmbedData(countRunId))?.uniqueSignupCount).toBe(0);
  });
});

describe("discordSyncService.listSyncWork", () => {
  it("excludes DRAFT runs entirely", async () => {
    const work = await discordSyncService.listSyncWork();
    expect(work.signups.some((item) => item.runId === draftRunId)).toBe(false);
    expect(work.roster.some((item) => item.runId === draftRunId)).toBe(false);
  });

  it("never creates a first signup post for a non-DRAFT run that was never actually signup-available", async () => {
    const neverOpenedRunId = await runService
      .createRun(lead, {
        raidId,
        difficulty: "HEROIC",
        scheduledStartAt: futureIso(),
        desiredTankCount: 1,
        desiredHealerCount: 1,
        desiredDpsCount: 2,
      })
      .then((run) => run.id);
    createdRunIds.push(neverOpenedRunId);
    await runService.cancelRun(lead, neverOpenedRunId);

    const work = await discordSyncService.listSyncWork();
    expect(work.signups.some((item) => item.runId === neverOpenedRunId)).toBe(false);
  });

  it("keeps updating an already-posted signup embed through to cancellation (continuity, not a re-trigger of the creation gate)", async () => {
    const openedThenCancelledRunId = await runService
      .createRun(lead, {
        raidId,
        difficulty: "HEROIC",
        scheduledStartAt: futureIso(),
        desiredTankCount: 1,
        desiredHealerCount: 1,
        desiredDpsCount: 2,
      })
      .then((run) => run.id);
    createdRunIds.push(openedThenCancelledRunId);
    await runService.openRun(lead, openedThenCancelledRunId);

    let work = await discordSyncService.listSyncWork();
    expect(work.signups.some((item) => item.runId === openedThenCancelledRunId)).toBe(true);
    await discordSyncService.recordSignupPost({ runId: openedThenCancelledRunId, channelId: "chan-c", messageId: "msg-c" });

    work = await discordSyncService.listSyncWork();
    expect(work.signups.some((item) => item.runId === openedThenCancelledRunId)).toBe(false);

    await runService.cancelRun(lead, openedThenCancelledRunId);
    work = await discordSyncService.listSyncWork();
    const cancelledItem = work.signups.find((item) => item.runId === openedThenCancelledRunId);
    expect(cancelledItem?.existingMessageId).toBe("msg-c");
  });

  it("flags a run needing its first signup post, then clears after recording it", async () => {
    let work = await discordSyncService.listSyncWork();
    const before = work.signups.find((item) => item.runId === runId);
    expect(before?.existingMessageId).toBeNull();

    await discordSyncService.recordSignupPost({ runId, channelId: "chan-1", messageId: "msg-1" });

    work = await discordSyncService.listSyncWork();
    expect(work.signups.some((item) => item.runId === runId)).toBe(false);
  });

  it("flags UPDATE work again once the unique signup count changes", async () => {
    await createSignup({ runId, userId: ids.melee, characterId: meleeChar, participationType: "BOOSTER", role: "DPS" });

    const work = await discordSyncService.listSyncWork();
    const item = work.signups.find((entry) => entry.runId === runId);
    expect(item?.existingMessageId).toBe("msg-1");
    expect(item?.existingChannelId).toBe("chan-1");

    await discordSyncService.recordSignupPost({ runId, channelId: "chan-1", messageId: "msg-1" });
    const settled = await discordSyncService.listSyncWork();
    expect(settled.signups.some((entry) => entry.runId === runId)).toBe(false);
  });
});

describe("discordSyncService.getRosterEmbedData", () => {
  it("is null before the roster is published", async () => {
    const data = await discordSyncService.getRosterEmbedData(runId);
    expect(data).toBeNull();
  });

  it("groups selected participants into tanks/healers/melee/ranged/lootbuddies with Discord mentions", async () => {
    await createSignup({ runId, userId: ids.ranged, characterId: rangedChar, participationType: "BOOSTER", role: "DPS" });
    await createSignup({ runId, userId: ids.loot, characterId: lootChar, participationType: "LOOTBUDDY", role: null });

    const view = await rosterService.getRosterManagementView(lead, runId);
    const all = [...view.groups.tanks, ...view.groups.healers, ...view.groups.dps, ...view.groups.lootbuddies];
    let version = view.roster.version;
    for (const signup of all) {
      await rosterService.setDraftSelection(lead, { runId, signupId: signup.id, selected: true, version });
      version = (await rosterService.getRosterManagementView(lead, runId)).roster.version;
    }

    await rosterService.publishRoster(lead, { runId, version, acknowledgeWarnings: true });

    const data = await discordSyncService.getRosterEmbedData(runId);
    expect(data).not.toBeNull();
    expect(data?.groups.tanks.map((m) => m.userId)).toEqual([ids.tank]);
    expect(data?.groups.tanks[0]?.discordUserId).toBe("111111111111111111");
    expect(data?.groups.healers.map((m) => m.userId)).toEqual([ids.healer]);
    expect(data?.groups.healers[0]?.discordUserId).toBeNull();
    expect(data?.groups.meleeDps.map((m) => m.userId)).toEqual([ids.melee]);
    expect(data?.groups.rangedDps.map((m) => m.userId)).toEqual([ids.ranged]);
    expect(data?.groups.lootbuddies.map((m) => m.userId)).toEqual([ids.loot]);
    expect(data?.totalSelected).toBe(5);
    expect(data?.targets).toEqual({ tanks: 1, healers: 1 });
  });

  it("reports roster sync work, clears it after recording, and reopens it on republish", async () => {
    let work = await discordSyncService.listSyncWork();
    expect(work.roster.some((item) => item.runId === runId && item.existingMessageId === null)).toBe(true);

    await discordSyncService.recordRosterPost({ runId, channelId: "chan-2", messageId: "roster-msg-1" });
    work = await discordSyncService.listSyncWork();
    expect(work.roster.some((item) => item.runId === runId)).toBe(false);

    const view = await rosterService.getRosterManagementView(lead, runId);
    await rosterService.publishRoster(lead, { runId, version: view.roster.version, acknowledgeWarnings: true });

    work = await discordSyncService.listSyncWork();
    expect(work.roster.some((item) => item.runId === runId && item.existingMessageId === "roster-msg-1")).toBe(true);
  });
});

describe("discordSyncService — per-Run channel provisioning", () => {
  let channelRunId = "";

  beforeAll(async () => {
    channelRunId = await runService
      .createRun(lead, {
        raidId,
        difficulty: "HEROIC",
        scheduledStartAt: futureIso(),
        desiredTankCount: 1,
        desiredHealerCount: 1,
        desiredDpsCount: 2,
      })
      .then((run) => run.id);
    createdRunIds.push(channelRunId);
    await runService.openRun(lead, channelRunId);
  }, 60_000);

  it("always computes a desiredChannelName, with no channel provisioned yet", async () => {
    const work = await discordSyncService.listSyncWork();
    const item = work.signups.find((entry) => entry.runId === channelRunId);
    expect(item?.existingRunChannelId).toBeNull();
    expect(item?.desiredChannelName).toMatch(/^[a-z]{3}-\d{4}-hc-discord-lead$/);
  });

  it("persists the channel id as soon as it's recorded, independent of any signup message", async () => {
    await discordSyncService.recordRunChannel({ runId: channelRunId, channelId: "run-chan-1" });
    const work = await discordSyncService.listSyncWork();
    const item = work.signups.find((entry) => entry.runId === channelRunId);
    expect(item?.existingRunChannelId).toBe("run-chan-1");
    // No signup message recorded yet, so this is still sync work.
    expect(item?.existingMessageId).toBeNull();
  });

  it("repeated sync never re-provisions a channel: the same channel id is reused every pass", async () => {
    await discordSyncService.recordSignupPost({ runId: channelRunId, channelId: "run-chan-1", messageId: "run-msg-1" });
    let work = await discordSyncService.listSyncWork();
    expect(work.signups.some((entry) => entry.runId === channelRunId)).toBe(false);

    work = await discordSyncService.listSyncWork();
    const stillNoWork = !work.signups.some((entry) => entry.runId === channelRunId);
    expect(stillNoWork).toBe(true);

    const persisted = await runDiscordPostRepository.findByRunId(channelRunId);
    expect(persisted?.runChannelId).toBe("run-chan-1");
  });

  it("a schedule change produces a new desiredChannelName (rename), while the persisted channel id is untouched", async () => {
    const before = await runDiscordPostRepository.findByRunId(channelRunId);
    const newSchedule = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();

    await runService.updateRun(lead, {
      runId: channelRunId,
      title: "Channel Rename Test",
      raidId,
      difficulty: "HEROIC",
      scheduledStartAt: newSchedule,
      notes: null,
      desiredTankCount: 1,
      desiredHealerCount: 1,
      desiredDpsCount: 2,
    });

    const work = await discordSyncService.listSyncWork();
    const item = work.signups.find((entry) => entry.runId === channelRunId);
    // The desired name changed (new schedule), so this is sync work again —
    // but the run's channel identity (existingRunChannelId) never changes:
    // a rename edits the same channel, it does not create a replacement.
    expect(item).toBeTruthy();
    expect(item?.existingRunChannelId).toBe("run-chan-1");
    expect(item?.existingRunChannelId).toBe(before?.runChannelId);
  });

  it("survives a restart: a fresh read of persisted state still finds the same channel id (no duplicate provisioning)", async () => {
    const persisted = await runDiscordPostRepository.findByRunId(channelRunId);
    expect(persisted?.runChannelId).toBe("run-chan-1");
  });

  it("a Run that already reached CANCELLED without ever being signup-available never gets a channel/signup post", async () => {
    const neverOpenedRunId = await runService
      .createRun(lead, {
        raidId,
        difficulty: "HEROIC",
        scheduledStartAt: futureIso(),
        desiredTankCount: 1,
        desiredHealerCount: 1,
        desiredDpsCount: 2,
      })
      .then((run) => run.id);
    createdRunIds.push(neverOpenedRunId);
    await runService.cancelRun(lead, neverOpenedRunId);

    const work = await discordSyncService.listSyncWork();
    expect(work.signups.some((entry) => entry.runId === neverOpenedRunId)).toBe(false);

    const persisted = await runDiscordPostRepository.findByRunId(neverOpenedRunId);
    expect(persisted).toBeNull();
  });

  it("never generates roster work for a published Run the bot had no Discord presence for (would otherwise let the roster path provision a channel on its own)", async () => {
    const orphanRunId = await runService
      .createRun(lead, {
        raidId,
        difficulty: "HEROIC",
        scheduledStartAt: futureIso(),
        desiredTankCount: 1,
        desiredHealerCount: 0,
        desiredDpsCount: 0,
      })
      .then((run) => run.id);
    createdRunIds.push(orphanRunId);
    await runService.openRun(lead, orphanRunId);

    const orphanCharId = crypto.randomUUID();
    createdCharacterIds.push(orphanCharId);
    await orm.Character.create({
      id: orphanCharId,
      userId: ids.tank,
      name: "Dsorphan",
      realm: "Discord Lab",
      normalizedName: normalizeCharacterIdentity("Dsorphan"),
      normalizedRealm: normalizeCharacterIdentity("Discord Lab"),
      region: "EU",
      wowClass: "PALADIN",
      specialization: "Protection",
      primaryRole: "TANK",
      itemLevel: 700,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await createSignup({ runId: orphanRunId, userId: ids.tank, characterId: orphanCharId, participationType: "BOOSTER", role: "TANK" });

    const view = await rosterService.getRosterManagementView(lead, orphanRunId);
    const tankSignup = view.groups.tanks[0];
    await rosterService.setDraftSelection(lead, { runId: orphanRunId, signupId: tankSignup.id, selected: true, version: view.roster.version });
    const afterSelect = await rosterService.getRosterManagementView(lead, orphanRunId);
    await rosterService.publishRoster(lead, { runId: orphanRunId, version: afterSelect.roster.version, acknowledgeWarnings: true });

    // The bot never recorded a channel or a signup post for this Run at any point.
    const persisted = await runDiscordPostRepository.findByRunId(orphanRunId);
    expect(persisted).toBeNull();

    const work = await discordSyncService.listSyncWork();
    expect(work.roster.some((entry) => entry.runId === orphanRunId)).toBe(false);
  });
});

describe("discordSyncService — archive category movement", () => {
  it("flags archived:true after Archive and archived:false again after Restore, with the channel identity untouched", async () => {
    const archiveRunId = await runService
      .createRun(lead, {
        raidId,
        difficulty: "HEROIC",
        scheduledStartAt: futureIso(),
        desiredTankCount: 1,
        desiredHealerCount: 1,
        desiredDpsCount: 2,
      })
      .then((run) => run.id);
    createdRunIds.push(archiveRunId);
    await runService.openRun(lead, archiveRunId);
    await discordSyncService.recordRunChannel({ runId: archiveRunId, channelId: "archive-chan-1" });
    await discordSyncService.recordSignupPost({ runId: archiveRunId, channelId: "archive-chan-1", messageId: "archive-msg-1" });

    let work = await discordSyncService.listSyncWork();
    expect(work.signups.some((entry) => entry.runId === archiveRunId)).toBe(false);

    await runRepository.updateFields(archiveRunId, { status: "CANCELLED" });
    await runService.archiveRun(lead, archiveRunId);

    work = await discordSyncService.listSyncWork();
    const archived = work.signups.find((entry) => entry.runId === archiveRunId);
    expect(archived?.archived).toBe(true);
    expect(archived?.existingRunChannelId).toBe("archive-chan-1");

    // The bot resyncs (same channel, same message) once it observes the new signature.
    await discordSyncService.recordSignupPost({ runId: archiveRunId, channelId: "archive-chan-1", messageId: "archive-msg-1" });
    work = await discordSyncService.listSyncWork();
    expect(work.signups.some((entry) => entry.runId === archiveRunId)).toBe(false);

    await runService.restoreRun(lead, archiveRunId);
    work = await discordSyncService.listSyncWork();
    const restored = work.signups.find((entry) => entry.runId === archiveRunId);
    expect(restored?.archived).toBe(false);
    expect(restored?.existingRunChannelId).toBe("archive-chan-1");
  });

  it("generates no sync work — and so requests no channel — for an archived Run that never had Discord presence", async () => {
    const bareRunId = await runService
      .createRun(lead, {
        raidId,
        difficulty: "HEROIC",
        scheduledStartAt: futureIso(),
        desiredTankCount: 1,
        desiredHealerCount: 1,
        desiredDpsCount: 2,
      })
      .then((run) => run.id);
    createdRunIds.push(bareRunId);
    await runRepository.updateFields(bareRunId, { status: "CANCELLED" });
    await runService.archiveRun(lead, bareRunId);

    const work = await discordSyncService.listSyncWork();
    expect(work.signups.some((entry) => entry.runId === bareRunId)).toBe(false);
    expect(work.roster.some((entry) => entry.runId === bareRunId)).toBe(false);
    expect(await runDiscordPostRepository.findByRunId(bareRunId)).toBeNull();
  });
});
