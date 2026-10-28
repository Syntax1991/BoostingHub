import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { runRepository } from "@/repositories/run.repository";
import { userNotificationRepository } from "@/repositories/user-notification.repository";
import { boostingRoleService } from "@/services/boosting-role.service";
import { newlyKilledBossIds } from "@/services/character-blizzard-sync.service";
import { characterService } from "@/services/character.service";
import { discordSyncService } from "@/services/discord-sync.service";
import { lockoutService } from "@/services/lockout.service";
import {
  buildRosterCharacterSavedDmMessage,
  rosterCharacterSavedWebNotification,
} from "@/services/notification-content";
import { rosterService } from "@/services/roster.service";
import {
  parseRosterCharacterSavedSourceKey,
  planSavedNotices,
  rosterCharacterSavedSourceKey,
  rosterSavedNoticeService,
  type SavedNoticeCommitment,
} from "@/services/roster-saved-notice.service";
import { runService } from "@/services/run.service";
import { runStartSavedCheckService } from "@/services/run-start-saved-check.service";
import { signupService } from "@/services/signup.service";

// Warcraft Logs auto-link enrichment runs after Character writes; keep it offline.
vi.mock("@/integrations/warcraft-logs/warcraft-logs-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/warcraft-logs/warcraft-logs-api-client")>()),
  warcraftLogsApiClient: {
    isConfigured: () => true,
    findCharacter: async () => ({ status: "NOT_FOUND" as const }),
  },
}));

// Start Run's fresh sync must never reach Blizzard here: every call fails, so
// the check falls back to the stored lockouts (as it does when Blizzard is down).
vi.mock("@/integrations/blizzard/blizzard-api-client", () => ({
  blizzardApiClient: new Proxy({}, { get: () => () => Promise.reject(new Error("blizzard offline in tests")) }),
}));

// ---------------------------------------------------------------------------
// Pure planning
// ---------------------------------------------------------------------------

const BOSSES = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `boss-${n}`, name: `Boss ${n}`, sortOrder: n }));
const START = "2026-12-12T20:30:00.000Z"; // Saturday
const RESET = lockoutService.getResetIdentifierForRun("EU", START);

function commitment(overrides: Partial<SavedNoticeCommitment["run"]> = {}): SavedNoticeCommitment {
  return {
    signupId: "signup-1",
    run: {
      id: "run-1",
      title: "Sat 21:30 HC VIP 8/8 UwE",
      status: "PUBLISHED",
      difficulty: "HEROIC",
      scheduledStartAt: START,
      raidLeadId: "lead-1",
      contents: [{ raidId: "venom", plannedBossCount: 8, bosses: BOSSES }],
      ...overrides,
    },
  };
}

function kills(killed: string[], fresh: string[], overrides: Partial<{ raidId: string; difficulty: "HEROIC" | "MYTHIC"; resetIdentifier: string }> = {}) {
  return [{ raidId: "venom", difficulty: "HEROIC" as const, resetIdentifier: RESET, killedBossIds: killed, newBossIds: fresh, ...overrides }];
}

describe("planSavedNotices", () => {
  it("a new kill on a planned boss of a picked, not-started Run → one notice listing every saved planned boss", () => {
    const notices = planSavedNotices({
      region: "EU",
      kills: kills(["boss-1", "boss-2", "boss-3"], ["boss-3"]),
      commitments: [commitment()],
    });
    expect(notices).toEqual([
      {
        signupId: "signup-1",
        runId: "run-1",
        runTitle: "Sat 21:30 HC VIP 8/8 UwE",
        raidLeadId: "lead-1",
        bosses: BOSSES.slice(0, 3),
      },
    ]);
  });

  it("kills that were already known (saved when picked) never notify", () => {
    expect(planSavedNotices({ region: "EU", kills: kills(["boss-1"], []), commitments: [commitment()] })).toEqual([]);
  });

  it("a boss outside the planned range (HC 6/8 = first six) does not count", () => {
    const partial = commitment({ contents: [{ raidId: "venom", plannedBossCount: 6, bosses: BOSSES }] });
    expect(planSavedNotices({ region: "EU", kills: kills(["boss-8"], ["boss-8"]), commitments: [partial] })).toEqual([]);
    expect(planSavedNotices({ region: "EU", kills: kills(["boss-6"], ["boss-6"]), commitments: [partial] })).toHaveLength(1);
  });

  it("other difficulty, other raid ID or another raid never match", () => {
    const run = [commitment()];
    expect(planSavedNotices({ region: "EU", kills: kills(["boss-1"], ["boss-1"], { difficulty: "MYTHIC" }), commitments: run })).toEqual([]);
    expect(planSavedNotices({ region: "EU", kills: kills(["boss-1"], ["boss-1"], { resetIdentifier: "1999-W01" }), commitments: run })).toEqual([]);
    expect(planSavedNotices({ region: "EU", kills: kills(["boss-1"], ["boss-1"], { raidId: "tide" }), commitments: run })).toEqual([]);
  });

  it("only Runs before Start Run: IN_PROGRESS (kills in the Run itself) and later never notify", () => {
    for (const status of ["IN_PROGRESS", "COMPLETED", "CANCELLED"] as const) {
      expect(planSavedNotices({ region: "EU", kills: kills(["boss-1"], ["boss-1"]), commitments: [commitment({ status })] })).toEqual([]);
    }
    for (const status of ["OPEN", "ROSTERING", "PUBLISHED"] as const) {
      expect(planSavedNotices({ region: "EU", kills: kills(["boss-1"], ["boss-1"]), commitments: [commitment({ status })] })).toHaveLength(1);
    }
  });
});

