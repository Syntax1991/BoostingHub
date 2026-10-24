import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import {
  buildClosedDiscordRunChannelName,
  buildDiscordRunChannelName,
  effectiveRaidLeadChannelName,
} from "@/lib/discord-channel-name";
import { orm } from "@/lib/prisma";
import { venomousCreateInput, seededProductSelection } from "@/lib/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import { discordSyncService } from "@/services/discord-sync.service";
import { runService } from "@/services/run.service";
import { settingsService } from "@/services/settings.service";

const ids = {
  lead: "c6666666-6666-4666-8666-666666666601",
  admin: "c6666666-6666-4666-8666-666666666602",
  user: "c6666666-6666-4666-8666-666666666603",
  otherLead: "c6666666-6666-4666-8666-666666666604",
};

const createdRunIds: string[] = [];
let scheduleSlot = 0;
function futureIso(days = 14) {
  const slot = scheduleSlot++;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000 + slot * 3 * 60 * 60 * 1000).toISOString();
}

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"],
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@nick.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function createTestUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]) {
  await orm.User.create({
    id,
    name,
    email: `${id}@nick.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
    discordDmEnabled: true,
    dmRosterSelectedEnabled: true,
    dmRaidInviteEnabled: true,
    dmRunCancelledEnabled: true,
    dmRunRescheduledEnabled: true,
    dmRosterRemovedEnabled: true,
    timeZone: "Europe/Berlin",
    discordRunChannelNickname: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function cleanupAll() {
  for (const runId of createdRunIds.splice(0)) {
    try {
      await orm.Run.where({ id: runId }).delete();
    } catch {
      // gone
    }
  }
  for (const userId of Object.values(ids)) {
    try {
      await orm.User.where({ id: userId }).delete();
    } catch {
      // gone
    }
  }
}

const lead = asUser(ids.lead, "Syntax1991", "RAID_LEAD");
const admin = asUser(ids.admin, "AdminLead", "ADMIN");
const plainUser = asUser(ids.user, "NormalUser", "USER");
const otherLead = asUser(ids.otherLead, "Nero1991", "RAID_LEAD");

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await cleanupAll();
  await createTestUser(ids.lead, "Syntax1991", "RAID_LEAD");
  await createTestUser(ids.admin, "AdminLead", "ADMIN");
  await createTestUser(ids.user, "NormalUser", "USER");
  await createTestUser(ids.otherLead, "Nero1991", "RAID_LEAD");
});

afterAll(async () => {
  await cleanupAll();
});

describe("Run channel nickname settings", () => {
  it("RAID_LEAD and ADMIN see Run Channels; USER does not", async () => {
    expect((await settingsService.getSettings(lead)).runChannels.canConfigure).toBe(true);
    expect((await settingsService.getSettings(admin)).runChannels.canConfigure).toBe(true);
    expect((await settingsService.getSettings(plainUser)).runChannels.canConfigure).toBe(false);
  });

  it("USER forged mutation is rejected", async () => {
    await expect(
      settingsService.updateRunChannelPreferences(plainUser, { discordRunChannelNickname: "Nope" }),
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });

  it("RAID_LEAD and ADMIN may update own nickname; empty → null", async () => {
    const set = await settingsService.updateRunChannelPreferences(lead, {
      discordRunChannelNickname: "Syntax",
    });
    expect(set.runChannels.discordRunChannelNickname).toBe("Syntax");

    const cleared = await settingsService.updateRunChannelPreferences(lead, {
      discordRunChannelNickname: "   ",
    });
    expect(cleared.runChannels.discordRunChannelNickname).toBeNull();

    await settingsService.updateRunChannelPreferences(admin, { discordRunChannelNickname: "Admin" });
    expect((await settingsService.getSettings(admin)).runChannels.discordRunChannelNickname).toBe("Admin");
    await settingsService.updateRunChannelPreferences(admin, { discordRunChannelNickname: null });
  });

  it("cannot update another User — repository only writes the authenticated id", async () => {
    await settingsService.updateRunChannelPreferences(lead, { discordRunChannelNickname: "Syntax" });
    await settingsService.updateRunChannelPreferences(otherLead, { discordRunChannelNickname: "Nero" });
    expect((await settingsService.getSettings(lead)).runChannels.discordRunChannelNickname).toBe("Syntax");
    expect((await settingsService.getSettings(otherLead)).runChannels.discordRunChannelNickname).toBe("Nero");
  });

  it("max length accepted; over max and empty slug rejected", async () => {
    const max = "a".repeat(24);
    expect(
      (await settingsService.updateRunChannelPreferences(lead, { discordRunChannelNickname: max }))
        .runChannels.discordRunChannelNickname,
    ).toBe(max);

    await expect(
      settingsService.updateRunChannelPreferences(lead, { discordRunChannelNickname: "a".repeat(25) }),
    ).rejects.toBeInstanceOf(DomainError);

    await expect(
      settingsService.updateRunChannelPreferences(lead, { discordRunChannelNickname: "___" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    const accent = await settingsService.updateRunChannelPreferences(lead, {
      discordRunChannelNickname: "Sÿntax",
    });
    expect(accent.runChannels.discordRunChannelNickname).toBe("Sÿntax");
  });
});

describe("Run channel nickname in Discord sync projection", () => {
  it("the Raid Lead nickname is the Run display identity: title, Discord channel and Run record; account name kept", async () => {
    await settingsService.updateRunChannelPreferences(lead, { discordRunChannelNickname: "Syntax" });
    const created = await runService.createRun(
      lead,
      venomousCreateInput({
        scheduledStartAt: futureIso(),
        desiredTankCount: 1,
        desiredHealerCount: 1,
        desiredDpsCount: 1,
      }),
    );
    createdRunIds.push(created.id);
    await runService.openRun(lead, created.id);

    const run = await runRepository.findById(created.id);
    expect(run?.title.endsWith(" Syntax")).toBe(true);
    expect(run?.raidLeadDisplayName).toBe("Syntax");
    // Account identity is untouched.
    expect(run?.raidLeadName).toBe("Syntax1991");
    expect((await settingsService.getSettings(lead)).runChannels.discordRunChannelNickname).toBe("Syntax");
    expect(((await orm.User.where({ id: ids.lead }).first()) as { name: string }).name).toBe("Syntax1991");

    await discordSyncService.recordRunChannel({ runId: created.id, channelId: "nick-chan-1" });
    const work = await discordSyncService.listSyncWork();
    const channel = work.channels.find((row) => row.runId === created.id);
    expect(channel?.desiredChannelName.endsWith("-syntax")).toBe(true);
    expect(channel?.desiredChannelName.endsWith("-syntax1991")).toBe(false);
  });

  it("without a nickname the title uses User.name", async () => {
    await settingsService.updateRunChannelPreferences(lead, { discordRunChannelNickname: null });
    const created = await runService.createRun(
      lead,
      venomousCreateInput({ scheduledStartAt: futureIso(), desiredTankCount: 1, desiredHealerCount: 1, desiredDpsCount: 1 }),
    );
    createdRunIds.push(created.id);
    const run = await runRepository.findById(created.id);
    expect(run?.title.endsWith(" Syntax1991")).toBe(true);
    expect(run?.raidLeadDisplayName).toBe("Syntax1991");
  });

  it("saving a new nickname re-titles the Raid Lead's not-yet-ended Runs; ended / archived Runs keep their title", async () => {
    await settingsService.updateRunChannelPreferences(lead, { discordRunChannelNickname: "Syntax" });
    const create = async () => {
      const created = await runService.createRun(
        lead,
        venomousCreateInput({ scheduledStartAt: futureIso(), desiredTankCount: 1, desiredHealerCount: 1, desiredDpsCount: 1 }),
      );
      createdRunIds.push(created.id);
      return created.id;
    };
    const active = await create();
    const opened = await create();
    await runService.openRun(lead, opened);
    const completed = await create();
    await orm.Run.where({ id: completed }).update({ status: "COMPLETED" });
    const archived = await create();
    await orm.Run.where({ id: archived }).update({ status: "CANCELLED", archivedAt: new Date().toISOString() });
    // Another Raid Lead's Run is never touched.
    const foreign = await runService.createRun(
      otherLead,
      venomousCreateInput({ scheduledStartAt: futureIso(), desiredTankCount: 1, desiredHealerCount: 1, desiredDpsCount: 1 }),
    );
    createdRunIds.push(foreign.id);
    const foreignTitle = (await runRepository.findById(foreign.id))!.title;

    await settingsService.updateRunChannelPreferences(lead, { discordRunChannelNickname: "Neo" });
    const title = async (id: string) => (await runRepository.findById(id))!.title;
    expect((await title(active)).endsWith(" Neo")).toBe(true);
    expect((await title(opened)).endsWith(" Neo")).toBe(true);
    expect((await title(completed)).endsWith(" Syntax")).toBe(true);
    expect((await title(archived)).endsWith(" Syntax")).toBe(true);
    expect(await title(foreign.id)).toBe(foreignTitle);

    // Clearing the nickname falls back to the account name, same rule.
    await settingsService.updateRunChannelPreferences(lead, { discordRunChannelNickname: null });
    expect((await title(active)).endsWith(" Syntax1991")).toBe(true);
    expect((await title(completed)).endsWith(" Syntax")).toBe(true);
  });

  it("an explicit edit re-titles with the current display identity; unrelated profile changes do nothing", async () => {
    await settingsService.updateRunChannelPreferences(lead, { discordRunChannelNickname: "Syntax" });
    const created = await runService.createRun(
      lead,
      venomousCreateInput({ scheduledStartAt: futureIso(), desiredTankCount: 1, desiredHealerCount: 1, desiredDpsCount: 1 }),
    );
    createdRunIds.push(created.id);
    await orm.User.where({ id: ids.lead }).update({ timeZone: "Europe/Vilnius" });
    const run = (await runRepository.findById(created.id))!;
    expect(run.title.endsWith(" Syntax")).toBe(true);
    await runService.updateRun(lead, {
      runId: created.id,
      difficulty: run.difficulty,
      lootType: run.lootType,
      scheduledStartAt: run.scheduledStartAt,
      desiredTankCount: 1,
      desiredHealerCount: 1,
      desiredDpsCount: 1,
      notes: "re-title",
      ...seededProductSelection("VENOMOUS_ABYSS", 8),
    });
    expect((await runRepository.findById(created.id))?.title.endsWith(" Syntax")).toBe(true);
    await orm.User.where({ id: ids.lead }).update({ timeZone: "Europe/Berlin" });
    await settingsService.updateRunChannelPreferences(lead, { discordRunChannelNickname: null });
  });

  it("Raid Lead reassignment uses the new lead nickname for desiredChannelName", async () => {
    await settingsService.updateRunChannelPreferences(lead, { discordRunChannelNickname: "Syntax" });
    await settingsService.updateRunChannelPreferences(otherLead, { discordRunChannelNickname: "Nero" });
    const created = await runService.createRun(
      lead,
      venomousCreateInput({
        scheduledStartAt: futureIso(),
        desiredTankCount: 1,
        desiredHealerCount: 1,
        desiredDpsCount: 1,
      }),
    );
    createdRunIds.push(created.id);
    await runService.openRun(lead, created.id);
    await discordSyncService.recordRunChannel({ runId: created.id, channelId: "nick-chan-2" });

    const before = await runRepository.findById(created.id);
    await runService.updateRun(admin, {
      runId: created.id,
      difficulty: before!.difficulty,
      lootType: before!.lootType,
      scheduledStartAt: before!.scheduledStartAt,
      notes: before!.notes,
      desiredTankCount: before!.desiredTankCount,
      desiredHealerCount: before!.desiredHealerCount,
      desiredDpsCount: before!.desiredDpsCount,
      ...seededProductSelection("VENOMOUS_ABYSS", 8),
      raidLeadId: ids.otherLead,
    });

    const after = await runRepository.findById(created.id);
    expect(after?.raidLeadId).toBe(ids.otherLead);
    expect(after?.raidLeadDiscordRunChannelNickname).toBe("Nero");
    const work = await discordSyncService.listSyncWork();
    const channel = work.channels.find((row) => row.runId === created.id);
    expect(channel?.desiredChannelName.endsWith("-nero")).toBe(true);
  });

  it("closed channel name uses nickname", () => {
    expect(
      buildClosedDiscordRunChannelName({
        scheduledStartAt: "2026-09-12T20:00:00.000Z",
        difficulty: "HEROIC",
        lootType: "VIP",
        coverage: "9of9",
        raidLeadChannelName: effectiveRaidLeadChannelName({
          raidLeadName: "Syntax1991",
          discordRunChannelNickname: "Syntax",
        }),
      }),
    ).toBe("closed-sat-2200-hc-vip-9of9-syntax");
  });

  it("first provision desired name uses nickname (no intermediate User.name slug)", async () => {
    await settingsService.updateRunChannelPreferences(lead, { discordRunChannelNickname: "Syntax" });
    const created = await runService.createRun(
      lead,
      venomousCreateInput({
        scheduledStartAt: futureIso(),
        desiredTankCount: 1,
        desiredHealerCount: 1,
        desiredDpsCount: 1,
      }),
    );
    createdRunIds.push(created.id);
    await runService.openRun(lead, created.id);
    const run = await runRepository.findById(created.id);
    const name = buildDiscordRunChannelName({
      scheduledStartAt: run!.scheduledStartAt,
      difficulty: run!.difficulty,
      lootType: run!.lootType,
      coverage: run!.contentDisplay.channelCoverage,
      raidLeadChannelName: effectiveRaidLeadChannelName({
        raidLeadName: run!.raidLeadName,
        discordRunChannelNickname: run!.raidLeadDiscordRunChannelNickname,
      }),
    });
    expect(name.endsWith("-syntax")).toBe(true);
  });
});
