import { assertCanManageRun, type AuthenticatedUser } from "@/auth/authorization";
import { getDiscordPingRoleConfig } from "@/lib/discord-config";
import { DomainError } from "@/lib/errors";
import {
  formatLateFillHelpRoles,
  LATE_FILL_HELP_COOLDOWN_MS,
  LATE_FILL_HELP_ROLE_LABELS,
  LATE_FILL_HELP_RUN_STATUSES,
  lateFillMissingRoles,
  type LateFillHelpRole,
  type LateFillHelpRoleKey,
} from "@/lib/late-fill-help";
import { projectRunStaffingFromRun } from "@/lib/run-staffing";
import { rosterRepository } from "@/repositories/roster.repository";
import { runDiscordAnnouncementRepository } from "@/repositories/run-discord-announcement.repository";
import { runDiscordPostRepository } from "@/repositories/run-discord-post.repository";
import { runRepository } from "@/repositories/run.repository";

export type LateFillHelpResult = {
  /** Roles the request pings (one Run-channel message, sent by the bot). */
  pinged: LateFillHelpRole[];
  /** Roles asked for too recently — not pinged again yet. */
  cooling: Array<{ role: LateFillHelpRoleKey; availableAt: string }>;
  /** Missing roles without a Guild ping role configured. */
  notConfigured: LateFillHelpRoleKey[];
};

function roleList(roles: readonly LateFillHelpRoleKey[]): string {
  return roles.map((role) => LATE_FILL_HELP_ROLE_LABELS[role].many).join(", ");
}

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
 * - Anti-spam: each role at most once per LATE_FILL_HELP_COOLDOWN_MS per Run,
 *   enforced under the roster row lock, so concurrent clicks send one message.
 * - Never changes the roster, signups or the Run.
 */
export const lateFillHelpService = {
  async request(user: AuthenticatedUser, runId: string, now: Date = new Date()): Promise<LateFillHelpResult> {
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
      cooldownMs: LATE_FILL_HELP_COOLDOWN_MS,
      now: now.toISOString(),
      scheduledStartAt: run.scheduledStartAt,
      productLabel: run.contentDisplay.productLabel,
      difficulty: run.difficulty,
      lootType: run.lootType,
    });
    if (!result.created) {
      const next = result.cooling.map((row) => row.availableAt).sort()[0]!;
      throw new DomainError(
        "LATE_FILL_HELP_COOLDOWN",
        `${roleList(result.cooling.map((row) => row.role))} were already asked for recently — again from ${next}.`,
        429,
      );
    }
    return { pinged: result.pinged, cooling: result.cooling, notConfigured };
  },
};

/** One-line feedback for the Raid Lead after a successful request. */
export function lateFillHelpFeedback(result: LateFillHelpResult): string {
  const parts = [`Pinged ${formatLateFillHelpRoles(result.pinged)} on Discord.`];
  if (result.cooling.length > 0) parts.push(`${roleList(result.cooling.map((row) => row.role))} were asked for recently.`);
  if (result.notConfigured.length > 0) parts.push(`No ping role for ${roleList(result.notConfigured)}.`);
  return parts.join(" ");
}
