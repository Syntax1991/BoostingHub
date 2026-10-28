import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { runRepository } from "@/repositories/run.repository";
import { userNotificationRepository } from "@/repositories/user-notification.repository";
import { boostingRoleService } from "@/services/boosting-role.service";
import { newlyKilledBossIds } from "@/services/character-blizzard-sync.service";
import { characterService } from "@/services/character.service";
import { lockoutService } from "@/services/lockout.service";
import {
  buildRosterCharacterSavedDmMessage,
  buildRosterSelectedSavedSummaryDmMessage,
  rosterCharacterSavedWebNotification,
  rosterSelectedSavedSummaryWebNotification,
} from "@/services/notification-content";
import { discordSyncService, parseSavedSummaryEntries } from "@/services/discord-sync.service";
import { runDetailPath } from "@/lib/run-routes";
import { rosterService } from "@/services/roster.service";
import {
  parseRosterCharacterSavedSourceKey,
  planSavedNotices,
  plannedBosses,
  rosterCharacterSavedSummarySourceKey,
  savedPlannedBosses,
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

describe("planned bosses — N/M = the first N bosses in authoritative order", () => {
  const content = (plannedBossCount: number) => ({ raidId: "venom", plannedBossCount, bosses: [...BOSSES].reverse() });
  const saved = (plannedBossCount: number, killed: number[]) =>
    savedPlannedBosses(
      { difficulty: "HEROIC", contents: [content(plannedBossCount)] },
      [{ raidId: "venom", difficulty: "HEROIC", killedBossIds: killed.map((n) => `boss-${n}`) }],
    ).map((boss) => boss.id);

  it("6/8 → bosses 1–6, 7/8 → bosses 1–7, 8/8 → all (by sortOrder, not input order)", () => {
    expect(plannedBosses(content(6)).map((boss) => boss.sortOrder)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(plannedBosses(content(7)).map((boss) => boss.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(plannedBosses(content(8)).map((boss) => boss.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("6/8: a kill on boss 7 alone does not count; boss 6 does", () => {
    expect(saved(6, [7])).toEqual([]);
    expect(saved(6, [6])).toEqual(["boss-6"]);
    expect(saved(6, [6, 7, 8])).toEqual(["boss-6"]);
    expect(saved(8, [7])).toEqual(["boss-7"]);
  });

  it("6/8 before the Run: a new kill on boss 7 alone never notifies", () => {
    const partial = commitment({ contents: [content(6)] });
    expect(planSavedNotices({ region: "EU", kills: kills(["boss-7"], ["boss-7"]), commitments: [partial] })).toEqual([]);
  });
});

describe("Start Run Raid Lead summary — copy, DM, idempotency key", () => {
  const entries = [
    { characterLabel: "Synmist-Antonidas", bossNames: ["Boss A"] },
    { characterLabel: "Synblast-Antonidas", bossNames: ["Boss B", "Boss C"] },
  ];

  it("one grouped web notification linking the Roster tab", () => {
    expect(rosterSelectedSavedSummaryWebNotification({ runId: "run-1", entries })).toEqual({
      title: "Selected Characters are saved",
      message: [
        "2 selected Characters are saved:",
        "Synmist-Antonidas — Boss A",
        "Synblast-Antonidas — Boss B, Boss C",
        "Check the roster.",
      ].join("\n"),
      href: runDetailPath("run-1", "roster"),
    });
    expect(rosterSelectedSavedSummaryWebNotification({ runId: "run-1", entries: entries.slice(0, 1) }).message).toMatch(
      /^1 selected Character is saved:\n/,
    );
  });

  it("the DM lists every affected pick; the stored message round-trips into DM entries", () => {
    const dm = buildRosterSelectedSavedSummaryDmMessage({
      productLabel: "The Venomous Abyss",
      scheduledStartAt: START,
      difficulty: "HEROIC",
      lootType: "VIP",
      entries,
      rosterUrl: "https://example.test/runs/run-1",
    });
    expect(dm).toContain("Selected Characters are saved");
    expect(dm).toContain("2 selected Characters are saved:");
    expect(dm).toContain("• **Synmist-Antonidas** — Boss A");
    expect(dm).toContain("• **Synblast-Antonidas** — Boss B, Boss C");
    expect(dm).toContain("Check the roster: https://example.test/runs/run-1");

    const stored = rosterSelectedSavedSummaryWebNotification({ runId: "run-1", entries }).message;
    expect(parseSavedSummaryEntries(stored)).toEqual(entries);
  });

  it("deterministic key: same affected set in any order → same key; another pick or boss → new key", () => {
    const a = { signupId: "s-1", bossIds: ["b-2", "b-1"] };
    const b = { signupId: "s-2", bossIds: ["b-3"] };
    const key = rosterCharacterSavedSummarySourceKey("run-1", [a, b]);
    expect(rosterCharacterSavedSummarySourceKey("run-1", [b, { signupId: "s-1", bossIds: ["b-1", "b-2"] }])).toBe(key);
    expect(rosterCharacterSavedSummarySourceKey("run-1", [a])).not.toBe(key);
    expect(rosterCharacterSavedSummarySourceKey("run-1", [a, { signupId: "s-2", bossIds: ["b-3", "b-4"] }])).not.toBe(key);
    expect(rosterCharacterSavedSummarySourceKey("run-2", [a, b])).not.toBe(key);
    expect(parseRosterCharacterSavedSourceKey(key)).toBeNull(); // never mistaken for a per-pick notice
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
  let slot = 0;

  /**
   * A Run with one SELECTED Booster pick per entry (state set directly — the
   * roster/start flow is covered elsewhere). `kills` are 1-based boss
   * positions in authoritative order, stored as this raid ID's lockout.
   */
  async function startedRun(entries: Array<{ name: string; kills: number[] }>, plannedBossCount = 8) {
    slot += 1;
    const start = new Date(Date.parse("2026-12-26T20:30:00.000Z") + slot * 7 * 24 * 3_600_000).toISOString();
    const created = await runService.createRun(
      lead,
      venomousCreateInput({
        scheduledStartAt: start,
        plannedBossCount,
        desiredTankCount: 0,
        desiredHealerCount: entries.length,
        desiredDpsCount: 0,
      }),
    );
    createdRunIds.push(created.id);
    await runService.openRun(lead, created.id);
    const run = (await runRepository.findById(created.id))!;
    const content = run.contents[0]!;
    const bosses = [...content.bosses].sort((a, b) => a.sortOrder - b.sortOrder);
    const resetIdentifier = lockoutService.getResetIdentifierForRun("EU", start);
    const picks: Array<{ signupId: string; label: string }> = [];
    for (const entry of entries) {
      const character = await characterService.createCharacter(owner, {
        name: entry.name,
        realm: "Antonidas",
        region: "EU",
        wowClass: "PRIEST",
        specialization: "Holy",
        itemLevel: 640,
      });
      createdCharacterIds.push(character.id);
      const offer = await signupService.createBoosterSignup(owner, {
        runId: created.id,
        characterId: character.id,
        role: "HEALER",
        isBackup: false,
      });
      await orm.RunSignup.where({ id: offer.id }).update({ status: "SELECTED", publishedRole: "HEALER" });
      if (entry.kills.length > 0) {
        const now = new Date().toISOString();
        await orm.CharacterRaidLockout.create({
          id: crypto.randomUUID(),
          characterId: character.id,
          raidId: content.raidId,
          difficulty: run.difficulty,
          resetIdentifier,
          bossesDefeated: entry.kills.length,
          isComplete: false,
          killedBossIds: JSON.stringify(entry.kills.map((n) => bosses[n - 1]!.id)),
          createdAt: now,
          updatedAt: now,
        });
      }
      picks.push({ signupId: offer.id, label: `${entry.name}-Antonidas` });
    }
    return { runId: created.id, run, bosses, picks };
  }

  async function notesFor(userId: string, runId: string) {
    return (await userNotificationRepository.listForUser(userId)).filter(
      (row) => row.type === "ROSTER_CHARACTER_SAVED" && row.runId === runId,
    );
  }

  it("one saved SELECTED Character → its player reminder + ONE Raid Lead summary; clean picks get nothing", async () => {
    const { runId, bosses, picks } = await startedRun([
      { name: "Rsnsaved", kills: [1, 2] },
      { name: "Rsnclean", kills: [] },
    ]);
    // Not started yet → nothing (the check only runs for a started Run).
    expect(await runStartSavedCheckService.run(runId)).toBe(0);
    await orm.Run.where({ id: runId }).update({ status: "IN_PROGRESS" });

    expect(await runStartSavedCheckService.run(runId)).toBe(2); // player reminder + RL summary

    const reminders = await notesFor(ids.owner, runId);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.signupId).toBe(picks[0]!.signupId);
    expect(reminders[0]!.title).toBe("Reminder: you are saved");
    expect(reminders[0]!.message).toContain(`Rsnsaved-Antonidas is saved on ${bosses[0]!.name}, ${bosses[1]!.name}`);

    const summaries = await notesFor(ids.lead, runId);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.title).toBe("Selected Characters are saved");
    expect(summaries[0]!.message).toBe(
      ["1 selected Character is saved:", `Rsnsaved-Antonidas — ${bosses[0]!.name}, ${bosses[1]!.name}`, "Check the roster."].join(
        "\n",
      ),
    );
    expect(summaries[0]!.href).toBe(runDetailPath(runId, "roster"));
    expect(summaries[0]!.signupId).toBeNull();

    // Both DMs go out while the Run is running.
    const work = await discordSyncService.listSyncWork();
    const dms = work.notificationDms.filter((item) => item.runId === runId && item.type === "ROSTER_CHARACTER_SAVED");
    expect(dms.find((item) => item.characterSaved)?.characterSaved).toMatchObject({
      audience: "start",
      characterLabel: "Rsnsaved-Antonidas",
    });
    expect(dms.find((item) => item.savedSummary)?.savedSummary).toMatchObject({
      entries: [{ characterLabel: "Rsnsaved-Antonidas", bossNames: [bosses[0]!.name, bosses[1]!.name] }],
    });
  });

  it("several saved SELECTED Characters → one reminder each + exactly ONE grouped summary; a repeated check adds nothing", async () => {
    const { runId, run, bosses } = await startedRun([
      { name: "Rsnmist", kills: [1] },
      { name: "Rsnblast", kills: [2, 3] },
      { name: "Rsnquiet", kills: [] },
    ]);
    await orm.Run.where({ id: runId }).update({ status: "IN_PROGRESS" });

    expect(await runStartSavedCheckService.run(runId)).toBe(3); // 2 reminders + 1 summary
    expect(await runStartSavedCheckService.run(runId)).toBe(0); // same affected set → no duplicate

    expect((await notesFor(ids.owner, runId)).map((row) => row.message).sort()).toEqual([
      `Rsnblast-Antonidas is saved on ${bosses[1]!.name}, ${bosses[2]!.name} for ${run.title} — no loot from those bosses for you.`,
      `Rsnmist-Antonidas is saved on ${bosses[0]!.name} for ${run.title} — no loot from those bosses for you.`,
    ]);
    const summaries = await notesFor(ids.lead, runId);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.message).toBe(
      [
        "2 selected Characters are saved:",
        `Rsnblast-Antonidas — ${bosses[1]!.name}, ${bosses[2]!.name}`,
        `Rsnmist-Antonidas — ${bosses[0]!.name}`,
        "Check the roster.",
      ].join("\n"),
    );
  });

  it("no affected SELECTED Character → no reminder and no Raid Lead summary", async () => {
    const { runId } = await startedRun([
      { name: "Rsnnone", kills: [] },
      { name: "Rsnzero", kills: [] },
    ]);
    await orm.Run.where({ id: runId }).update({ status: "IN_PROGRESS" });
    expect(await runStartSavedCheckService.run(runId)).toBe(0);
    expect(await notesFor(ids.owner, runId)).toEqual([]);
    expect(await notesFor(ids.lead, runId)).toEqual([]);
  });

  it("6/8 Run: a kill on boss 7 alone never triggers; a kill on boss 6 does", async () => {
    const { runId, bosses } = await startedRun(
      [
        { name: "Rsnseven", kills: [7] },
        { name: "Rsnsix", kills: [6, 7] },
      ],
      6,
    );
    await orm.Run.where({ id: runId }).update({ status: "IN_PROGRESS" });
    expect(await runStartSavedCheckService.run(runId)).toBe(2); // Rsnsix reminder + summary

    const reminders = await notesFor(ids.owner, runId);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.message).toContain(`Rsnsix-Antonidas is saved on ${bosses[5]!.name} for`);
    expect(reminders[0]!.message).not.toContain(bosses[6]!.name);
    const [summary] = await notesFor(ids.lead, runId);
    expect(summary!.message).toBe(
      ["1 selected Character is saved:", `Rsnsix-Antonidas — ${bosses[5]!.name}`, "Check the roster."].join("\n"),
    );
  });
});
