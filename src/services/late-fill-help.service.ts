import { assertCanManageRun, type AuthenticatedUser } from "@/auth/authorization";
import { discordGuildMemberClient } from "@/integrations/discord/discord-guild-member.client";
import { getDiscordGuildReadConfig, getDiscordPingRoleConfig } from "@/lib/discord-config";
import { DomainError } from "@/lib/errors";
import {
  customPingTextError,
  formatLateFillHelpRoles,
  LATE_FILL_HELP_COOLDOWN_MS,
  LATE_FILL_HELP_ROLE_LABELS,
  LATE_FILL_HELP_RUN_STATUSES,
  lateFillMissingRoles,
  missingClassBuffsPhrase,
  missingRolesPhrase,
  normalizeCustomPingText,
  PING_ROLE_KEYS,
  pingRoleLabel,
  resolvePingRoleIds,
  type LateFillHelpRole,
  type LateFillHelpRoleKey,
  type PingRoleKey,
} from "@/lib/late-fill-help";
import { CLASS_LABELS } from "@/lib/labels";
import { projectRunStaffingFromRun, selectedRosterSignups } from "@/lib/run-staffing";
import type { WowClass } from "@/models/enums";
import { rosterRepository } from "@/repositories/roster.repository";
import { runDiscordAnnouncementRepository } from "@/repositories/run-discord-announcement.repository";
import { runDiscordPostRepository } from "@/repositories/run-discord-post.repository";
import { runRepository, type RunListRecord } from "@/repositories/run.repository";
import { missingBuffProviderClasses, resolveBuffContributorClass } from "@/services/roster-raid-buffs";

export type LateFillHelpResult = {
  /** Roles the request pings (one Run-channel message, sent by the bot). */
  pinged: LateFillHelpRole[];
  /** Classes whose buffs the saved roster misses, named in the same message. */
  missingClassBuffs: WowClass[];
  /** Roles asked for too recently — not pinged again yet. */
  cooling: Array<{ role: LateFillHelpRoleKey; availableAt: string }>;
  /** Missing roles without a Guild ping role configured. */
  notConfigured: LateFillHelpRoleKey[];
};

/**
 * Classes whose buffs the SAVED roster misses (same picks as the staffing, same
 * coverage as the Roster tab). Unknown classes → none, see missingBuffProviderClasses.
 */
function savedRosterMissingClassBuffs(run: RunListRecord): WowClass[] {
  return missingBuffProviderClasses([
    ...selectedRosterSignups(run).map(({ signup }) => ({
      signupId: signup.id,
      userName: signup.userName,
      participationType: signup.participationType,
      lootbuddyMode: null,
      wowClass: resolveBuffContributorClass({
        participationType: signup.participationType,
        lootbuddyMode: null,
        lootbuddyClass: signup.lootbuddyClass,
        characterWowClass: signup.character?.wowClass ?? null,
      }),
      characterName: signup.character?.name ?? null,
    })),
    ...(run.roster?.externalBoosters ?? []).map((booster) => ({
      signupId: `external:${booster.id}`,
      userName: booster.name,
      participationType: booster.participationType,
      lootbuddyMode: null,
      wowClass: booster.wowClass,
      characterName: booster.name,
    })),
  ]);
}

function roleList(roles: readonly LateFillHelpRoleKey[]): string {
  return roles.map((role) => LATE_FILL_HELP_ROLE_LABELS[role].many).join(", ");
}

/** "again in 12 min" for the earliest of the cooling roles. */
function againIn(availableAts: readonly string[], now: Date): string {
  const next = availableAts.map((at) => Date.parse(at)).sort((a, b) => a - b)[0]!;
  return `again in ${Math.max(1, Math.ceil((next - now.getTime()) / 60_000))} min`;
}

/** Everyone-may-manage + Run state + Run channel: the same gate for preview, automatic and custom. */
async function loadPingableRun(user: AuthenticatedUser, runId: string): Promise<RunListRecord> {
  const run = await runRepository.findById(runId);
  if (!run) throw new DomainError("NOT_FOUND", "Run was not found.", 404);
  assertCanManageRun(user, run);
  if (run.archivedAt || !LATE_FILL_HELP_RUN_STATUSES.includes(run.status)) {
    throw new DomainError("LATE_FILL_HELP_UNAVAILABLE", "Help can only be requested before the Run starts.", 409);
  }
  const post = await runDiscordPostRepository.findByRunId(run.id);
  if (!post?.runChannelId) {
    throw new DomainError("LATE_FILL_HELP_NO_CHANNEL", "This Run has no Discord channel yet.", 409);
  }
  return run;
}

