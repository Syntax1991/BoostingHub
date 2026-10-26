import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import { runDiscordPostRepository } from "@/repositories/run-discord-post.repository";
import { discordSyncService } from "@/services/discord-sync.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";

/**
 * The Signup Discord post carries signup state only; the Roster post carries
 * selection. A composition / pick-count change must not refresh the Signup
 * post, a note change must.
 */

const ids = {
  lead: "b4d50000-0000-4000-8000-000000000001",
  a: "b4d50000-0000-4000-8000-000000000002",
  b: "b4d50000-0000-4000-8000-000000000003",
};
const lead: AuthenticatedUser = {
  id: ids.lead, name: "Sem Lead", email: "sem-lead@local", image: null, discordUserId: null, discordUsername: null,
  accountRole: "RAID_LEAD", accountStatus: "ACTIVE",
};
const userA: AuthenticatedUser = { ...lead, id: ids.a, name: "Sem A", email: "sem-a@local", accountRole: "USER" };
let runId = "";

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

async function signupWorkFor(id: string) {
  return (await discordSyncService.listSyncWork()).signups.some((entry) => entry.runId === id);
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await cleanup();
  const now = new Date().toISOString();
  for (const id of Object.values(ids)) {
    await orm.User.create({
      id, name: id, email: `${id}@sem.local`, emailVerified: true, accountRole: id === ids.lead ? "RAID_LEAD" : "USER",
      accountStatus: "ACTIVE", isBooster: false, createdAt: now, updatedAt: now,
    });
  }
  const run = await runService.createRun(lead, venomousCreateInput());
  runId = run.id;
  await orm.Run.where({ id: runId }).update({ status: "OPEN", desiredHealerCount: 3 });
  // Three healer Characters from two Users.
  for (const [userId, name] of [[ids.a, "Sema"], [ids.a, "Semb"], [ids.b, "Semc"]] as const) {
    const characterId = crypto.randomUUID();
    await orm.Character.create({
      id: characterId, userId, name, realm: "Sem", normalizedName: normalizeCharacterIdentity(name), normalizedRealm: normalizeCharacterIdentity("Sem"),
      region: "EU", wowClass: "PRIEST", specialization: "Holy", primaryRole: "HEALER", itemLevel: 700, isActive: true, createdAt: now, updatedAt: now,
    });
    const signupId = crypto.randomUUID();
    await orm.RunSignup.create({
      id: signupId, runId, userId, characterId, participationType: "BOOSTER", isBackup: false, status: "PENDING", publishedRole: null, createdAt: now, updatedAt: now,
    });
    await orm.RunSignupRole.create({ id: crypto.randomUUID(), signupId, role: "HEALER", createdAt: now });
  }
  await discordSyncService.recordSignupPost({ runId, channelId: "chan-sem", messageId: "msg-sem" });
});

afterAll(cleanup);

describe("Signup post = signup state", () => {
  it("counts: distinct signed-up Users for the summary and per role (one line per User) for the headings", async () => {
    const data = (await discordSyncService.getSignupEmbedData(runId))!;
    expect(data.uniqueSignupCount).toBe(2); // two Users, three Characters
    expect(data.roleStatus.healer.signed).toBe(2); // Users offering Healer (as the old "Healers — n"), not Characters
  });

  it("the stored Signup signature holds no picks and no composition targets", async () => {
    const post = await runDiscordPostRepository.findByRunId(runId);
    const signature = JSON.parse(post!.lastSignupSignature!) as Record<string, unknown>;
    expect(signature).not.toHaveProperty("picked");
    expect(signature.roleStatus).toEqual({
      tank: { signed: 0 },
      healer: { signed: 2 },
      dps: { signed: 0 },
      lootbuddy: { signed: 0 },
    });
  });

  it("a composition change does not refresh the Signup post; a signup note does", async () => {
    expect(await signupWorkFor(runId)).toBe(false);
    await orm.Run.where({ id: runId }).update({ desiredHealerCount: 4, desiredDpsCount: 13 });
    expect(await signupWorkFor(runId)).toBe(false);

    await signupService.setRunNote(userA, { runId, note: "can also play Shadow" });
    expect(await signupWorkFor(runId)).toBe(true);
    const data = (await discordSyncService.getSignupEmbedData(runId))!;
    expect(data.notes?.map((row) => [row.userId, row.note])).toEqual([[ids.a, "can also play Shadow"]]);
  });
});
