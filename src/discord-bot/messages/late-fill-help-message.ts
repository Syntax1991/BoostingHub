import {
  escapeCustomPingText,
  missingClassBuffsPhrase,
  missingRolesPhrase,
  resolvePingRoleIds,
  type CustomPing,
  type LateFillHelpRole,
  type LateFillHelpRoleKey,
} from "@/lib/late-fill-help";
import type { WowClass } from "@/models/enums";

export type LateFillPingRoleIds = Record<LateFillHelpRoleKey, string | null>;

function mentions(roleIds: readonly string[]): string {
  return roleIds.map((id) => `<@&${id}>`).join(" ");
}

/**
 * A class's Guild role by its exact name ("Death Knight"): the same by-name
 * convention as the Guild's class emojis, so there is no per-Run or per-Guild
 * mapping to maintain.
 */
export function resolveClassRoleIds(
  guildRoles: ReadonlyArray<{ id: string; name: string; managed: boolean }>,
  classes: readonly WowClass[],
): { roleIds: Partial<Record<WowClass, string>>; unresolved: WowClass[] } {
  return resolvePingRoleIds(guildRoles, classes);
}

/**
 * A help request's delivery nonce: Discord refuses a second message with the
 * same nonce, so a retry after a lost SENT report does not ping twice. Max 25
 * characters; the announcement id's hex digits are unique well before that.
 */
export function helpMessageNonce(announcementId: string): string {
  return announcementId.replace(/-/g, "").slice(0, 25);
}

/**
 * The Run-channel message of a custom request: the Raid Lead's text in bold,
 * then the roles they chose. Text and roles are independent — "Need 1 LB" never
 * implies a Booster ping. allowedMentions is exactly those ids. Null when no
 * chosen role resolves (the caller marks the request SKIPPED).
 */
export function buildCustomPingMessage(
  ping: CustomPing,
  roleIds: Partial<Record<CustomPing["roles"][number], string>>,
): { content: string; allowedMentions: { parse: []; roles: string[]; users: []; repliedUser: false } } | null {
  const ids = [...new Set(ping.roles.map((key) => roleIds[key]).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return null;
  return {
    content: `**${escapeCustomPingText(ping.text)}** ${mentions(ids)}`,
    allowedMentions: { parse: [], roles: ids, users: [], repliedUser: false },
  };
}

/**
 * The Run-channel message of a help request. Each line: the need in bold, then
 * its Guild roles.
 *
 *   **1 more Healer and 3 more DPS needed here** @Healer @DPS
 *   **Missing class buffs: Mage, Warlock** @Mage @Warlock
 *
 * allowedMentions is restricted to exactly those role ids — no @everyone /
 * @here, no users, no other role. A class without a resolved role stays named
 * but is not pinged. Null when nothing could be pinged at all (the caller
 * marks the request SKIPPED).
 */
export function buildLateFillHelpMessage(input: {
  roles: readonly LateFillHelpRole[];
  pingRoleIds: LateFillPingRoleIds;
  classes?: readonly WowClass[];
  classRoleIds?: Partial<Record<WowClass, string>>;
}): {
  content: string;
  allowedMentions: { parse: []; roles: string[]; users: []; repliedUser: false };
} | null {
  const pinged = input.roles.filter((row) => input.pingRoleIds[row.role]);
  const roleIds = [...new Set(pinged.map((row) => input.pingRoleIds[row.role]!))];
  const classes = [...new Set(input.classes ?? [])];
  const classIds = [
    ...new Set(classes.map((wowClass) => input.classRoleIds?.[wowClass]).filter((id): id is string => Boolean(id))),
  ];
  if (roleIds.length === 0 && classIds.length === 0) return null;
  const lines: string[] = [];
  if (pinged.length > 0) lines.push(`**${missingRolesPhrase(pinged)} needed here** ${mentions(roleIds)}`);
  if (classes.length > 0) {
    lines.push(`**${missingClassBuffsPhrase(classes)}** ${mentions(classIds)}`.trimEnd());
  }
  return {
    content: lines.join("\n"),
    allowedMentions: { parse: [], roles: [...new Set([...roleIds, ...classIds])], users: [], repliedUser: false },
  };
}
