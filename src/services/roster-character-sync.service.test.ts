import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import type { AccountRole } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { rosterRepository } from "@/repositories/roster.repository";

const syncMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/character-blizzard-sync.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/character-blizzard-sync.service")>();
  return { ...actual, syncLinkedCharacterProfile: syncMock };
});

const { rosterCharacterSyncService } = await import("@/services/roster-character-sync.service");

const ids = {
  lead: "cccccccc-cccc-4ccc-8ccc-rcs000000001",
  owner: "cccccccc-cccc-4ccc-8ccc-rcs000000002",
  user: "cccccccc-cccc-4ccc-8ccc-rcs000000003",
  run: "cccccccc-cccc-4ccc-8ccc-rcsr00000001",
  charStale: "cccccccc-cccc-4ccc-8ccc-rcsc00000001",
  charFresh: "cccccccc-cccc-4ccc-8ccc-rcsc00000002",
  charUnpicked: "cccccccc-cccc-4ccc-8ccc-rcsc00000003",
  signupStale: "cccccccc-cccc-4ccc-8ccc-rcss00000001",
  signupFresh: "cccccccc-cccc-4ccc-8ccc-rcss00000002",
  signupUnpicked: "cccccccc-cccc-4ccc-8ccc-rcss00000003",
};

function asUser(id: string, accountRole: AccountRole): AuthenticatedUser {
  return {
    id,
    name: id,
    email: `${id}@rcs.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function createUser(id: string, accountRole: AccountRole) {
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name: id,
    email: `${id}@rcs.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
    isBooster: true,
    isLootbuddy: false,
    createdAt: now,
    updatedAt: now,
  });
}

async function createCharacter(id: string, name: string, lastSyncedAt: string | null) {
  const now = new Date().toISOString();
  await orm.Character.create({
    id,
    userId: ids.owner,
    name,
    realm: "Blackrock",
    region: "EU",
    normalizedName: name.toLowerCase(),
    normalizedRealm: "blackrock",
    wowClass: "PRIEST",
    specialization: "Holy",
    primaryRole: "HEALER",
    itemLevel: 330,
    isActive: true,
    lastSyncedAt,
    createdAt: now,
    updatedAt: now,
  });
}

async function createSignup(id: string, characterId: string) {
  const now = new Date().toISOString();
  await orm.RunSignup.create({
    id,
    runId: ids.run,
    userId: ids.owner,
    characterId,
    participationType: "BOOSTER",
    isBackup: false,
    status: "PENDING",
    publishedRole: null,
    createdAt: now,
    updatedAt: now,
  });
  await orm.RunSignupRole.create({ id: crypto.randomUUID(), signupId: id, role: "HEALER", createdAt: now });
}

async function cleanup() {
  const roster = (await orm.RunRoster.where({ runId: ids.run }).first()) as { id: string } | null;
  if (roster) {
    await orm.RunRosterEntry.where({ rosterId: roster.id }).delete().catch(() => {});
    await orm.RunRoster.where({ id: roster.id }).delete().catch(() => {});
  }
  for (const signupId of [ids.signupStale, ids.signupFresh, ids.signupUnpicked]) {
    await orm.RunSignupRole.where({ signupId }).delete().catch(() => {});
    await orm.RunSignup.where({ id: signupId }).delete().catch(() => {});
  }
  await orm.RunRaidContent.where({ runId: ids.run }).delete().catch(() => {});
  await orm.Run.where({ id: ids.run }).delete().catch(() => {});
  for (const id of [ids.charStale, ids.charFresh, ids.charUnpicked]) {
    await orm.Character.where({ id }).delete().catch(() => {});
  }
  for (const id of [ids.lead, ids.owner, ids.user]) {
    await orm.User.where({ id }).delete().catch(() => {});
  }
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await cleanup();
});

beforeEach(async () => {
  syncMock.mockReset();
  syncMock.mockResolvedValue({ lockoutSynced: true });
  await cleanup();
  const now = new Date().toISOString();
  await createUser(ids.lead, "RAID_LEAD");
  await createUser(ids.owner, "USER");
  await createUser(ids.user, "USER");
  await createCharacter(ids.charStale, "RcsStale", null);
  await createCharacter(ids.charFresh, "RcsFresh", now);
  await createCharacter(ids.charUnpicked, "RcsUnpicked", null);
  await orm.Run.create({
    id: ids.run,
    title: "RCS Run",
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    scheduledStartAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    status: "OPEN",
    signupsOpen: true,
    desiredTankCount: 0,
    desiredHealerCount: 2,
    desiredDpsCount: 0,
    desiredLootbuddyCount: 0,
    raidLeadId: ids.lead,
    notes: null,
    createdAt: now,
    updatedAt: now,
  });
  await orm.RunRaidContent.create({
    id: crypto.randomUUID(),
    runId: ids.run,
    raidId: VENOMOUS_ABYSS_RAID_ID,
    sortOrder: 1,
    plannedBossCount: 8,
    createdAt: now,
  });
  await createSignup(ids.signupStale, ids.charStale);
  await createSignup(ids.signupFresh, ids.charFresh);
  await createSignup(ids.signupUnpicked, ids.charUnpicked);
  const roster = await rosterRepository.ensure(ids.run);
  await rosterRepository.replaceSelectedSignupIds(roster.id, roster.version, [
    { signupId: ids.signupStale, selectedRole: "HEALER" },
    { signupId: ids.signupFresh, selectedRole: "HEALER" },
  ]);
});

