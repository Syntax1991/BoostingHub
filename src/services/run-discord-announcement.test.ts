import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { discordTimestamp } from "@/lib/discord-timestamp";
import { orm } from "@/lib/prisma";
import { venomousCreateInput, venomousUpdateInput } from "@/lib/test-run-input";
import type { CharacterRole } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import {
  runCancelledChannelSourceKey,
  runDiscordAnnouncementRepository,
  runRescheduledChannelSourceKey,
} from "@/repositories/run-discord-announcement.repository";
import { runRepository } from "@/repositories/run.repository";
import { userNotificationRepository } from "@/repositories/user-notification.repository";
import { discordSyncService } from "@/services/discord-sync.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";
import {
  buildRunCancelledChannelEmbed,
  buildRunRescheduledChannelEmbed,
} from "@/discord-bot/embeds/run-lifecycle-announcement";

const ids = {
  lead: "a4444444-4444-4444-8444-444444444401",
  admin: "a4444444-4444-4444-8444-444444444402",
  player: "a4444444-4444-4444-8444-444444444403",
};

const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdAccessIds: string[] = [];

let scheduleSlot = 0;
function futureIso(days = 14) {
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
    email: `${id}@announce.boostting.local`,
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
  opts: { discordUserId?: string | null; discordDmEnabled?: boolean; dmRunCancelledEnabled?: boolean; dmRunRescheduledEnabled?: boolean } = {},
) {
  await orm.User.create({
    id,
    name,
    email: `${id}@announce.boostting.local`,
    emailVerified: true,
    discordUserId: opts.discordUserId ?? null,
    discordUsername: opts.discordUserId ? `u${opts.discordUserId}` : null,
    accountRole,
    accountStatus: "ACTIVE",
    discordDmEnabled: opts.discordDmEnabled ?? true,
    dmRosterSelectedEnabled: true,
    dmRaidInviteEnabled: true,
    dmRunCancelledEnabled: opts.dmRunCancelledEnabled ?? true,
    dmRunRescheduledEnabled: opts.dmRunRescheduledEnabled ?? true,
    dmRosterRemovedEnabled: true,
    timeZone: "Europe/Berlin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function createCharacter(input: {
  userId: string;
  name: string;
  wowClass: "SHAMAN" | "PALADIN" | "HUNTER" | "PRIEST" | "MONK";
  specialization: string;
  primaryRole: CharacterRole;
}) {
  const id = crypto.randomUUID();
  createdCharacterIds.push(id);
  await orm.Character.create({
    id,
    userId: input.userId,
    name: input.name,
    realm: "Announce Realm",
    normalizedName: normalizeCharacterIdentity(input.name),
    normalizedRealm: normalizeCharacterIdentity("Announce Realm"),
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
    notes: "announce lifecycle",
    grantedAt: now,
    grantedById: ids.admin,
    revokedAt: null,
    revokedById: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function cleanupAll() {
  for (const runId of createdRunIds.splice(0)) {
    const announcements = await orm.RunDiscordAnnouncement.where({ runId }).select("id").all();
    for (const row of announcements) {
      await orm.RunDiscordAnnouncement.where({ id: (row as { id: string }).id }).delete();
    }
    const notes = await orm.UserNotification.where({ runId }).select("id").all();
    for (const row of notes) {
      await orm.UserNotification.where({ id: (row as { id: string }).id }).delete();
    }
    try {
      await orm.Run.where({ id: runId }).delete();
    } catch {
      // gone
    }
  }
  for (const characterId of createdCharacterIds.splice(0)) {
    try {
      await orm.Character.where({ id: characterId }).delete();
    } catch {
      // gone
    }
  }
  for (const accessId of createdAccessIds.splice(0)) {
    try {
      await orm.BoosterQualification.where({ id: accessId }).delete();
    } catch {
      // gone
    }
  }
  for (const userId of Object.values(ids)) {
    const quals = await orm.BoosterQualification.where({ userId }).select("id").all();
    for (const row of quals) {
      await orm.BoosterQualification.where({ id: (row as { id: string }).id }).delete();
    }
    const notes = await orm.UserNotification.where({ userId }).select("id").all();
    for (const row of notes) {
      await orm.UserNotification.where({ id: (row as { id: string }).id }).delete();
    }
    try {
      await orm.User.where({ id: userId }).delete();
    } catch {
      // gone
    }
  }
}

const lead = asUser(ids.lead, "Announce Lead", "RAID_LEAD");
const player = asUser(ids.player, "Announce Player", "USER", "930000000000000001");

let charPlayer = "";
let charLead = "";

async function openSignedRun(scheduledStartAt: string) {
  const created = await runService.createRun(
    lead,
    venomousCreateInput({
      scheduledStartAt,
      desiredTankCount: 1,
      desiredHealerCount: 1,
      desiredDpsCount: 1,
    }),
  );
  createdRunIds.push(created.id);
  await runService.openRun(lead, created.id);
  await signupService.createBoosterSignup(player, {
    runId: created.id,
    characterId: charPlayer,
    role: "HEALER",
    isBackup: false,
  });
  return created.id;
}

async function updateSchedule(runId: string, scheduledStartAt: string, extra: Record<string, unknown> = {}) {
  const run = await runRepository.findById(runId);
  if (!run) throw new Error("run missing");
  await runService.updateRun(lead, venomousUpdateInput(runId, run, { scheduledStartAt, ...extra }));
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await cleanupAll();
  await createTestUser(ids.lead, "Announce Lead", "RAID_LEAD");
  await createTestUser(ids.admin, "Announce Admin", "ADMIN");
  await createTestUser(ids.player, "Announce Player", "USER", { discordUserId: "930000000000000001" });
  await approveAccess(ids.lead);
  await approveAccess(ids.player);
  charPlayer = await createCharacter({
    userId: ids.player,
    name: "AnnA",
    wowClass: "SHAMAN",
    specialization: "Restoration",
    primaryRole: "HEALER",
  });
  charLead = await createCharacter({
    userId: ids.lead,
    name: "AnnLead",
    wowClass: "PALADIN",
    specialization: "Protection",
    primaryRole: "TANK",
  });
  void charLead;
});

afterAll(async () => {
  await cleanupAll();
});

describe("RunDiscordAnnouncement enqueue", () => {
  it("schedule change creates one PENDING RUN_RESCHEDULED announcement", async () => {
    const runId = await openSignedRun(futureIso());
    const before = await runRepository.findById(runId);
    const oldStart = before!.scheduledStartAt;
    const nextStart = futureIso(15);

    await updateSchedule(runId, nextStart);

    const pending = await runDiscordAnnouncementRepository.listPending(100);
    const forRun = pending.filter((row) => row.runId === runId);
    expect(forRun).toHaveLength(1);
    expect(forRun[0].type).toBe("RUN_RESCHEDULED");
    expect(forRun[0].status).toBe("PENDING");
    expect(forRun[0].sourceKey).toBe(runRescheduledChannelSourceKey(runId, 1));
    expect(forRun[0].previousScheduledStartAt).toBe(oldStart);
    expect(Date.parse(forRun[0].scheduledStartAt)).toBe(Date.parse(nextStart));
  });

  it("unrelated Run edit does not create an announcement", async () => {
    const runId = await openSignedRun(futureIso());
    const beforeCount = (await runDiscordAnnouncementRepository.listPending(200)).filter(
      (row) => row.runId === runId,
    ).length;

    const run = await runRepository.findById(runId);
    await runService.updateRun(
      lead,
      venomousUpdateInput(runId, run!, { notes: "notes only", desiredHealerCount: 2 }),
    );

    const after = (await runDiscordAnnouncementRepository.listPending(200)).filter((row) => row.runId === runId);
    expect(after).toHaveLength(beforeCount);
  });

  it("retry same revision does not duplicate channel announcement", async () => {
    const runId = await openSignedRun(futureIso());
    const nextStart = futureIso(16);
    await updateSchedule(runId, nextStart);
    const first = await runDiscordAnnouncementRepository.listPending(200);
    const keys = first.filter((row) => row.runId === runId).map((row) => row.sourceKey);
    expect(keys).toEqual([runRescheduledChannelSourceKey(runId, 1)]);

    const dup = await runDiscordAnnouncementRepository.createIgnoreDuplicate({
      runId,
      type: "RUN_RESCHEDULED",
      sourceKey: runRescheduledChannelSourceKey(runId, 1),
      previousScheduledStartAt: nextStart,
      scheduledStartAt: nextStart,
      productLabel: "x",
      difficulty: "HEROIC",
      lootType: "VIP",
    });
    expect(dup).toBeNull();
    expect(
      (await runDiscordAnnouncementRepository.listPending(200)).filter((row) => row.runId === runId),
    ).toHaveLength(1);
  });

  it("second real schedule change creates a second distinct announcement", async () => {
    const runId = await openSignedRun(futureIso());
    const start1 = futureIso(17);
    const start2 = futureIso(18);
    await updateSchedule(runId, start1);
    await updateSchedule(runId, start2);
    const rows = (await runDiscordAnnouncementRepository.listPending(200)).filter((row) => row.runId === runId);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.sourceKey).sort()).toEqual(
      [runRescheduledChannelSourceKey(runId, 1), runRescheduledChannelSourceKey(runId, 2)].sort(),
    );
  });

  it("cancel creates one PENDING RUN_CANCELLED announcement; retry does not duplicate", async () => {
    const runId = await openSignedRun(futureIso());
    await runService.cancelRun(lead, runId);
    const rows = (await runDiscordAnnouncementRepository.listPending(200)).filter((row) => row.runId === runId);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("RUN_CANCELLED");
    expect(rows[0].sourceKey).toBe(runCancelledChannelSourceKey(runId));

    const again = await runDiscordAnnouncementRepository.createIgnoreDuplicate({
      runId,
      type: "RUN_CANCELLED",
      sourceKey: runCancelledChannelSourceKey(runId),
      previousScheduledStartAt: null,
      scheduledStartAt: rows[0].scheduledStartAt,
      productLabel: "x",
      difficulty: "HEROIC",
      lootType: "VIP",
    });
    expect(again).toBeNull();
  });
});

describe("RunDiscordAnnouncement sync work + retirement barrier", () => {
  it("existing channel surfaces announcement with runChannelId; retire blocked while PENDING", async () => {
    const runId = await openSignedRun(futureIso());
    await discordSyncService.recordRunChannel({ runId, channelId: "announce-chan-1" });
    await runService.cancelRun(lead, runId);

    const work = await discordSyncService.listSyncWork();
    const announcement = work.runAnnouncements.find((row) => row.runId === runId);
    expect(announcement).toBeTruthy();
    expect(announcement!.type).toBe("RUN_CANCELLED");
    expect(announcement!.runChannelId).toBe("announce-chan-1");

    const channel = work.channels.find((row) => row.runId === runId);
    expect(channel?.pendingLifecycleAnnouncements).toBe(true);
    expect(channel?.retireChannel).toBe(false);
  });

  it("no Run channel → announcement still PENDING in work with null runChannelId; no channel created", async () => {
    const runId = await openSignedRun(futureIso());
    await runService.cancelRun(lead, runId);
    const work = await discordSyncService.listSyncWork();
    const announcement = work.runAnnouncements.find((row) => row.runId === runId);
    expect(announcement?.runChannelId ?? null).toBeNull();
    expect(work.channels.some((row) => row.runId === runId)).toBe(false);
  });

  it("after SENT, retirement barrier lifts", async () => {
    const runId = await openSignedRun(futureIso());
    await discordSyncService.recordRunChannel({ runId, channelId: "announce-chan-2" });
    await runService.cancelRun(lead, runId);
    const pending = (await runDiscordAnnouncementRepository.listPending(50)).find((row) => row.runId === runId);
    expect(pending).toBeTruthy();
    await discordSyncService.recordRunAnnouncementDelivery({
      announcementId: pending!.id,
      result: "SENT",
    });
    const work = await discordSyncService.listSyncWork();
    expect(work.runAnnouncements.some((row) => row.runId === runId)).toBe(false);
    const channel = work.channels.find((row) => row.runId === runId);
    expect(channel?.pendingLifecycleAnnouncements).toBe(false);
    expect(channel?.retireChannel).toBe(true);
  });

  it("ordering: reschedule then cancel appear createdAt ASC in runAnnouncements", async () => {
    const runId = await openSignedRun(futureIso());
    await discordSyncService.recordRunChannel({ runId, channelId: "announce-chan-3" });
    const start1 = futureIso(20);
    const start2 = futureIso(21);
    await updateSchedule(runId, start1);
    await updateSchedule(runId, start2);
    await runService.cancelRun(lead, runId);

    const work = await discordSyncService.listSyncWork();
    const forRun = work.runAnnouncements.filter((row) => row.runId === runId);
    expect(forRun.map((row) => row.type)).toEqual(["RUN_RESCHEDULED", "RUN_RESCHEDULED", "RUN_CANCELLED"]);
    const pending = (await runDiscordAnnouncementRepository.listPending(200)).filter((row) => row.runId === runId);
    expect(pending.map((row) => row.sourceKey)).toEqual([
      runRescheduledChannelSourceKey(runId, 1),
      runRescheduledChannelSourceKey(runId, 2),
      runCancelledChannelSourceKey(runId),
    ]);
  });
});

describe("User delivery regression vs channel announcements", () => {
  it("master DM OFF: web notification still created; DM SKIPPED; channel announcement still PENDING", async () => {
    await orm.User.where({ id: ids.player }).update({
      discordDmEnabled: false,
      updatedAt: new Date().toISOString(),
    });
    const runId = await openSignedRun(futureIso());
    await runService.cancelRun(lead, runId);

    const notes = await userNotificationRepository.listForUser(ids.player, 20);
    const cancelNote = notes.find((row) => row.runId === runId && row.type === "RUN_CANCELLED");
    expect(cancelNote).toBeTruthy();
    expect(cancelNote!.discordDeliveryStatus).toBe("SKIPPED");

    const announcements = (await runDiscordAnnouncementRepository.listPending(50)).filter(
      (row) => row.runId === runId,
    );
    expect(announcements).toHaveLength(1);
    expect(announcements[0].status).toBe("PENDING");

    await orm.User.where({ id: ids.player }).update({
      discordDmEnabled: true,
      updatedAt: new Date().toISOString(),
    });
  });

  it("channel announcement ignores User DM preferences", async () => {
    await orm.User.where({ id: ids.player }).update({
      dmRunRescheduledEnabled: false,
      updatedAt: new Date().toISOString(),
    });
    const runId = await openSignedRun(futureIso());
    await updateSchedule(runId, futureIso(22));

    const notes = await userNotificationRepository.listForUser(ids.player, 20);
    const rescheduleNote = notes.find((row) => row.runId === runId && row.type === "RUN_RESCHEDULED");
    expect(rescheduleNote?.discordDeliveryStatus).toBe("SKIPPED");

    const announcements = (await runDiscordAnnouncementRepository.listPending(50)).filter(
      (row) => row.runId === runId && row.type === "RUN_RESCHEDULED",
    );
    expect(announcements).toHaveLength(1);
    expect(announcements[0].status).toBe("PENDING");

    await orm.User.where({ id: ids.player }).update({
      dmRunRescheduledEnabled: true,
      updatedAt: new Date().toISOString(),
    });
  });
});

describe("channel embed copy", () => {
  it("reschedule embed includes native Discord old/new timestamps", () => {
    const oldIso = "2026-10-01T18:00:00.000Z";
    const newIso = "2026-10-01T20:00:00.000Z";
    const embed = buildRunRescheduledChannelEmbed({
      productLabel: "Season 2 Bundle",
      previousScheduledStartAt: oldIso,
      scheduledStartAt: newIso,
      difficulty: "HEROIC",
      lootType: "VIP",
    });
    const json = embed.toJSON();
    expect(json.title).toContain("Run Rescheduled");
    expect(json.description).toContain(discordTimestamp(oldIso, "F"));
    expect(json.description).toContain(discordTimestamp(newIso, "F"));
    expect(json.description).not.toMatch(/@everyone|@here/);
  });

  it("cancel embed includes product and schedule timestamp", () => {
    const when = "2026-10-02T19:00:00.000Z";
    const embed = buildRunCancelledChannelEmbed({
      productLabel: "Season 2 Bundle",
      scheduledStartAt: when,
      difficulty: "HEROIC",
      lootType: "VIP",
    });
    const json = embed.toJSON();
    expect(json.title).toContain("Run Cancelled");
    expect(json.description).toContain("Season 2 Bundle");
    expect(json.description).toContain(discordTimestamp(when, "F"));
  });
});
