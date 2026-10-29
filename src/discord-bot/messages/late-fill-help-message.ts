import { formatLateFillHelpRoles, type LateFillHelpRole, type LateFillHelpRoleKey } from "@/lib/late-fill-help";

export type LateFillPingRoleIds = Record<LateFillHelpRoleKey, string | null>;

/**
 * The Run-channel message of a Late Fill help request: one line pinging the
 * Guild role of each missing role, then what is missing. allowedMentions is
 * restricted to exactly those role ids — no @everyone / @here, no users, no
 * other role. Null when none of the requested roles has a ping role
 * configured on the bot (the caller marks the request SKIPPED).
 */
export function buildLateFillHelpMessage(input: {
  roles: readonly LateFillHelpRole[];
  pingRoleIds: LateFillPingRoleIds;
}): {
  content: string;
  allowedMentions: { parse: []; roles: string[]; users: []; repliedUser: false };
} | null {
  const pinged = input.roles.filter((row) => input.pingRoleIds[row.role]);
  if (pinged.length === 0) return null;
  const roleIds = [...new Set(pinged.map((row) => input.pingRoleIds[row.role]!))];
  return {
    content: [
      roleIds.map((id) => `<@&${id}>`).join(" "),
      `🆘 **Late Fill** — this Run still needs ${formatLateFillHelpRoles(pinged)}. Sign up above if you can join.`,
    ].join("\n"),
    allowedMentions: { parse: [], roles: roleIds, users: [], repliedUser: false },
  };
}
