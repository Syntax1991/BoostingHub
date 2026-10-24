import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { UPCOMING_RUN_STATUSES } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { runService } from "@/services/run.service";

/**
 * List reads bounded in the query (performance): ended / archived Runs are not
 * loaded for lists that drop them anyway — results unchanged for the callers.
 */

const ids = { lead: "b0d50000-0000-4000-8000-000000000001", booster: "b0d50000-0000-4000-8000-000000000002" };
const lead: AuthenticatedUser = {
  id: ids.lead, name: "Bounds Lead", email: "bounds-lead@local", image: null, discordUserId: null, discordUsername: null,
  accountRole: "RAID_LEAD", accountStatus: "ACTIVE",
};
const runIds: Record<string, string> = {};
let characterId = "";

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
  const now = new Date().toISOString();
  for (const [id, role] of [[ids.lead, "RAID_LEAD"], [ids.booster, "USER"]] as const) {
    await orm.User.create({ id, name: id, email: `${id}@bounds.local`, emailVerified: true, accountRole: role, accountStatus: "ACTIVE", isBooster: false, createdAt: now, updatedAt: now });
  }
  characterId = crypto.randomUUID();
  await orm.Character.create({
    id: characterId, userId: ids.booster, name: "Boundsy", realm: "Bounds", normalizedName: normalizeCharacterIdentity("Boundsy"),
    normalizedRealm: normalizeCharacterIdentity("Bounds"), region: "EU", wowClass: "MAGE", specialization: "Frost", primaryRole: "RANGED_DPS",
    itemLevel: 700, isActive: true, createdAt: now, updatedAt: now,
  });
  for (const [key, status, archived] of [["open", "OPEN", false], ["completed", "COMPLETED", false], ["archived", "CANCELLED", true]] as const) {
    const run = await runService.createRun(lead, venomousCreateInput());
    runIds[key] = run.id;
    await orm.Run.where({ id: run.id }).update({ status, archivedAt: archived ? now : null });
    await orm.RunSignup.create({
      id: crypto.randomUUID(), runId: run.id, userId: ids.booster, characterId, participationType: "BOOSTER", isBackup: false,
      status: "PENDING", publishedRole: null, createdAt: now, updatedAt: now,
    });
  }
});

afterAll(cleanup);

describe("bounded list reads", () => {
  it("listUpcoming loads only upcoming Runs unless a status is chosen", async () => {
    const upcoming = (await runRepository.listUpcoming()).map((run) => run.id);
    expect(upcoming).toContain(runIds.open);
    expect(upcoming).not.toContain(runIds.completed);
    expect(upcoming).not.toContain(runIds.archived);
    expect((await runRepository.listUpcoming({ status: "COMPLETED" })).map((run) => run.id)).toContain(runIds.completed);
  });

  it("listByUserIdForRunStatuses returns exactly the upcoming subset of listByUserId", async () => {
    const all = await signupRepository.listByUserId(ids.booster);
    const bounded = await signupRepository.listByUserIdForRunStatuses(ids.booster, UPCOMING_RUN_STATUSES);
    expect(bounded.map((signup) => signup.id).sort()).toEqual(
      all.filter((signup) => UPCOMING_RUN_STATUSES.includes(signup.run.status)).map((signup) => signup.id).sort(),
    );
    expect(bounded.map((signup) => signup.run.id)).toEqual([runIds.open]);
  });

  it("listManagedUnarchived keeps ended-but-unarchived Runs and drops archived ones", async () => {
    const managed = (await runRepository.listManagedUnarchived()).map((run) => run.id);
    expect(managed).toEqual(expect.arrayContaining([runIds.open, runIds.completed]));
    expect(managed).not.toContain(runIds.archived);
  });
});
