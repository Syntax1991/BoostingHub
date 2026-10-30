import { CLASS_LABELS } from "@/lib/labels";
import { LATE_FILL_HELP_ROLE_LABELS, type LateFillHelpRole, type LateFillHelpRoleKey } from "@/lib/late-fill-help";
import type { WowClass } from "@/models/enums";

export type LateFillPingRoleIds = Record<LateFillHelpRoleKey, string | null>;

/** "1 more Healer", "3 more DPS", joined naturally: "A, B and C". */
function missingRolesPhrase(roles: readonly LateFillHelpRole[]): string {
  const parts = roles.map((row) => {
    const labels = LATE_FILL_HELP_ROLE_LABELS[row.role];
    return `${row.missing} more ${row.missing === 1 ? labels.one : labels.many}`;
  });
  const last = parts.pop()!;
  return parts.length > 0 ? `${parts.join(", ")} and ${last}` : last;
}

function mentions(roleIds: readonly string[]): string {
  return roleIds.map((id) => `<@&${id}>`).join(" ");
}

/**
 * A class's Guild role by its exact name ("Death Knight"), ignoring case: the
 * same by-name convention as the Guild's class emojis, so there is no per-Run
 * or per-Guild mapping to maintain. No role, a bot-managed role or several
 * roles with that name → unresolved, never another role.
 */
export function resolveClassRoleIds(
  guildRoles: ReadonlyArray<{ id: string; name: string; managed: boolean }>,
  classes: readonly WowClass[],
): { roleIds: Partial<Record<WowClass, string>>; unresolved: WowClass[] } {
  const roleIds: Partial<Record<WowClass, string>> = {};
  const unresolved: WowClass[] = [];
  for (const wowClass of classes) {
    const name = CLASS_LABELS[wowClass].toLowerCase();
    const matches = guildRoles.filter((role) => role.name.trim().toLowerCase() === name);
    if (matches.length === 1 && !matches[0]!.managed) roleIds[wowClass] = matches[0]!.id;
    else unresolved.push(wowClass);
  }
  return { roleIds, unresolved };
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
    const names = classes.map((wowClass) => CLASS_LABELS[wowClass]).join(", ");
    lines.push(`**Missing class buffs: ${names}** ${mentions(classIds)}`.trimEnd());
  }
  return {
    content: lines.join("\n"),
    allowedMentions: { parse: [], roles: [...new Set([...roleIds, ...classIds])], users: [], repliedUser: false },
  };
}