describe("newlyKilledBossIds", () => {
  it("no stored row → every kill is new; stored ids → only the difference", () => {
    expect(newlyKilledBossIds(null, ["a", "b"])).toEqual(["a", "b"]);
    expect(newlyKilledBossIds({ killedBossIds: JSON.stringify(["a"]), bossesDefeated: 1 }, ["a", "b"])).toEqual(["b"]);
    expect(newlyKilledBossIds({ killedBossIds: JSON.stringify(["a", "b"]), bossesDefeated: 2 }, ["a", "b"])).toEqual([]);
  });

  it("legacy row without boss ids: new only when the kill count grew", () => {
    expect(newlyKilledBossIds({ killedBossIds: null, bossesDefeated: 2 }, ["a", "b"])).toEqual([]);
    expect(newlyKilledBossIds({ killedBossIds: null, bossesDefeated: 1 }, ["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("copy + source key", () => {
  it("player and Raid Lead texts", () => {
    const base = { runId: "run-1", runTitle: "Sat 21:30 HC VIP", characterLabel: "Stormhowl-Antonidas", playerName: "Kael", bossNames: ["Boss 1", "Boss 2"] };
    const player = rosterCharacterSavedWebNotification({ ...base, audience: "player" });
    expect(player.message).toContain("Stormhowl-Antonidas is picked for Sat 21:30 HC VIP but already killed Boss 1, Boss 2");
    expect(player.message).toContain("contact the Raid Lead");
    const lead = rosterCharacterSavedWebNotification({ ...base, audience: "lead" });
    expect(lead.message).toContain("Stormhowl-Antonidas (Kael) is picked for Sat 21:30 HC VIP and is now saved on Boss 1, Boss 2");
    expect(lead.href).toBe("/runs/run-1");

    const dm = buildRosterCharacterSavedDmMessage({
      audience: "lead",
      productLabel: "The Venomous Abyss",
      scheduledStartAt: START,
      difficulty: "HEROIC",
      lootType: "VIP",
      characterLabel: "Stormhowl-Antonidas",
      playerName: "Kael",
      bossNames: ["Boss 1"],
      url: "https://example.test/runs/run-1",
    });
    expect(dm).toContain("Picked Character got saved");
    expect(dm).toContain("**Stormhowl-Antonidas** (Kael) is picked and is now saved on **Boss 1**.");
    expect(dm).toContain("Check the roster: https://example.test/runs/run-1");
  });

  it("source key round-trips and changes with the boss set and audience", () => {
    const key = rosterCharacterSavedSourceKey("s-1", ["b", "a"], "lead");
    expect(parseRosterCharacterSavedSourceKey(key)).toEqual({ signupId: "s-1", bossIds: ["a", "b"], audience: "lead" });
    expect(rosterCharacterSavedSourceKey("s-1", ["a"], "lead")).not.toBe(key);
    expect(rosterCharacterSavedSourceKey("s-1", ["a", "b"], "player")).not.toBe(key);
    expect(parseRosterCharacterSavedSourceKey("character-battlenet-repair:x:y")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration: real draft pick → notifications + Discord DM work
// ---------------------------------------------------------------------------

const ids = {
  owner: "dddddddd-dddd-4ddd-8ddd-rsn000000001",
  lead: "dddddddd-dddd-4ddd-8ddd-rsn000000002",
  admin: "dddddddd-dddd-4ddd-8ddd-rsn000000003",
};
const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];

function asUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"] = "USER"): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@rsn.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function ensureUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"], discordUserId: string) {
  await orm.User.create({
    id,
    name,
    email: `${id}@rsn.boostting.local`,
    emailVerified: false,
    image: null,
    discordUserId,
    discordUsername: `u${discordUserId}`,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).catch(() => {});
}

async function cleanupRun(runId: string) {
  await orm.UserNotification.where({ runId }).delete().catch(() => {});
  const roster = await orm.RunRoster.where({ runId }).first();
  if (roster) {
    const rosterId = (roster as { id: string }).id;
    await orm.RunRosterEntry.where({ rosterId }).delete().catch(() => {});
    await orm.RunRoster.where({ id: rosterId }).delete().catch(() => {});
  }
  const signups = (await orm.RunSignup.where({ runId }).all()) as Array<{ id: string }>;
  for (const signup of signups) await orm.RunSignupRole.where({ signupId: signup.id }).delete().catch(() => {});
  await orm.RunSignup.where({ runId }).delete().catch(() => {});
  await orm.RunDiscordPost.where({ runId }).delete().catch(() => {});
  await orm.RunRaidContent.where({ runId }).delete().catch(() => {});
  await orm.Run.where({ id: runId }).delete().catch(() => {});
}

const owner = asUser(ids.owner, "RSN Owner");
const lead = asUser(ids.lead, "RSN Lead", "RAID_LEAD");
const admin = asUser(ids.admin, "RSN Admin", "ADMIN");

beforeAll(async () => {
  await ensureUser(ids.owner, "RSN Owner", "USER", "991700000000000001");
  await ensureUser(ids.lead, "RSN Lead", "RAID_LEAD", "991700000000000002");
  await ensureUser(ids.admin, "RSN Admin", "ADMIN", "991700000000000003");
  await boostingRoleService.setRole(admin, { userId: ids.owner, role: "BOOSTER", enabled: true }).catch(() => {});
  const leftover = (await orm.Character.where({ userId: ids.owner }).all()) as Array<{ id: string }>;
  for (const row of leftover) await orm.Character.where({ id: row.id }).delete().catch(() => {});
});

afterAll(async () => {
  for (const runId of createdRunIds) await cleanupRun(runId);
  for (const id of createdCharacterIds) await orm.Character.where({ id }).delete().catch(() => {});
});

describe("rosterSavedNoticeService.notifyNewKills", () => {
  it("draft-picked Character newly saved on a planned boss → player + Raid Lead (bell + DM), once per boss set", async () => {
    const character = await characterService.createCharacter(owner, {
      name: "Rsnstorm",
      realm: "Antonidas",
      region: "EU",
      wowClass: "PRIEST",
      specialization: "Holy",
      itemLevel: 640,
    });
    createdCharacterIds.push(character.id);
    const created = await runService.createRun(
      lead,
      venomousCreateInput({ scheduledStartAt: START, desiredTankCount: 0, desiredHealerCount: 1, desiredDpsCount: 0 }),
    );
    createdRunIds.push(created.id);
    await runService.openRun(lead, created.id);
    const offer = await signupService.createBoosterSignup(owner, {
      runId: created.id,
      characterId: character.id,
      role: "HEALER",
      isBackup: false,
    });

    const run = (await runRepository.findById(created.id))!;
    const content = run.contents[0]!;
    const [first, second] = [...content.bosses].sort((a, b) => a.sortOrder - b.sortOrder);
    const newKill = (killed: string[], fresh: string[]) => [
      { raidId: content.raidId, difficulty: run.difficulty, resetIdentifier: RESET, killedBossIds: killed, newBossIds: fresh },
    ];

    // Not picked yet: a pending offer is not a pick.
    expect(await rosterSavedNoticeService.notifyNewKills(character.id, newKill([first!.id], [first!.id]))).toBe(0);

    const view = await rosterService.getRosterManagementView(lead, created.id);
    await rosterService.saveDraftSelection(lead, {
      runId: created.id,
      version: view.roster.version,
      selections: [{ signupId: offer.id, selectedRole: "HEALER" }],
    });

    expect(await rosterSavedNoticeService.notifyNewKills(character.id, newKill([first!.id], [first!.id]))).toBe(2);
    // Same boss set again (next sync) → no duplicates.
    expect(await rosterSavedNoticeService.notifyNewKills(character.id, newKill([first!.id], [first!.id]))).toBe(0);

    const leadNotes = (await userNotificationRepository.listForUser(ids.lead)).filter(
      (row) => row.type === "ROSTER_CHARACTER_SAVED" && row.runId === created.id,
    );
    const ownerNotes = (await userNotificationRepository.listForUser(ids.owner)).filter(
      (row) => row.type === "ROSTER_CHARACTER_SAVED" && row.runId === created.id,
    );
    expect(leadNotes).toHaveLength(1);
    expect(ownerNotes).toHaveLength(1);
    expect(leadNotes[0]!.message).toContain(`Rsnstorm-Antonidas (RSN Owner) is picked for ${run.title} and is now saved on ${first!.name}`);
    expect(ownerNotes[0]!.message).toContain("contact the Raid Lead");

    // Discord DM work carries the structured notice for both.
    const work = await discordSyncService.listSyncWork();
    const dms = work.notificationDms.filter((item) => item.runId === created.id && item.type === "ROSTER_CHARACTER_SAVED");
    expect(dms.map((item) => item.characterSaved?.audience).sort()).toEqual(["lead", "player"]);
    expect(dms.find((item) => item.characterSaved?.audience === "lead")?.characterSaved).toMatchObject({
      characterLabel: "Rsnstorm-Antonidas",
      playerName: "RSN Owner",
      bossNames: [first!.name],
    });

    // A further kill notifies again with the full boss set.
    expect(await rosterSavedNoticeService.notifyNewKills(character.id, newKill([first!.id, second!.id], [second!.id]))).toBe(2);
  });
});

describe("runStartSavedCheckService (Start Run re-check)", () => {
  it("reminds each SELECTED player saved on a planned boss — once — and nobody else", async () => {
    const savedChar = await characterService.createCharacter(owner, {
      name: "Rsnsaved",
      realm: "Antonidas",
      region: "EU",
      wowClass: "PRIEST",
      specialization: "Holy",
      itemLevel: 640,
    });
    const cleanChar = await characterService.createCharacter(owner, {
      name: "Rsnclean",
      realm: "Antonidas",
      region: "EU",
      wowClass: "PRIEST",
      specialization: "Discipline",
      itemLevel: 640,
    });
    createdCharacterIds.push(savedChar.id, cleanChar.id);
    const start = "2026-12-19T20:30:00.000Z";
    const created = await runService.createRun(
      lead,
      venomousCreateInput({ scheduledStartAt: start, desiredTankCount: 0, desiredHealerCount: 2, desiredDpsCount: 0 }),
    );
    createdRunIds.push(created.id);
    await runService.openRun(lead, created.id);
    const savedOffer = await signupService.createBoosterSignup(owner, { runId: created.id, characterId: savedChar.id, role: "HEALER", isBackup: false });
    const cleanOffer = await signupService.createBoosterSignup(owner, { runId: created.id, characterId: cleanChar.id, role: "HEALER", isBackup: false });

    const run = (await runRepository.findById(created.id))!;
    const content = run.contents[0]!;
    const [first, second] = [...content.bosses].sort((a, b) => a.sortOrder - b.sortOrder);
    const resetIdentifier = lockoutService.getResetIdentifierForRun("EU", start);
    const now = new Date().toISOString();
    await orm.CharacterRaidLockout.create({
      id: crypto.randomUUID(),
      characterId: savedChar.id,
      raidId: content.raidId,
      difficulty: run.difficulty,
      resetIdentifier,
      bossesDefeated: 2,
      isComplete: false,
      killedBossIds: JSON.stringify([first!.id, second!.id]),
      createdAt: now,
      updatedAt: now,
    });

    // Not started yet → nothing (the check only runs for a started Run).
    expect(await runStartSavedCheckService.run(created.id)).toBe(0);

    // Published picks, Run started (state set directly — the roster/start flow is covered elsewhere).
    await orm.RunSignup.where({ id: savedOffer.id }).update({ status: "SELECTED", publishedRole: "HEALER" });
    await orm.RunSignup.where({ id: cleanOffer.id }).update({ status: "SELECTED", publishedRole: "HEALER" });
    await orm.Run.where({ id: created.id }).update({ status: "IN_PROGRESS" });

    expect(await runStartSavedCheckService.run(created.id)).toBe(1);
    expect(await runStartSavedCheckService.run(created.id)).toBe(0); // idempotent

    const reminders = (await userNotificationRepository.listForUser(ids.owner)).filter(
      (row) => row.type === "ROSTER_CHARACTER_SAVED" && row.runId === created.id,
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.signupId).toBe(savedOffer.id);
    expect(reminders[0]!.title).toBe("Reminder: you are saved");
    expect(reminders[0]!.message).toContain(`Rsnsaved-Antonidas is saved on ${first!.name}, ${second!.name}`);
    // Only the player — the Raid Lead saw it in the Start Run checklist.
    expect(
      (await userNotificationRepository.listForUser(ids.lead)).some(
        (row) => row.type === "ROSTER_CHARACTER_SAVED" && row.runId === created.id,
      ),
    ).toBe(false);

    // The DM goes out while the Run is running.
    const work = await discordSyncService.listSyncWork();
    const dm = work.notificationDms.find((item) => item.runId === created.id && item.type === "ROSTER_CHARACTER_SAVED");
    expect(dm?.characterSaved).toMatchObject({ audience: "start", characterLabel: "Rsnsaved-Antonidas", bossNames: [first!.name, second!.name] });
  });
});