afterAll(async () => {
  await cleanup();
});

describe("rosterCharacterSyncService.syncStaleSelected", () => {
  it("syncs only the selected Characters without a fresh sync — server-chosen, through the one sync entry point", async () => {
    const result = await rosterCharacterSyncService.syncStaleSelected(asUser(ids.lead, "RAID_LEAD"), ids.run);
    expect(result).toEqual({ synced: 1, failed: 0, skipped: 0 });
    expect(syncMock).toHaveBeenCalledTimes(1);
    const [owner, character, , options] = syncMock.mock.calls[0]!;
    expect(owner).toMatchObject({ id: ids.owner });
    expect(character).toMatchObject({ id: ids.charStale });
    expect(options).toMatchObject({ trigger: "ROSTER_MANAGER", writeActivity: false });
  });

  it("respects the manual refresh cooldown and a sync already in progress", async () => {
    await orm.Character.where({ id: ids.charStale }).update({ lastSyncAttemptAt: new Date().toISOString() });
    expect(await rosterCharacterSyncService.syncStaleSelected(asUser(ids.lead, "RAID_LEAD"), ids.run)).toEqual({
      synced: 0,
      failed: 0,
      skipped: 1,
    });
    await orm.Character.where({ id: ids.charStale }).update({ lastSyncAttemptAt: null });
    syncMock.mockRejectedValueOnce(new DomainError("CHARACTER_SYNC_IN_PROGRESS", "busy", 409));
    expect(await rosterCharacterSyncService.syncStaleSelected(asUser(ids.lead, "RAID_LEAD"), ids.run)).toMatchObject({
      skipped: 1,
    });
    syncMock.mockRejectedValueOnce(new Error("Blizzard down"));
    expect(await rosterCharacterSyncService.syncStaleSelected(asUser(ids.lead, "RAID_LEAD"), ids.run)).toMatchObject({
      failed: 1,
    });
  });

  it("is manager-only and refused once the Run has started", async () => {
    await expect(
      rosterCharacterSyncService.syncStaleSelected(asUser(ids.user, "USER"), ids.run),
    ).rejects.toMatchObject({ code: "RUN_NOT_MANAGEABLE" });
    await orm.Run.where({ id: ids.run }).update({ status: "IN_PROGRESS" });
    await expect(
      rosterCharacterSyncService.syncStaleSelected(asUser(ids.lead, "RAID_LEAD"), ids.run),
    ).rejects.toMatchObject({ code: "INVALID_ROSTER_SELECTION" });
    expect(syncMock).not.toHaveBeenCalled();
  });
});

describe("roster view model — Smart Replacement inputs (no extra queries per candidate)", () => {
  it("carries each Character's sync health and the picked players who withdrew", async () => {
    const { rosterService } = await import("@/services/roster.service");
    const { signupService } = await import("@/services/signup.service");
    const lead = asUser(ids.lead, "RAID_LEAD");

    const view = await rosterService.getRosterManagementView(lead, ids.run);
    const health = new Map(view.boosters.map((row) => [row.id, row.syncHealth]));
    expect(health.get(ids.signupStale)).toBe("NEVER_SYNCED");
    expect(health.get(ids.signupFresh)).toBe("HEALTHY");
    expect(view.withdrawnPicks).toEqual([]);
    expect(view.run.lateFill).toBe(false);

    await signupService.withdrawPickedSignup(asUser(ids.owner, "USER"), {
      signupId: ids.signupStale,
      reason: "Raid with my guild",
    });
    const after = await rosterService.getRosterManagementView(lead, ids.run);
    expect(after.boosters.some((row) => row.id === ids.signupStale)).toBe(false);
    expect(after.withdrawnPicks).toEqual([
      expect.objectContaining({
        signupId: ids.signupStale,
        characterLabel: "RcsStale-Blackrock",
        reason: "Raid with my guild",
        assignableRoles: ["HEALER"],
      }),
    ]);
  });

  it("Late Fill is flagged close to the start without changing the Run status", async () => {
    const { rosterService } = await import("@/services/roster.service");
    await orm.Run.where({ id: ids.run }).update({ scheduledStartAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });
    const view = await rosterService.getRosterManagementView(asUser(ids.lead, "RAID_LEAD"), ids.run);
    expect(view.run.lateFill).toBe(true);
    expect(view.run.status).toBe("OPEN");
  });
});
