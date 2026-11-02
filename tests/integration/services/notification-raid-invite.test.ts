import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { anyContentRunInput } from "@tests/fixtures/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import {
  raidInviteSourceKey,
  userNotificationRepository,
} from "@/repositories/user-notification.repository";
import { discordSyncService } from "@/services/discord-sync.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import type { CharacterRole } from "@/models/enums";
import { testActor } from "@tests/fixtures/actors";
import {
  assertIsolatedTestDatabase,
  createTestCharacter,
  createTestUser,
  deleteCreatedRows,
  syntheticDiscordId,
} from "@tests/fixtures/db-fixtures";
import { DAY_MS, HOUR_MS } from "@tests/fixtures/time";

const REALM = "Notify Invite";
const created = { runIds: [] as string[], characterIds: [] as string[], userIds: [] as string[] };
const ids = { lead: "", dps: "", player: "", skipped: "" };
let playerDiscordId: string;
let lead: AuthenticatedUser;
let charPlayer = "";
let charSkipped = "";
let charLeadTank = "";
let charDps = "";

let scheduleSlot = 0;
function futureIso() {
  const slot = scheduleSlot++;
  return new Date(Date.now() + 14 * DAY_MS + slot * 3 * HOUR_MS).toISOString();
}

async function createBooster(name: string, accountRole: AuthenticatedUser["accountRole"], discordUserId: string | null) {
  const id = await createTestUser({ name, accountRole, discordUserId, isBooster: true });
  created.userIds.push(id);
  return id;
}

async function createCharacter(
  userId: string,
  name: string,
  wowClass: "SHAMAN" | "PALADIN" | "HUNTER" | "PRIEST",
  specialization: string,
  primaryRole: CharacterRole,
) {
  const id = await createTestCharacter({ userId, name, realm: REALM, wowClass, specialization, primaryRole });
  created.characterIds.push(id);
  return id;
}

async function createSignup(input: { runId: string; userId: string; characterId: string; role: CharacterRole }) {
  // The Raid Lead's Character already has a Booster offer from Run creation:
  // reuse it with exactly the requested role instead of inserting a duplicate.
  const existing = (await orm.RunSignup.where({
    runId: input.runId,
    userId: input.userId,
    characterId: input.characterId,
    participationType: "BOOSTER",
  }).first()) as { id: string } | null;
  const now = new Date().toISOString();
  if (existing) {
    await orm.RunSignupRole.where({ signupId: existing.id }).deleteAndCount();
    await orm.RunSignupRole.create({ id: crypto.randomUUID(), signupId: existing.id, role: input.role, createdAt: now });
    return existing.id;
  }
  const id = crypto.randomUUID();
  await orm.RunSignup.create({
    id,
    runId: input.runId,
    userId: input.userId,
    characterId: input.characterId,
    participationType: "BOOSTER",
    isBackup: false,
    status: "PENDING",
    publishedRole: null,
    lootbuddyMode: null,
    lootbuddyVerification: null,
    createdAt: now,
    updatedAt: now,
  });
  await orm.RunSignupRole.create({ id: crypto.randomUUID(), signupId: id, role: input.role, createdAt: now });
  return id;
}

/** Open Run, the given signups selected in their role, published, started. Signup ids come back in input order. */
async function startedRunWith(
  healerTarget: number,
  signups: Array<{ userId: string; characterId: string; role: CharacterRole }>,
) {
  const { id: runId } = await runService.createRun(
    lead,
    anyContentRunInput({ scheduledStartAt: futureIso(), desiredTankCount: 1, desiredHealerCount: healerTarget, desiredDpsCount: 1 }),
  );
  created.runIds.push(runId);
  await runService.openRun(lead, runId);
  const selections: Array<{ signupId: string; selectedRole: CharacterRole }> = [];
  for (const signup of signups) {
    selections.push({ signupId: await createSignup({ runId, ...signup }), selectedRole: signup.role });
  }
  let view = await rosterService.getRosterManagementView(lead, runId);
  await rosterService.saveDraftSelection(lead, { runId, version: view.roster.version, selections });
  view = await rosterService.getRosterManagementView(lead, runId);
  await rosterService.publishRoster(lead, { runId, version: view.roster.version, acknowledgeWarnings: true });
  await runService.startRun(lead, { runId });
  return { runId, signupIds: selections.map((selection) => selection.signupId) };
}