/** The allowed ping roles that exist on Discord right now, uniquely; null when Discord cannot say. */
async function availablePingRoles(): Promise<PingRoleKey[] | null> {
  const config = getDiscordGuildReadConfig();
  if (!config) return null;
  try {
    const guildRoles = await discordGuildMemberClient.listRoles(config);
    const { roleIds } = resolvePingRoleIds(guildRoles, PING_ROLE_KEYS, getDiscordPingRoleConfig());
    return PING_ROLE_KEYS.filter((key) => roleIds[key]);
  } catch {
    return null;
  }
}

export type PingPreviewLine = { text: string; mentions: string[] };

export type PingRolesDialogData = {
  automatic: {
    /** The message Automatic would send now; empty when it has nothing to send. */
    lines: PingPreviewLine[];
    /** Why there is nothing to send. */
    emptyReason: string | null;
    /** Missing roles held back by the cooldown or without a ping role. */
    notes: string[];
  };
  /** Roles a custom request can ping; null when Discord could not be read. */
  roles: Array<{ key: PingRoleKey; label: string }> | null;
};

/**
 * Late Fill help: an explicit Raid Lead request to ping the Guild's Tank /
 * Healer / DPS role for what the Run still misses, as one message in the Run
 * channel (RunDiscordAnnouncement LATE_FILL_HELP, posted by the bot lane).
 *
 * - Who: whoever may manage the Run (assertCanManageRun).
 * - When: any time before Start — Run OPEN / ROSTERING / PUBLISHED, not
 *   archived, with a Run channel; re-checked by the bot
 *   right before posting (getRunAnnouncementDeliveryAuthority).
 * - What: only roles the SAVED roster is short of (authoritative staffing, not
 *   an unsaved draft) and that have a DISCORD_PING_ROLE_* configured.
 * - Also names the classes whose buffs the saved roster misses (their Guild
 *   roles are pinged in the same message, resolved by the bot; see
 *   lib/late-fill-help and discord-bot/messages/late-fill-help-message).
 * - Anti-spam: each role and class at most once per LATE_FILL_HELP_COOLDOWN_MS per Run,
 *   enforced under the roster row lock, so concurrent clicks send one message.
 * - Never changes the roster, signups or the Run.
 *
 * A custom request (`requestCustom`) goes the same way — same gate, lock,
 * cooldown, lane and channel — but with the Raid Lead's own text and chosen
 * roles, independent of any open slot.
 */
