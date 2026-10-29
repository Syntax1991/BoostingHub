import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { buildLateFillHelpMessage } from "@/discord-bot/messages/late-fill-help-message";
import { isDomainError } from "@/lib/errors";
import { LATE_FILL_HELP_COOLDOWN_MS, parseLateFillHelpRoles } from "@/lib/late-fill-help";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import { discordSyncService } from "@/services/discord-sync.service";
import { lateFillHelpService } from "@/services/late-fill-help.service";
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
  if (roster) await orm.RunRoster.where({ id: roster.id }).delete().catch(() => {});
  await orm.RunDomainEvent?.where({ runId }).delete().catch(() => {});
  await orm.Run.where({ id: runId }).delete().catch(() => {});
}

async function cleanupUsers() {
  for (const userId of Object.values(ids)) {
    const runs = (await orm.Run.where({ raidLeadId: userId }).select("id").all()) as Array<{ id: string }>;
    for (const run of runs) await cleanupRun(run.id);
    await orm.User.where({ id: userId }).delete().catch(() => {});
  }
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

  it("invalid Run states: outside Late Fill, no Run channel, cancelled — refused, nothing written", async () => {
    configurePingRoles({ tank: "1", healer: "2", dps: "3" });
    const early = await lateFillRun({ hoursAhead: 72 });
    expect(await codeOf(lateFillHelpService.request(lead, early))).toBe("LATE_FILL_HELP_UNAVAILABLE");
    const noChannel = await lateFillRun({ channel: false });
    expect(await codeOf(lateFillHelpService.request(lead, noChannel))).toBe("LATE_FILL_HELP_NO_CHANNEL");
    const cancelled = await lateFillRun();
    await runService.cancelRun(lead, cancelled);
    expect(await codeOf(lateFillHelpService.request(lead, cancelled))).toBe("LATE_FILL_HELP_UNAVAILABLE");
    for (const runId of [early, noChannel, cancelled]) expect(await helpRows(runId)).toHaveLength(0);
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

describe("Late Fill help Discord message", () => {
  it("pings exactly the requested roles' ids; allowedMentions allows nothing else", () => {
    const message = buildLateFillHelpMessage({
      roles: [
        { role: "HEALER", missing: 1 },
        { role: "DPS", missing: 2 },
      ],
      pingRoleIds: { TANK: "900", HEALER: "901", DPS: "902" },
    });
    expect(message).not.toBeNull();
    expect(message!.content.split("\n")[0]).toBe("<@&901> <@&902>");
    expect(message!.content).toContain("1 Healer · 2 DPS");
    expect(message!.content).not.toContain("@everyone");
    expect(message!.content).not.toContain("<@&900>");
    expect(message!.allowedMentions).toEqual({ parse: [], roles: ["901", "902"], users: [], repliedUser: false });
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
