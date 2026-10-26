import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import type { RaidIdFilter } from "@/lib/raid-id-filter";
import { venomousCreateInput } from "@/lib/test-run-input";
import { classifyRunWeek } from "@/lib/wow-run-week";
import { raidRepository } from "@/repositories/raid.repository";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";

/**
 * /runs and /my-runs filter by the same raid-ID window (one helper over
 * classifyRunWeek), and My Runs filters before Selected / Pending / … grouping.
 */

const ids = { lead: "b1d50000-0000-4000-8000-000000000001", booster: "b1d50000-0000-4000-8000-000000000002" };
const lead: AuthenticatedUser = {
  id: ids.lead, name: "RaidId Lead", email: "raidid-lead@local", image: null, discordUserId: null, discordUsername: null,
  accountRole: "RAID_LEAD", accountStatus: "ACTIVE",
};
const booster: AuthenticatedUser = { ...lead, id: ids.booster, name: "RaidId Booster", email: "raidid-booster@local", accountRole: "USER" };
const runIds: Record<"current" | "next" | "later", string> = { current: "", next: "", later: "" };
const now = new Date();

async function cleanup() {
  for (const row of (await orm.Run.where({ raidLeadId: ids.lead }).select("id").all()) as Array<{ id: string }>) {
    await orm.Run.where({ id: row.id }).delete().catch(() => {});
  }
  for (const id of Object.values(ids)) {
    await orm.Character.where({ userId: id }).delete().catch(() => {});
    await orm.ActivityEvent.where({ userId: id }).delete().catch(() => {});
    await orm.User.where({ id }).delete().catch(() => {});
  }
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await cleanup();
  const createdAt = now.toISOString();
  for (const [id, role] of [[ids.lead, "RAID_LEAD"], [ids.booster, "USER"]] as const) {
    await orm.User.create({ id, name: id, email: `${id}@raidid.local`, emailVerified: true, accountRole: role, accountStatus: "ACTIVE", isBooster: false, createdAt, updatedAt: createdAt });
  }
  const characterId = crypto.randomUUID();
  await orm.Character.create({
    id: characterId, userId: ids.booster, name: "Raidido", realm: "RaidId", normalizedName: normalizeCharacterIdentity("Raidido"),
    normalizedRealm: normalizeCharacterIdentity("RaidId"), region: "EU", wowClass: "MAGE", specialization: "Frost", primaryRole: "RANGED_DPS",
    itemLevel: 700, isActive: true, createdAt, updatedAt: createdAt,
  });
  const { nextStart, followingStart } = classifyRunWeek({ scheduledStartAt: createdAt, now });
  const next = Date.parse(nextStart);
  // Still in the current ID (between now and the next reset), then in the next ID, then the one after.
  const starts = {
    current: new Date(now.getTime() + Math.max(60_000, (next - now.getTime()) / 2)).toISOString(),
    next: new Date(next + 60 * 60 * 1000).toISOString(),
    later: new Date(Date.parse(followingStart) + 60 * 60 * 1000).toISOString(),
  };
  for (const key of ["current", "next", "later"] as const) {
    const run = await runService.createRun(lead, venomousCreateInput({ scheduledStartAt: starts[key] }));
    runIds[key] = run.id;
    await orm.Run.where({ id: run.id }).update({ status: "OPEN" });
    await orm.RunSignup.create({
      id: crypto.randomUUID(), runId: run.id, userId: ids.booster, characterId, participationType: "BOOSTER", isBackup: false,
      status: "PENDING", publishedRole: null, createdAt, updatedAt: createdAt,
    });
  }
});

afterAll(cleanup);

async function runsFor(filter: RaidIdFilter) {
  const listed = await runService.listRuns(booster, {}, filter, now);
  return listed.map((run) => run.id).filter((id) => Object.values(runIds).includes(id)).sort();
}

async function myRunsFor(filter: RaidIdFilter) {
  const mine = await signupService.getMyRuns(booster, { raidId: filter, now });
  return [...mine.pending, ...mine.selected, ...mine.notSelected, ...mine.withdrawn].map((item) => item.runId).sort();
}

describe("raid-ID filter on /runs and /my-runs", () => {
  it("Current ID, Next ID and All select the same Runs on both pages", async () => {
    const expected: Record<RaidIdFilter, string[]> = {
      current: [runIds.current],
      next: [runIds.next],
      all: [runIds.current, runIds.next, runIds.later].sort(),
    };
    for (const filter of ["current", "next", "all"] as const) {
      expect(await runsFor(filter)).toEqual(expected[filter]);
      expect(await myRunsFor(filter)).toEqual(expected[filter]);
    }
  });

  it("My Runs filters before grouping: the Pending group only holds the chosen ID", async () => {
    const mine = await signupService.getMyRuns(booster, { raidId: "next", now });
    expect(mine.pending.map((item) => item.runId)).toEqual([runIds.next]);
    expect(mine.selected).toEqual([]);
  });

  it("without a filter (dashboard / bot callers) My Runs is unchanged", async () => {
    const mine = await signupService.getMyRuns(booster);
    expect(mine.pending.map((item) => item.runId).sort()).toEqual([runIds.current, runIds.next, runIds.later].sort());
  });
});