export const lateFillHelpService = {
  /** Read-only: what the Ping roles dialog shows. Writes nothing, starts no cooldown. */
  async dialogData(user: AuthenticatedUser, runId: string, now: Date = new Date()): Promise<PingRolesDialogData> {
    const run = await loadPingableRun(user, runId);
    const [roles, lastAt] = await Promise.all([
      availablePingRoles(),
      runDiscordAnnouncementRepository.recentPings(run.id, now.toISOString(), LATE_FILL_HELP_COOLDOWN_MS),
    ]);
    const missing = lateFillMissingRoles(projectRunStaffingFromRun(run).missing);
    const pingRoles = getDiscordPingRoleConfig();
    const sendable = missing.filter((row) => pingRoles[row.role] && !lastAt.has(row.role));
    const notes: string[] = [];
    const cooling = missing.filter((row) => lastAt.has(row.role)).map((row) => row.role);
    const notConfigured = missing.filter((row) => !pingRoles[row.role]).map((row) => row.role);
    if (cooling.length > 0) {
      const availableAts = cooling.map((role) => new Date(lastAt.get(role)! + LATE_FILL_HELP_COOLDOWN_MS).toISOString());
      notes.push(`${roleList(cooling)} asked for recently — ${againIn(availableAts, now)}.`);
    }
    if (notConfigured.length > 0) notes.push(`No ping role for ${roleList(notConfigured)}.`);

    const lines: PingPreviewLine[] = [];
    if (sendable.length > 0) {
      lines.push({
        text: `${missingRolesPhrase(sendable)} needed here`,
        mentions: sendable.map((row) => pingRoleLabel(row.role)),
      });
      const classes = savedRosterMissingClassBuffs(run).filter((wowClass) => !lastAt.has(wowClass));
      if (classes.length > 0) {
        lines.push({
          text: missingClassBuffsPhrase(classes),
          // Without a role list the bot still decides; name the classes as it would ping them.
          mentions: classes.filter((wowClass) => !roles || roles.includes(wowClass)).map((wowClass) => pingRoleLabel(wowClass)),
        });
      }
    }
    return {
      automatic: {
        lines,
        emptyReason:
          lines.length > 0
            ? null
            : missing.length === 0
              ? "The saved roster has no open Tank, Healer or DPS slot."
              : "Nothing to ping right now.",
        notes,
      },
      roles: roles?.map((key) => ({ key, label: pingRoleLabel(key) })) ?? null,
    };
  },

  /**
   * One message with the Raid Lead's own text, pinging the roles they chose.
   * Works on a fully staffed roster; the text never implies a role. Validated
   * here, re-validated by the bot from the stored row.
   */
  async requestCustom(
    user: AuthenticatedUser,
    input: { runId: string; text: string; roles: readonly PingRoleKey[] },
    now: Date = new Date(),
  ): Promise<{ text: string; roles: PingRoleKey[] }> {
    const run = await loadPingableRun(user, input.runId);
    const textError = customPingTextError(input.text);
    if (textError) throw new DomainError("CUSTOM_PING_INVALID", textError, 400);
    const roles = [...new Set(input.roles)];
    if (roles.length === 0) throw new DomainError("CUSTOM_PING_INVALID", "Choose at least one role to ping.", 400);

    const available = await availablePingRoles();
    if (!available) {
      throw new DomainError("CUSTOM_PING_ROLES_UNAVAILABLE", "Discord roles could not be checked — nothing was sent. Try again.", 503);
    }
    const unavailable = roles.filter((key) => !available.includes(key));
    if (unavailable.length > 0) {
      throw new DomainError(
        "CUSTOM_PING_ROLE_NOT_AVAILABLE",
        `No unique Discord role for ${unavailable.map((key) => pingRoleLabel(key)).join(", ")} — nothing was sent.`,
        409,
      );
    }

    const ping = { text: normalizeCustomPingText(input.text), roles };
    const roster = await rosterRepository.ensure(run.id);
    const result = await runDiscordAnnouncementRepository.createCustomPing({
      runId: run.id,
      rosterId: roster.id,
      ping,
      cooldownMs: LATE_FILL_HELP_COOLDOWN_MS,
      now: now.toISOString(),
      scheduledStartAt: run.scheduledStartAt,
      productLabel: run.contentDisplay.productLabel,
      difficulty: run.difficulty,
      lootType: run.lootType,
    });
    if (!result.created) {
      throw new DomainError(
        "LATE_FILL_HELP_COOLDOWN",
        `${result.cooling.map((row) => pingRoleLabel(row.key)).join(", ")} pinged recently — ${againIn(result.cooling.map((row) => row.availableAt), now)}.`,
        429,
      );
    }
    return ping;
  },

  async request(user: AuthenticatedUser, runId: string, now: Date = new Date()): Promise<LateFillHelpResult> {
    const run = await loadPingableRun(user, runId);

    const missing = lateFillMissingRoles(projectRunStaffingFromRun(run).missing);
    if (missing.length === 0) {
      throw new DomainError(
        "LATE_FILL_HELP_NOTHING_MISSING",
        "The saved roster has no open Tank, Healer or DPS slot.",
        409,
      );
    }
    const pingRoles = getDiscordPingRoleConfig();
    const configured = missing.filter((row) => pingRoles[row.role]);
    const notConfigured = missing.filter((row) => !pingRoles[row.role]).map((row) => row.role);
    if (configured.length === 0) {
      throw new DomainError(
        "LATE_FILL_HELP_NOT_CONFIGURED",
        `No Discord ping role is configured for ${roleList(notConfigured)}.`,
        409,
      );
    }

    const roster = await rosterRepository.ensure(run.id);
    const result = await runDiscordAnnouncementRepository.createLateFillHelp({
      runId: run.id,
      rosterId: roster.id,
      roles: configured,
      classes: savedRosterMissingClassBuffs(run),
      cooldownMs: LATE_FILL_HELP_COOLDOWN_MS,
      now: now.toISOString(),
      scheduledStartAt: run.scheduledStartAt,
      productLabel: run.contentDisplay.productLabel,
      difficulty: run.difficulty,
      lootType: run.lootType,
    });
    if (!result.created) {
      throw new DomainError(
        "LATE_FILL_HELP_COOLDOWN",
        `${roleList(result.cooling.map((row) => row.role))} were already asked for recently — ${againIn(result.cooling.map((row) => row.availableAt), now)}.`,
        429,
      );
    }
    return { pinged: result.pinged, missingClassBuffs: result.pingedClasses, cooling: result.cooling, notConfigured };
  },
};

/** One-line feedback for the Raid Lead after a successful request. */
export function lateFillHelpFeedback(result: LateFillHelpResult): string {
  const parts = [`Pinged ${formatLateFillHelpRoles(result.pinged)} on Discord.`];
  if (result.missingClassBuffs.length > 0) {
    parts.push(`Missing class buffs: ${result.missingClassBuffs.map((wowClass) => CLASS_LABELS[wowClass]).join(", ")}.`);
  }
  if (result.cooling.length > 0) parts.push(`${roleList(result.cooling.map((row) => row.role))} were asked for recently.`);
  if (result.notConfigured.length > 0) parts.push(`No ping role for ${roleList(result.notConfigured)}.`);
  return parts.join(" ");
}