async function raidInvitesFor(userId: string, runId: string) {
  return (await userNotificationRepository.listForUser(userId, 20)).filter((row) => row.type === "RAID_INVITE" && row.runId === runId);
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  await raidRepository.ensureReferenceRaids();
  playerDiscordId = syntheticDiscordId();
  ids.lead = await createBooster("Notify Invite Lead", "RAID_LEAD", null);
  ids.dps = await createBooster("Notify Invite Dps", "USER", null);
  ids.player = await createBooster("Notify Invite Player", "USER", playerDiscordId);
  ids.skipped = await createBooster("Notify Invite Skipped", "USER", syntheticDiscordId());
  await orm.User.where({ id: ids.skipped }).update({ dmRaidInviteEnabled: false });
  lead = testActor(ids.lead, "RAID_LEAD");

  charPlayer = await createCharacter(ids.player, "NInviteA", "SHAMAN", "Restoration", "HEALER");
  charSkipped = await createCharacter(ids.skipped, "NInviteB", "PRIEST", "Holy", "HEALER");
  charLeadTank = await createCharacter(ids.lead, "NILeadTank", "PALADIN", "Protection", "TANK");
  charDps = await createCharacter(ids.dps, "NIDps", "HUNTER", "Beast Mastery", "RANGED_DPS");
});

afterAll(async () => {
  assertIsolatedTestDatabase();
  // Attendance references roster entries with RESTRICT, so it goes before its Run.
  for (const runId of created.runIds) await orm.RunAttendance.where({ runId }).deleteAndCount();
  await deleteCreatedRows(created);
});

describe("notification raid invite + bot delivery", () => {
  it("creates RAID_INVITE on start (PENDING/SKIPPED) and delivers it via notificationDms", async () => {
    const { runId, signupIds } = await startedRunWith(2, [
      { userId: ids.lead, characterId: charLeadTank, role: "TANK" },
      { userId: ids.dps, characterId: charDps, role: "RANGED_DPS" },
      { userId: ids.player, characterId: charPlayer, role: "HEALER" },
      { userId: ids.skipped, characterId: charSkipped, role: "HEALER" },
    ]);
    const [, , healer, healerSkipped] = signupIds as [string, string, string, string];

    const pendingPlayer = await raidInvitesFor(ids.player, runId);
    expect(pendingPlayer).toHaveLength(1);
    expect(pendingPlayer[0].sourceKey).toBe(raidInviteSourceKey(runId, healer));
    expect(pendingPlayer[0].discordDeliveryStatus).toBe("PENDING");
    expect(pendingPlayer[0].discordUserId).toBe(playerDiscordId);

    const skipped = await raidInvitesFor(ids.skipped, runId);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].discordDeliveryStatus).toBe("SKIPPED");
    expect(skipped[0].discordUserId).toBeNull();

    // Idempotent second create path (sourceKey)
    const again = await userNotificationRepository.createIgnoreDuplicate({
      userId: ids.player,
      type: "RAID_INVITE",
      runId,
      signupId: healer,
      sourceKey: raidInviteSourceKey(runId, healer),
      title: "dup",
      message: "dup",
      href: "/runs",
      discordDeliveryStatus: "PENDING",
      discordUserId: playerDiscordId,
    });
    expect(again).toBeNull();

    const work = await discordSyncService.listSyncWork();
    const dm = work.notificationDms.find((item) => item.signupId === healer && item.type === "RAID_INVITE");
    expect(dm?.notificationId).toBe(pendingPlayer[0].id);
    expect(work.notificationDms.some((item) => item.signupId === healerSkipped && item.type === "RAID_INVITE")).toBe(false);

    await discordSyncService.recordNotificationDmDelivery({ notificationId: pendingPlayer[0].id, result: "SENT" });
    expect((await userNotificationRepository.findById(pendingPlayer[0].id))?.discordDeliveryStatus).toBe("SENT");

    const workAfter = await discordSyncService.listSyncWork();
    expect(workAfter.notificationDms.some((item) => item.notificationId === pendingPlayer[0].id)).toBe(false);

    // SKIPPED stays skipped — never appears as work even if preference later enabled
    await orm.User.where({ id: ids.skipped }).update({ dmRaidInviteEnabled: true, updatedAt: new Date().toISOString() });
    try {
      const workPrefs = await discordSyncService.listSyncWork();
      expect(workPrefs.notificationDms.some((item) => item.signupId === healerSkipped && item.type === "RAID_INVITE")).toBe(false);
      expect(workPrefs.notificationDms.some((item) => item.notificationId === skipped[0].id)).toBe(false);
    } finally {
      await orm.User.where({ id: ids.skipped }).update({ dmRaidInviteEnabled: false, updatedAt: new Date().toISOString() });
    }
  });

  it("marks FAILED_PERMANENT and does not retry", async () => {
    const { runId } = await startedRunWith(1, [
      { userId: ids.lead, characterId: charLeadTank, role: "TANK" },
      { userId: ids.dps, characterId: charDps, role: "RANGED_DPS" },
      { userId: ids.player, characterId: charPlayer, role: "HEALER" },
    ]);

    const [invite] = await raidInvitesFor(ids.player, runId);
    expect(invite).toBeDefined();

    await discordSyncService.recordNotificationDmDelivery({ notificationId: invite!.id, result: "FAILED_PERMANENT" });
    expect((await userNotificationRepository.findById(invite!.id))?.discordDeliveryStatus).toBe("FAILED_PERMANENT");

    const work = await discordSyncService.listSyncWork();
    expect(work.notificationDms.some((item) => item.notificationId === invite!.id)).toBe(false);
  });
});
