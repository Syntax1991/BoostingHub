import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import { rosterRepository } from "@/repositories/roster.repository";
import { runService } from "@/services/run.service";

/**
 * Regression: `Collection.delete()` removes only the FIRST matching row, so
 * clearing draft selections for several signups in the same roster used to
 * leave all but one roster entry behind.
 */

const ids = {
  lead: "dddddddd-dddd-4ddd-8ddd-cd0000000001",
  playerA: "dddddddd-dddd-4ddd-8ddd-cd0000000002",
  playerB: "dddddddd-dddd-4ddd-8ddd-cd0000000003",
  playerKeep: "dddddddd-dddd-4ddd-8ddd-cd0000000004",
};
const createdUserIds = Object.values(ids);

const lead: AuthenticatedUser = {
  id: ids.lead,
  name: "Clear Draft Lead",
  email: `${ids.lead}@cleardraft.boostting.local`,
  image: null,
  discordUserId: null,
  discordUsername: null,
  accountRole: "RAID_LEAD",
  accountStatus: "ACTIVE",
};

async function createTestUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]) {
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name,
    email: `${id}@cleardraft.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
}

async function cleanupUser(userId: string) {
  // Run deletion cascades to its roster, roster entries and signups.
  const runs = await orm.Run.where({ raidLeadId: userId }).select("id").all();
  for (const row of runs) {
    await orm.Run.where({ id: (row as { id: string }).id }).delete();
  }
  await orm.User.where({ id: userId }).delete().catch(() => {});
}

async function createPendingSignup(runId: string, userId: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.RunSignup.create({
    id,
    runId,
    userId,
    characterId: null,
    participationType: "BOOSTER",
    isBackup: false,
    status: "PENDING",
    publishedRole: null,
    lootbuddyMode: null,
    lootbuddyVerification: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function createRosterEntry(rosterId: string, signupId: string) {
  const now = new Date().toISOString();
  await orm.RunRosterEntry.create({
    id: crypto.randomUUID(),
    rosterId,
    signupId,
    selected: true,
    selectedRole: "MELEE_DPS",
    createdAt: now,
    updatedAt: now,
  });
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  for (const userId of createdUserIds) {
    await cleanupUser(userId);
  }
  await createTestUser(ids.lead, "Clear Draft Lead", "RAID_LEAD");
  await createTestUser(ids.playerA, "Clear Draft A", "USER");
  await createTestUser(ids.playerB, "Clear Draft B", "USER");
  await createTestUser(ids.playerKeep, "Clear Draft Keep", "USER");
}, 60_000);

afterAll(async () => {
  for (const userId of createdUserIds) {
    await cleanupUser(userId);
  }
}, 60_000);

describe("rosterRepository.clearDraftSelectionsForSignupIds", () => {
  it("removes every matching entry when several signups share one roster", async () => {
    const scheduledStartAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const run = await runService.createRun(lead, venomousCreateInput({ scheduledStartAt }));
    const roster = await rosterRepository.ensure(run.id);

    const signupA = await createPendingSignup(run.id, ids.playerA);
    const signupB = await createPendingSignup(run.id, ids.playerB);
    const signupKeep = await createPendingSignup(run.id, ids.playerKeep);
    for (const signupId of [signupA, signupB, signupKeep]) {
      await createRosterEntry(roster.id, signupId);
    }

    await rosterRepository.clearDraftSelectionsForSignupIds([signupA, signupB]);

    const remaining = (await orm.RunRosterEntry.where({ rosterId: roster.id }).all()) as Array<{
      signupId: string;
    }>;
    expect(remaining.map((entry) => entry.signupId)).toEqual([signupKeep]);

    const after = await orm.RunRoster.where({ id: roster.id }).first();
    expect((after as { version: number }).version).toBe(roster.version + 1);
  });
});
