import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import {
  buildCustomPingMessage,
  buildLateFillHelpMessage,
  helpMessageNonce,
  resolveClassRoleIds,
} from "@/discord-bot/messages/late-fill-help-message";
import { isDomainError } from "@/lib/errors";
import {
  LATE_FILL_HELP_COOLDOWN_MS,
  parseLateFillHelpClasses,
  parseLateFillHelpCustom,
  parseLateFillHelpRoles,
  resolvePingRoleIds,
  serializeCustomPing,
  serializeLateFillHelp,
  storedPingKeys,
} from "@/lib/late-fill-help";
import { customPingSchema } from "@/validators/roster";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import { discordSyncService } from "@/services/discord-sync.service";
import { lateFillHelpFeedback, lateFillHelpService } from "@/services/late-fill-help.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";

/**
 * Late Fill help: an explicit Raid Lead request pings the Guild roles of the
 * saved roster's missing roles in the Run channel — once per role per
 * cooldown, never for a Run that cannot take players any more.
 */

const ids = {
  lead: "dddddddd-dddd-4ddd-8ddd-lf0000000001",
  otherLead: "dddddddd-dddd-4ddd-8ddd-lf0000000002",
  admin: "dddddddd-dddd-4ddd-8ddd-lf0000000003",
};
const createdRunIds: string[] = [];

function asUser(id: string, accountRole: AuthenticatedUser["accountRole"]): AuthenticatedUser {
  return {
    id,
    name: id.slice(-4),
    email: `${id}@latefill.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

const lead = asUser(ids.lead, "RAID_LEAD");
const otherLead = asUser(ids.otherLead, "RAID_LEAD");
const admin = asUser(ids.admin, "ADMIN");

async function cleanupRun(runId: string) {
  await orm.RunDiscordAnnouncement.where({ runId }).delete().catch(() => {});
  await orm.RunDiscordPost.where({ runId }).delete().catch(() => {});
  const roster = (await orm.RunRoster.where({ runId }).first()) as { id: string } | null;
  if (roster) {
    await orm.RunRosterEntry.where({ rosterId: roster.id }).delete().catch(() => {});
    await orm.RunRoster.where({ id: roster.id }).delete().catch(() => {});
  }
  const signups = (await orm.RunSignup.where({ runId }).select("id").all()) as Array<{ id: string }>;
  for (const signup of signups) {
    await orm.RunSignupRole.where({ signupId: signup.id }).delete().catch(() => {});
    await orm.RunSignup.where({ id: signup.id }).delete().catch(() => {});
  }
  await orm.RunDomainEvent?.where({ runId }).delete().catch(() => {});
  await orm.Run.where({ id: runId }).delete().catch(() => {});
}

async function cleanupUsers() {
  for (const userId of Object.values(ids)) {
    const runs = (await orm.Run.where({ raidLeadId: userId }).select("id").all()) as Array<{ id: string }>;
    for (const run of runs) await cleanupRun(run.id);
    await orm.Character.where({ userId }).delete().catch(() => {});
    await orm.User.where({ id: userId }).delete().catch(() => {});
  }
}

/** A saved draft pick: the admin's Character of `wowClass` on the Run's roster. */
async function pickCharacter(runId: string, wowClass: "MAGE" | "WARLOCK", name: string) {
  const now = new Date().toISOString();
  const characterId = crypto.randomUUID();
  await orm.User.where({ id: ids.admin }).update({ isBooster: true });
  await orm.Character.create({
    id: characterId,
    userId: ids.admin,
    name,
    realm: "Late Fill Lab",
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity("Late Fill Lab"),
    region: "EU",
    wowClass,
    specialization: wowClass === "MAGE" ? "Fire" : "Affliction",
    primaryRole: "RANGED_DPS",
    itemLevel: 700,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const signupId = crypto.randomUUID();
  await orm.RunSignup.create({
    id: signupId,
    runId,
    userId: ids.admin,
    characterId,
    participationType: "BOOSTER",
    isBackup: false,
    status: "PENDING",
    publishedRole: null,
    lootbuddyMode: null,
    lootbuddyVerification: null,
    createdAt: now,
    updatedAt: now,
  });
  await orm.RunSignupRole.create({ id: crypto.randomUUID(), signupId, role: "RANGED_DPS", createdAt: now });
  const view = await rosterService.getRosterManagementView(lead, runId);
  await rosterService.saveDraftSelection(lead, {
    runId,
    version: view.roster.version,
    selections: [{ signupId, selectedRole: "RANGED_DPS" }],
  });
}

/** An OPEN Run of `lead` starting in `hoursAhead` (default 3 h: inside Late Fill), with a Run channel. */
async function lateFillRun(options: { hoursAhead?: number; channel?: boolean } = {}) {
  const scheduledStartAt = new Date(Date.now() + (options.hoursAhead ?? 3) * 60 * 60_000).toISOString();
  const runId = await runService.createRun(lead, venomousCreateInput({ scheduledStartAt })).then((run) => run.id);
  createdRunIds.push(runId);
  await runService.openRun(lead, runId);
  if (options.channel !== false) {
    const now = new Date().toISOString();
    await orm.RunDiscordPost.create({ id: crypto.randomUUID(), runId, runChannelId: `chan-${runId.slice(0, 8)}`, createdAt: now, updatedAt: now });
  }
  return runId;
}

async function helpRows(runId: string) {
  return (await orm.RunDiscordAnnouncement.where({ runId, type: "LATE_FILL_HELP" }).all()) as Array<{
    id: string;
    status: string;
    helpRoles: string | null;
  }>;
}

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
  } catch (error) {
    return isDomainError(error) ? error.code : "NOT_A_DOMAIN_ERROR";
  }
  return null;
}

function configurePingRoles(roles: { tank?: string; healer?: string; dps?: string }) {
  vi.stubEnv("DISCORD_PING_ROLE_TANK_ID", roles.tank ?? "");
  vi.stubEnv("DISCORD_PING_ROLE_HEALER_ID", roles.healer ?? "");
  vi.stubEnv("DISCORD_PING_ROLE_DPS_ID", roles.dps ?? "");
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await cleanupUsers();
  const now = new Date().toISOString();
  for (const [id, role] of [
    [ids.lead, "RAID_LEAD"],
    [ids.otherLead, "RAID_LEAD"],
    [ids.admin, "ADMIN"],
  ] as const) {
    await orm.User.create({
      id,
      name: id.slice(-4),
      email: `${id}@latefill.boostting.local`,
      emailVerified: true,
      accountRole: role,
      accountStatus: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    });
  }
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  for (const runId of createdRunIds) await cleanupRun(runId);
  await cleanupUsers();
}, 60_000);

describe("Late Fill help request", () => {
  it("the Raid Lead asks once: one PENDING message for the missing configured roles; unconfigured roles are reported", async () => {
    configurePingRoles({ healer: "111", dps: "222" });
    const runId = await lateFillRun();

    const result = await lateFillHelpService.request(lead, runId);
    // Empty roster of a 2T / 4H / 14D Run: Tank is missing too, but has no ping role.
    expect(result.pinged).toEqual([
      { role: "HEALER", missing: 4 },
      { role: "DPS", missing: 14 },
    ]);
    expect(result.notConfigured).toEqual(["TANK"]);
    const rows = await helpRows(runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("PENDING");
    expect(parseLateFillHelpRoles(rows[0]!.helpRoles)).toEqual(result.pinged);
    // Requesting help never touches the roster.
    expect(await orm.RunRosterEntry.where({ rosterId: ((await orm.RunRoster.where({ runId }).first()) as { id: string }).id }).all()).toEqual([]);
  });

  it("only who may manage the Run can ask: another Raid Lead is refused, an Admin may", async () => {
    configurePingRoles({ tank: "1", healer: "2", dps: "3" });
    const runId = await lateFillRun();
    expect(await codeOf(lateFillHelpService.request(otherLead, runId))).toBe("RUN_NOT_MANAGEABLE");
    expect(await helpRows(runId)).toHaveLength(0);
    await lateFillHelpService.request(admin, runId);
    expect(await helpRows(runId)).toHaveLength(1);
  });

  it("cooldown per role: a second request is refused until the cooldown has passed", async () => {
    configurePingRoles({ tank: "1", healer: "2", dps: "3" });
    const runId = await lateFillRun();
    const first = new Date();
    await lateFillHelpService.request(lead, runId, first);
    expect(await codeOf(lateFillHelpService.request(lead, runId, new Date(first.getTime() + 60_000)))).toBe(
      "LATE_FILL_HELP_COOLDOWN",
    );
    expect(await helpRows(runId)).toHaveLength(1);
    const later = await lateFillHelpService.request(lead, runId, new Date(first.getTime() + LATE_FILL_HELP_COOLDOWN_MS + 1_000));
    expect(later.pinged.map((row) => row.role)).toEqual(["TANK", "HEALER", "DPS"]);
    expect(await helpRows(runId)).toHaveLength(2);
  });

  it("the cooldown is per role: a role newly configured is pinged, the roles asked for recently are not", async () => {
    configurePingRoles({ healer: "2" });
    const runId = await lateFillRun();
    const first = new Date();
    await lateFillHelpService.request(lead, runId, first);
    configurePingRoles({ healer: "2", dps: "3" });
    const second = await lateFillHelpService.request(lead, runId, new Date(first.getTime() + 60_000));
    expect(second.pinged.map((row) => row.role)).toEqual(["DPS"]);
    expect(second.cooling.map((row) => row.role)).toEqual(["HEALER"]);
  });

  it("concurrent clicks send one message, never two pings of the same role", async () => {
    configurePingRoles({ tank: "1", healer: "2", dps: "3" });
    const runId = await lateFillRun();
    const now = new Date();
    const results = await Promise.allSettled([1, 2, 3].map(() => lateFillHelpService.request(lead, runId, now)));
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(await helpRows(runId)).toHaveLength(1);
  });

  it("no ping role configured for any missing role: refused with a clear code, nothing written", async () => {
    configurePingRoles({});
    const runId = await lateFillRun();
    expect(await codeOf(lateFillHelpService.request(lead, runId))).toBe("LATE_FILL_HELP_NOT_CONFIGURED");
    expect(await helpRows(runId)).toHaveLength(0);
  });

  it("any time before Start: a Run days ahead can ask too (no 24 h window)", async () => {
    configurePingRoles({ tank: "1", healer: "2", dps: "3" });
    const early = await lateFillRun({ hoursAhead: 72 });
    const result = await lateFillHelpService.request(lead, early);
    expect(result.pinged.map((row) => row.role)).toEqual(["TANK", "HEALER", "DPS"]);
    expect(await helpRows(early)).toHaveLength(1);
  });

  it("invalid Run states: no Run channel, cancelled, started — refused, nothing written", async () => {
    configurePingRoles({ tank: "1", healer: "2", dps: "3" });
    const noChannel = await lateFillRun({ channel: false });
    expect(await codeOf(lateFillHelpService.request(lead, noChannel))).toBe("LATE_FILL_HELP_NO_CHANNEL");
    const cancelled = await lateFillRun();
    await runService.cancelRun(lead, cancelled);
    expect(await codeOf(lateFillHelpService.request(lead, cancelled))).toBe("LATE_FILL_HELP_UNAVAILABLE");
    const started = await lateFillRun();
    await orm.Run.where({ id: started }).update({ status: "IN_PROGRESS" });
    expect(await codeOf(lateFillHelpService.request(lead, started))).toBe("LATE_FILL_HELP_UNAVAILABLE");
    for (const runId of [noChannel, cancelled, started]) expect(await helpRows(runId)).toHaveLength(0);
  });

  it("nothing missing: refused (a full saved roster needs no help)", async () => {
    configurePingRoles({ tank: "1", healer: "2", dps: "3" });
    const runId = await lateFillRun();
    await orm.Run.where({ id: runId }).update({ desiredTankCount: 0, desiredHealerCount: 0, desiredDpsCount: 0 });
    expect(await codeOf(lateFillHelpService.request(lead, runId))).toBe("LATE_FILL_HELP_NOTHING_MISSING");
  });

  it("the bot posts only while the Run can still take players: cancelled after the request → no delivery", async () => {
    configurePingRoles({ tank: "1", healer: "2", dps: "3" });
    const runId = await lateFillRun();
    await lateFillHelpService.request(lead, runId);
    const [row] = await helpRows(runId);
    expect(await discordSyncService.getRunAnnouncementDeliveryAuthority(row!.id)).toEqual({ deliver: true });
    await runService.cancelRun(lead, runId);
    expect(await discordSyncService.getRunAnnouncementDeliveryAuthority(row!.id)).toEqual({ deliver: false });
  });
});

describe("Late Fill help — missing class buffs", () => {
  it("names the classes the saved roster misses; a class already on the roster is not listed", async () => {
    configurePingRoles({ tank: "1", healer: "2", dps: "3" });
    const runId = await lateFillRun();
    await pickCharacter(runId, "MAGE", "Lfmage");

    const result = await lateFillHelpService.request(lead, runId);
    expect(result.missingClassBuffs).toContain("WARLOCK");
    expect(result.missingClassBuffs).not.toContain("MAGE");
    // Rogue provides no tracked buff, so it is never asked for.
    expect(result.missingClassBuffs).not.toContain("ROGUE");
    expect(new Set(result.missingClassBuffs).size).toBe(result.missingClassBuffs.length);
    const [row] = await helpRows(runId);
    expect(parseLateFillHelpClasses(row!.helpRoles)).toEqual(result.missingClassBuffs);
    expect(lateFillHelpFeedback(result)).toContain("Warlock");
  });

  it("a Warlock on the roster covers its three tracked utilities at once", async () => {
    configurePingRoles({ tank: "1", healer: "2", dps: "3" });
    const runId = await lateFillRun();
    await pickCharacter(runId, "WARLOCK", "Lflock");
    expect((await lateFillHelpService.request(lead, runId)).missingClassBuffs).not.toContain("WARLOCK");
  });

  it("the cooldown covers classes too: a later message for a new role does not ping them again", async () => {
    configurePingRoles({ healer: "2" });
    const runId = await lateFillRun();
    const first = new Date();
    const firstResult = await lateFillHelpService.request(lead, runId, first);
    expect(firstResult.missingClassBuffs.length).toBeGreaterThan(0);

    configurePingRoles({ healer: "2", dps: "3" });
    const second = await lateFillHelpService.request(lead, runId, new Date(first.getTime() + 60_000));
    expect(second.pinged.map((row) => row.role)).toEqual(["DPS"]);
    expect(second.missingClassBuffs).toEqual([]);

    const third = await lateFillHelpService.request(lead, runId, new Date(first.getTime() + LATE_FILL_HELP_COOLDOWN_MS + 1_000));
    expect(third.missingClassBuffs).toEqual(firstResult.missingClassBuffs);
  });

  it("every role cooling down: nothing goes out, classes alone never trigger a message", async () => {
    configurePingRoles({ tank: "1", healer: "2", dps: "3" });
    const runId = await lateFillRun();
    const first = new Date();
    await lateFillHelpService.request(lead, runId, first);
    expect(await codeOf(lateFillHelpService.request(lead, runId, new Date(first.getTime() + 60_000)))).toBe(
      "LATE_FILL_HELP_COOLDOWN",
    );
    expect(await helpRows(runId)).toHaveLength(1);
  });
});

describe("Ping roles — custom request", () => {
  const guildRoles = [
    { id: "900", name: "Tank", managed: false },
    { id: "901", name: "Healer", managed: false },
    { id: "902", name: "DPS", managed: false },
    { id: "950", name: "Warlock", managed: false },
    { id: "951", name: "Mage", managed: false },
    { id: "952", name: "Mage", managed: false },
    { id: "960", name: "Lootbuddy", managed: false },
    { id: "970", name: "Booster", managed: false },
  ];

  function stubDiscordRoles(roles: unknown = guildRoles, status = 200) {
    vi.stubEnv("DISCORD_BOT_TOKEN", "token");
    vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(roles), { status }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a Lootbuddy request on a fully staffed roster: one PENDING row with exactly the chosen role, no Booster role implied", async () => {
    configurePingRoles({});
    stubDiscordRoles();
    const runId = await lateFillRun();
    await orm.Run.where({ id: runId }).update({ desiredTankCount: 0, desiredHealerCount: 0, desiredDpsCount: 0 });

    const result = await lateFillHelpService.requestCustom(lead, { runId, text: "  Need 1 LB  for Coiled Altar ", roles: ["LOOTBUDDY"] });
    expect(result).toEqual({ text: "Need 1 LB for Coiled Altar", roles: ["LOOTBUDDY"] });
    const rows = await helpRows(runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("PENDING");
    expect(parseLateFillHelpCustom(rows[0]!.helpRoles)).toEqual(result);
    // Automatic readers see nothing to ping from a custom row.
    expect(parseLateFillHelpRoles(rows[0]!.helpRoles)).toEqual([]);
    expect(parseLateFillHelpClasses(rows[0]!.helpRoles)).toEqual([]);
  });

  it("several chosen roles are deduped into one message; text and roles stay independent", async () => {
    configurePingRoles({});
    stubDiscordRoles();
    const runId = await lateFillRun();
    const result = await lateFillHelpService.requestCustom(lead, {
      runId,
      text: "Looking for a Warlock for Coiled Altar",
      roles: ["WARLOCK", "DPS", "WARLOCK"],
    });
    expect(result.roles).toEqual(["WARLOCK", "DPS"]);
    expect(await helpRows(runId)).toHaveLength(1);
  });

  it.each([
    ["empty", "   "],
    ["too long", "x".repeat(201)],
    ["@everyone", "Need help @everyone"],
    ["@here in capitals", "Need help @HERE"],
    ["a role mention", "Need help <@&970>"],
    ["a user mention", "Need <@123>"],
    ["a line break", "Need\nhelp"],
    ["a hidden character", `Need @${String.fromCodePoint(0x200b)}everyone`],
  ])("refuses a text with %s: nothing is written", async (_label, text) => {
    configurePingRoles({});
    const fetchMock = stubDiscordRoles();
    const runId = await lateFillRun();
    expect(await codeOf(lateFillHelpService.requestCustom(lead, { runId, text, roles: ["DPS"] }))).toBe("CUSTOM_PING_INVALID");
    expect(await helpRows(runId)).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses no role, and a role that is missing, ambiguous or unknown on Discord", async () => {
    configurePingRoles({});
    stubDiscordRoles();
    const runId = await lateFillRun();
    expect(await codeOf(lateFillHelpService.requestCustom(lead, { runId, text: "Need help", roles: [] }))).toBe("CUSTOM_PING_INVALID");
    // Ambiguous: two "Mage" roles.
    expect(await codeOf(lateFillHelpService.requestCustom(lead, { runId, text: "Need help", roles: ["MAGE"] }))).toBe(
      "CUSTOM_PING_ROLE_NOT_AVAILABLE",
    );
    // Missing: no "Druid" role. The whole request fails, nothing partial goes out.
    expect(await codeOf(lateFillHelpService.requestCustom(lead, { runId, text: "Need help", roles: ["DPS", "DRUID"] }))).toBe(
      "CUSTOM_PING_ROLE_NOT_AVAILABLE",
    );
    expect(await helpRows(runId)).toHaveLength(0);
    // Anything outside the allowlist fails the action's schema.
    expect(customPingSchema.safeParse({ runId, text: "Need help", roles: ["BOOSTER"] }).success).toBe(false);
    expect(customPingSchema.safeParse({ runId, text: "Need help", roles: ["970"] }).success).toBe(false);
  });

  it("Discord cannot be read: refused, nothing written", async () => {
    configurePingRoles({});
    stubDiscordRoles({ message: "nope" }, 500);
    const runId = await lateFillRun();
    expect(await codeOf(lateFillHelpService.requestCustom(lead, { runId, text: "Need help", roles: ["DPS"] }))).toBe(
      "CUSTOM_PING_ROLES_UNAVAILABLE",
    );
    expect(await helpRows(runId)).toHaveLength(0);
  });

  it("same gate as Automatic: another Raid Lead, no channel and a started Run are refused", async () => {
    configurePingRoles({});
    stubDiscordRoles();
    const input = { text: "Need help", roles: ["DPS"] as const };
    const runId = await lateFillRun();
    expect(await codeOf(lateFillHelpService.requestCustom(otherLead, { runId, ...input }))).toBe("RUN_NOT_MANAGEABLE");
    const noChannel = await lateFillRun({ channel: false });
    expect(await codeOf(lateFillHelpService.requestCustom(lead, { runId: noChannel, ...input }))).toBe("LATE_FILL_HELP_NO_CHANNEL");
    const started = await lateFillRun();
    await orm.Run.where({ id: started }).update({ status: "IN_PROGRESS" });
    expect(await codeOf(lateFillHelpService.requestCustom(lead, { runId: started, ...input }))).toBe("LATE_FILL_HELP_UNAVAILABLE");
    for (const id of [runId, noChannel, started]) expect(await helpRows(id)).toHaveLength(0);
  });

  it("the cooldown is shared: custom holds back Automatic for that role, and Automatic holds back custom", async () => {
    configurePingRoles({ tank: "900", healer: "901", dps: "902" });
    stubDiscordRoles();
    const runId = await lateFillRun();
    const first = new Date();
    await lateFillHelpService.requestCustom(lead, { runId, text: "Need a DPS", roles: ["DPS", "WARLOCK"] }, first);

    const automatic = await lateFillHelpService.request(lead, runId, new Date(first.getTime() + 60_000));
    expect(automatic.pinged.map((row) => row.role)).toEqual(["TANK", "HEALER"]);
    expect(automatic.cooling.map((row) => row.role)).toEqual(["DPS"]);
    expect(automatic.missingClassBuffs).not.toContain("WARLOCK");

    const soon = new Date(first.getTime() + 120_000);
    expect(await codeOf(lateFillHelpService.requestCustom(lead, { runId, text: "Tank?", roles: ["TANK"] }, soon))).toBe("LATE_FILL_HELP_COOLDOWN");
    // Any chosen role cooling: the whole request waits, it is not silently trimmed.
    expect(await codeOf(lateFillHelpService.requestCustom(lead, { runId, text: "LB?", roles: ["LOOTBUDDY", "TANK"] }, soon))).toBe("LATE_FILL_HELP_COOLDOWN");
    expect(await helpRows(runId)).toHaveLength(2);
    // A role nobody pinged yet is free, and the cooldown ends.
    await lateFillHelpService.requestCustom(lead, { runId, text: "LB?", roles: ["LOOTBUDDY"] }, soon);
    await lateFillHelpService.requestCustom(lead, { runId, text: "Tank?", roles: ["TANK"] }, new Date(first.getTime() + LATE_FILL_HELP_COOLDOWN_MS + 61_000));
    expect(await helpRows(runId)).toHaveLength(4);
  });

  it("concurrent custom clicks send one message", async () => {
    configurePingRoles({});
    stubDiscordRoles();
    const runId = await lateFillRun();
    const now = new Date();
    const results = await Promise.allSettled(
      [1, 2, 3].map(() => lateFillHelpService.requestCustom(lead, { runId, text: "Need a DPS", roles: ["DPS"] }, now)),
    );
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(await helpRows(runId)).toHaveLength(1);
  });

  it("the dialog's preview writes nothing and starts no cooldown; it shows what Automatic would send", async () => {
    configurePingRoles({ tank: "900", healer: "901", dps: "902" });
    stubDiscordRoles();
    const runId = await lateFillRun();
    await pickCharacter(runId, "MAGE", "Lfprevmage");

    const data = await lateFillHelpService.dialogData(lead, runId);
    expect(await helpRows(runId)).toHaveLength(0);
    expect(data.automatic.lines[0]).toEqual({
      text: "2 more Tanks, 4 more Healers and 13 more DPS needed here",
      mentions: ["Tank", "Healer", "DPS"],
    });
    expect(data.automatic.lines[1]!.text).toContain("Warlock");
    expect(data.automatic.lines[1]!.text).not.toContain("Mage");
    // Only allowlisted, uniquely resolved roles: no Booster, no ambiguous Mage, no absent Druid.
    expect(data.roles!.map((role) => role.key)).toEqual(["TANK", "HEALER", "DPS", "LOOTBUDDY", "WARLOCK"]);
    await lateFillHelpService.request(lead, runId);
    expect(await helpRows(runId)).toHaveLength(1);
    const cooled = await lateFillHelpService.dialogData(lead, runId);
    expect(cooled.automatic.lines).toEqual([]);
    expect(cooled.automatic.notes[0]).toContain("asked for recently");
  });

  it("the dialog needs the same manage rights; a roster without gaps offers Custom and says why Automatic is empty", async () => {
    configurePingRoles({ tank: "900", healer: "901", dps: "902" });
    stubDiscordRoles();
    const runId = await lateFillRun();
    expect(await codeOf(lateFillHelpService.dialogData(otherLead, runId))).toBe("RUN_NOT_MANAGEABLE");
    await orm.Run.where({ id: runId }).update({ desiredTankCount: 0, desiredHealerCount: 0, desiredDpsCount: 0 });
    const data = await lateFillHelpService.dialogData(lead, runId);
    expect(data.automatic.lines).toEqual([]);
    expect(data.automatic.emptyReason).toContain("no open");
    expect(data.roles).not.toBeNull();
  });

  it("the Discord role list failing leaves Automatic usable, and Custom knows it has no roles", async () => {
    configurePingRoles({ tank: "900", healer: "901", dps: "902" });
    stubDiscordRoles({}, 500);
    const runId = await lateFillRun();
    const data = await lateFillHelpService.dialogData(lead, runId);
    expect(data.roles).toBeNull();
    expect(data.automatic.lines.length).toBeGreaterThan(0);
  });

  it("the bot's work item carries the custom request; an automatic one carries none", async () => {
    configurePingRoles({ tank: "900", healer: "901", dps: "902" });
    stubDiscordRoles();
    const runId = await lateFillRun();
    await lateFillHelpService.requestCustom(lead, { runId, text: "Need 1 LB for Coiled Altar", roles: ["LOOTBUDDY"] });
    await lateFillHelpService.request(lead, runId);
    const work = await discordSyncService.listSyncWork(new Date(), {});
    const items = work.runAnnouncements.filter((row) => row.runId === runId && row.type === "LATE_FILL_HELP");
    expect(items.map((row) => row.helpCustom)).toEqual([
      { text: "Need 1 LB for Coiled Altar", roles: ["LOOTBUDDY"] },
      null,
    ]);
    expect(items[1]!.helpRoles.map((row) => row.role)).toEqual(["TANK", "HEALER", "DPS"]);
  });
});

describe("Ping role rules", () => {
  it("resolvePingRoleIds: exact unique names, configured ids win and never fall back; managed and everyone roles are out", () => {
    const roles = [
      { id: "1", name: "@everyone", managed: false },
      { id: "2", name: "tank", managed: false },
      { id: "3", name: "LB", managed: false },
      { id: "4", name: "DPS", managed: true },
      { id: "5", name: "Healer", managed: false },
    ];
    expect(resolvePingRoleIds(roles, ["TANK", "LOOTBUDDY", "DPS", "HEALER"])).toEqual({
      roleIds: { TANK: "2", LOOTBUDDY: "3", HEALER: "5" },
      unresolved: ["DPS"],
    });
    // A configured id that no longer exists does not fall back to the name.
    expect(resolvePingRoleIds(roles, ["TANK", "HEALER"], { TANK: "2", HEALER: "999" })).toEqual({
      roleIds: { TANK: "2" },
      unresolved: ["HEALER"],
    });
    // Two Lootbuddy-named roles are ambiguous.
    expect(
      resolvePingRoleIds([{ id: "6", name: "Lootbuddy", managed: false }, { id: "7", name: "LB", managed: false }], ["LOOTBUDDY"]),
    ).toEqual({ roleIds: {}, unresolved: ["LOOTBUDDY"] });
  });

  it("the custom message: bold text, mentions outside, allowedMentions exactly the chosen roles", () => {
    const message = buildCustomPingMessage({ text: "Need 1 LB for Coiled Altar", roles: ["LOOTBUDDY", "DPS"] }, { LOOTBUDDY: "960", DPS: "902" });
    expect(message).toEqual({
      content: "**Need 1 LB for Coiled Altar** <@&960> <@&902>",
      allowedMentions: { parse: [], roles: ["960", "902"], users: [], repliedUser: false },
    });
  });

  it("markdown cannot break out of the bold; an apostrophe stays as written", () => {
    expect(buildCustomPingMessage({ text: "Need ** for _Ula'tek_ `x` [a](b)", roles: ["DPS"] }, { DPS: "902" })!.content).toBe(
      "**Need \\*\\* for \\_Ula'tek\\_ \\`x\\` \\[a\\](b)** <@&902>",
    );
  });

  it("an unresolved role is left out; none resolved → null, never another role", () => {
    const ping = { text: "Need help", roles: ["DPS", "MAGE"] as const };
    expect(buildCustomPingMessage({ ...ping, roles: [...ping.roles] }, { DPS: "902" })!.allowedMentions.roles).toEqual(["902"]);
    expect(buildCustomPingMessage({ ...ping, roles: [...ping.roles] }, {})).toBeNull();
  });

  it("a stored custom row is re-validated: bad text or only unknown roles never go out", () => {
    const stored = (custom: unknown) => JSON.stringify({ roles: [], classes: [], custom });
    expect(parseLateFillHelpCustom(stored({ text: "ok", roles: ["DPS", "EVERYONE", "DPS"] }))).toEqual({ text: "ok", roles: ["DPS"] });
    expect(parseLateFillHelpCustom(stored({ text: "@everyone", roles: ["DPS"] }))).toBeNull();
    expect(parseLateFillHelpCustom(stored({ text: "ok", roles: ["EVERYONE"] }))).toBeNull();
    expect(parseLateFillHelpCustom(stored(null))).toBeNull();
    expect(parseLateFillHelpCustom(serializeLateFillHelp([{ role: "DPS", missing: 1 }], []))).toBeNull();
    expect(storedPingKeys(serializeCustomPing({ text: "ok", roles: ["LOOTBUDDY", "MAGE"] }))).toEqual(["LOOTBUDDY", "MAGE"]);
  });

  it("the delivery nonce is stable, unique per announcement and fits Discord's 25 characters", () => {
    const nonce = helpMessageNonce("0f3c2a10-7b1e-4c55-9a77-1234567890ab");
    expect(nonce).toBe("0f3c2a107b1e4c559a7712345");
    expect(nonce.length).toBeLessThanOrEqual(25);
  });
});

describe("Late Fill help Discord message", () => {
  const pingRoleIds = { TANK: "900", HEALER: "901", DPS: "902" };

  it("a missing Warlock buff: its own bold line with the @Warlock role at the end; allowedMentions exact", () => {
    const message = buildLateFillHelpMessage({
      roles: [{ role: "DPS", missing: 3 }],
      pingRoleIds,
      classes: ["WARLOCK"],
      classRoleIds: { WARLOCK: "950" },
    });
    expect(message!.content).toBe("**3 more DPS needed here** <@&902>\n**Missing class buffs: Warlock** <@&950>");
    expect(message!.allowedMentions).toEqual({ parse: [], roles: ["902", "950"], users: [], repliedUser: false });
  });

  it("several classes are one compact line; duplicates are named and pinged once", () => {
    const message = buildLateFillHelpMessage({
      roles: [{ role: "HEALER", missing: 1 }],
      pingRoleIds,
      classes: ["MAGE", "WARLOCK", "MAGE"],
      classRoleIds: { MAGE: "951", WARLOCK: "950" },
    });
    expect(message!.content).toBe(
      "**1 more Healer needed here** <@&901>\n**Missing class buffs: Mage, Warlock** <@&951> <@&950>",
    );
    expect(message!.allowedMentions.roles).toEqual(["901", "951", "950"]);
  });

  it("a class without a role id is still named, but pinged by nothing else", () => {
    const message = buildLateFillHelpMessage({
      roles: [{ role: "DPS", missing: 1 }],
      pingRoleIds,
      classes: ["MAGE", "WARLOCK"],
      classRoleIds: { WARLOCK: "950" },
    });
    expect(message!.content).toBe("**1 more DPS needed here** <@&902>\n**Missing class buffs: Mage, Warlock** <@&950>");
    expect(message!.allowedMentions.roles).toEqual(["902", "950"]);
    // No class role at all: the bold line without a trailing space or mention.
    expect(
      buildLateFillHelpMessage({ roles: [{ role: "DPS", missing: 1 }], pingRoleIds, classes: ["MAGE"], classRoleIds: {} })!.content,
    ).toBe("**1 more DPS needed here** <@&902>\n**Missing class buffs: Mage**");
  });

  it("no missing class: only the role line, exactly as before", () => {
    expect(buildLateFillHelpMessage({ roles: [{ role: "DPS", missing: 3 }], pingRoleIds, classes: [] })!.content).toBe(
      "**3 more DPS needed here** <@&902>",
    );
  });

  it("class roles resolve by their exact unique name; missing, ambiguous or bot-managed roles never fall back to another role", () => {
    const guildRoles = [
      { id: "1", name: "Warlock", managed: false },
      { id: "2", name: "death knight", managed: false },
      { id: "3", name: "Mage", managed: false },
      { id: "4", name: "Mage", managed: false },
      { id: "5", name: "Monk", managed: true },
      { id: "6", name: "Hunter Friends", managed: false },
    ];
    expect(resolveClassRoleIds(guildRoles, ["WARLOCK", "DEATH_KNIGHT", "MAGE", "MONK", "HUNTER", "DRUID"])).toEqual({
      roleIds: { WARLOCK: "1", DEATH_KNIGHT: "2" },
      unresolved: ["MAGE", "MONK", "HUNTER", "DRUID"],
    });
  });

  it("stored requests: both the new shape and older roles-only rows read; unknown classes are dropped", () => {
    const stored = serializeLateFillHelp([{ role: "DPS", missing: 2 }], ["WARLOCK"]);
    expect(parseLateFillHelpRoles(stored)).toEqual([{ role: "DPS", missing: 2 }]);
    expect(parseLateFillHelpClasses(stored)).toEqual(["WARLOCK"]);
    const older = '[{"role":"HEALER","missing":1}]';
    expect(parseLateFillHelpRoles(older)).toEqual([{ role: "HEALER", missing: 1 }]);
    expect(parseLateFillHelpClasses(older)).toEqual([]);
    expect(parseLateFillHelpClasses('{"roles":[],"classes":["EVERYONE","MAGE","MAGE"]}')).toEqual(["MAGE"]);
  });

  it("pings exactly the requested roles' ids; allowedMentions allows nothing else", () => {
    const message = buildLateFillHelpMessage({
      roles: [
        { role: "HEALER", missing: 1 },
        { role: "DPS", missing: 2 },
      ],
      pingRoleIds: { TANK: "900", HEALER: "901", DPS: "902" },
    });
    expect(message).not.toBeNull();
    expect(message!.content).toBe("**1 more Healer and 2 more DPS needed here** <@&901> <@&902>");
    expect(message!.allowedMentions).toEqual({ parse: [], roles: ["901", "902"], users: [], repliedUser: false });
  });

  it("one short bold line with correct singular / plural, mentions last and outside the bold", () => {
    const pingRoleIds = { TANK: "900", HEALER: "901", DPS: "902" };
    const content = (roles: Array<{ role: "TANK" | "HEALER" | "DPS"; missing: number }>) =>
      buildLateFillHelpMessage({ roles, pingRoleIds })!.content;
    expect(content([{ role: "DPS", missing: 3 }])).toBe("**3 more DPS needed here** <@&902>");
    expect(content([{ role: "DPS", missing: 1 }])).toBe("**1 more DPS needed here** <@&902>");
    expect(content([{ role: "HEALER", missing: 1 }])).toBe("**1 more Healer needed here** <@&901>");
    expect(content([{ role: "HEALER", missing: 2 }])).toBe("**2 more Healers needed here** <@&901>");
    expect(content([{ role: "TANK", missing: 1 }])).toBe("**1 more Tank needed here** <@&900>");
    expect(content([{ role: "TANK", missing: 2 }])).toBe("**2 more Tanks needed here** <@&900>");
    expect(
      content([
        { role: "TANK", missing: 1 },
        { role: "HEALER", missing: 2 },
        { role: "DPS", missing: 3 },
      ]),
    ).toBe("**1 more Tank, 2 more Healers and 3 more DPS needed here** <@&900> <@&901> <@&902>");
  });

  it("drops roles without a bot-side ping role; null when none is left (the bot marks it SKIPPED)", () => {
    expect(
      buildLateFillHelpMessage({ roles: [{ role: "TANK", missing: 1 }, { role: "DPS", missing: 3 }], pingRoleIds: { TANK: null, HEALER: null, DPS: "902" } })!
        .allowedMentions.roles,
    ).toEqual(["902"]);
    expect(buildLateFillHelpMessage({ roles: [{ role: "TANK", missing: 1 }], pingRoleIds: { TANK: null, HEALER: null, DPS: null } })).toBeNull();
  });

  it("a malformed stored snapshot never pings an unknown role", () => {
    expect(parseLateFillHelpRoles('[{"role":"EVERYONE","missing":3},{"role":"DPS","missing":0},{"role":"HEALER","missing":2},{"role":"HEALER","missing":5}]')).toEqual([
      { role: "HEALER", missing: 2 },
    ]);
    expect(parseLateFillHelpRoles("not json")).toEqual([]);
    expect(parseLateFillHelpRoles(null)).toEqual([]);
  });
});
