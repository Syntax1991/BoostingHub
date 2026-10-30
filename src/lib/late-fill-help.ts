import { CLASS_LABELS } from "@/lib/labels";
import type { RunStaffingShortage } from "@/lib/run-staffing";
import { WOW_CLASSES, type RunStatus, type WowClass } from "@/models/enums";

/**
 * Late Fill help: the Raid Lead asks the Guild's ping role for each role the
 * Run still misses (one Discord message in the Run channel). Pure rules only —
 * the service enforces permissions, the cooldown and the Run's state.
 */

/** The roles that have a Guild ping role (Lootbuddies have none). */
export const LATE_FILL_HELP_ROLES = ["TANK", "HEALER", "DPS"] as const;
export type LateFillHelpRoleKey = (typeof LATE_FILL_HELP_ROLES)[number];

/** One role a help request pings, with how many the Run still missed at request time. */
export type LateFillHelpRole = { role: LateFillHelpRoleKey; missing: number };

/** The same role is not pinged again for this long on the same Run. */
export const LATE_FILL_HELP_COOLDOWN_MS = 30 * 60_000;

/** Runs a help request may still go out for: before Start, not cancelled or completed. */
export const LATE_FILL_HELP_RUN_STATUSES: readonly RunStatus[] = ["OPEN", "ROSTERING", "PUBLISHED"];

export const LATE_FILL_HELP_ROLE_LABELS: Record<LateFillHelpRoleKey, { one: string; many: string }> = {
  TANK: { one: "Tank", many: "Tanks" },
  HEALER: { one: "Healer", many: "Healers" },
  DPS: { one: "DPS", many: "DPS" },
};

/** Missing Tank / Healer / DPS (Lootbuddies are never pinged), in that order. */
export function lateFillMissingRoles(missing: Pick<RunStaffingShortage, "tanks" | "healers" | "dps">): LateFillHelpRole[] {
  const counts: Record<LateFillHelpRoleKey, number> = { TANK: missing.tanks, HEALER: missing.healers, DPS: missing.dps };
  return LATE_FILL_HELP_ROLES.filter((role) => counts[role] > 0).map((role) => ({ role, missing: counts[role] }));
}

/** "1 more Healer", "3 more DPS", joined naturally: "A, B and C". */
export function missingRolesPhrase(roles: readonly LateFillHelpRole[]): string {
  const parts = roles.map((row) => {
    const labels = LATE_FILL_HELP_ROLE_LABELS[row.role];
    return `${row.missing} more ${row.missing === 1 ? labels.one : labels.many}`;
  });
  const last = parts.pop()!;
  return parts.length > 0 ? `${parts.join(", ")} and ${last}` : last;
}

/** "Missing class buffs: Mage, Warlock" */
export function missingClassBuffsPhrase(classes: readonly WowClass[]): string {
  return `Missing class buffs: ${classes.map((wowClass) => CLASS_LABELS[wowClass]).join(", ")}`;
}

/** "1 Healer · 2 DPS" */
export function formatLateFillHelpRoles(roles: readonly LateFillHelpRole[]): string {
  return roles
    .map((row) => `${row.missing} ${row.missing === 1 ? LATE_FILL_HELP_ROLE_LABELS[row.role].one : LATE_FILL_HELP_ROLE_LABELS[row.role].many}`)
    .join(" · ");
}

/**
 * The Guild roles a Raid Lead may ping with a custom request — an allowlist:
 * anything else in the Guild (Booster, staff, …) is never offered or pinged.
 */
export const PING_ROLE_KEYS = [...LATE_FILL_HELP_ROLES, "LOOTBUDDY", ...WOW_CLASSES] as const;
export type PingRoleKey = (typeof PING_ROLE_KEYS)[number];

export function pingRoleLabel(key: PingRoleKey): string {
  if (key === "LOOTBUDDY") return "Lootbuddy";
  if (key === "TANK" || key === "HEALER" || key === "DPS") return LATE_FILL_HELP_ROLE_LABELS[key].one;
  return CLASS_LABELS[key];
}

/** Exact Guild role names per key, lower case. A Lootbuddy role is not a Booster role — never substituted. */
function pingRoleNames(key: PingRoleKey): readonly string[] {
  if (key === "LOOTBUDDY") return ["lootbuddy", "lootbuddies", "lb"];
  return [pingRoleLabel(key).toLowerCase()];
}

/**
 * A key's Guild role by its exact name, ignoring case; a configured
 * DISCORD_PING_ROLE_* id wins for Tank / Healer / DPS. No role, a bot-managed
 * role or several matches → unresolved, never another role.
 */
export function resolvePingRoleIds<K extends PingRoleKey>(
  guildRoles: ReadonlyArray<{ id: string; name: string; managed: boolean }>,
  keys: readonly K[],
  configuredIds: Partial<Record<LateFillHelpRoleKey, string | null>> = {},
): { roleIds: Partial<Record<K, string>>; unresolved: K[] } {
  const roleIds: Partial<Record<K, string>> = {};
  const unresolved: K[] = [];
  for (const key of keys) {
    const configured = (configuredIds as Partial<Record<PingRoleKey, string | null>>)[key];
    const names = pingRoleNames(key);
    const matches = guildRoles.filter((role) =>
      configured ? role.id === configured : names.includes(role.name.trim().toLowerCase()),
    );
    if (matches.length === 1 && !matches[0]!.managed) roleIds[key] = matches[0]!.id;
    else unresolved.push(key);
  }
  return { roleIds, unresolved };
}

export const CUSTOM_PING_TEXT_MAX = 200;

/** Single-spaced, trimmed: what is validated, previewed and stored. */
export function normalizeCustomPingText(text: string): string {
  return text.replace(/ +/g, " ").trim();
}

/**
 * Why a custom text cannot go out, or null. Only the selected roles may ping:
 * @everyone / @here and mention syntax are refused outright (allowedMentions
 * blocks them too), as are line breaks and invisible characters that could
 * disguise them.
 */
export function customPingTextError(text: string): string | null {
  const normalized = normalizeCustomPingText(text);
  if (!normalized) return "Write a message first.";
  if (normalized.length > CUSTOM_PING_TEXT_MAX) return `Keep the message to ${CUSTOM_PING_TEXT_MAX} characters.`;
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(normalized)) {
    return "Keep the message on one line, without special characters.";
  }
  if (/@(everyone|here)\b/i.test(normalized) || /<(@|#|\/|id:)/i.test(normalized)) {
    return "Mentions are not allowed in the message — choose the roles to ping below.";
  }
  return null;
}

/** Literal text inside the message's bold: Raid Lead markdown cannot break out of it. */
export function escapeCustomPingText(text: string): string {
  return text.replace(/[\\*_~`|[\]]/g, "\\$&");
}

export type CustomPing = { text: string; roles: PingRoleKey[] };

/** The stored request: the roles to ping, and the classes whose buffs the roster misses. */
export function serializeLateFillHelp(roles: readonly LateFillHelpRole[], classes: readonly WowClass[]): string {
  return JSON.stringify({ roles: roles.map((row) => ({ role: row.role, missing: row.missing })), classes });
}

/** The stored custom request (same column and lane as the automatic one). */
export function serializeCustomPing(ping: CustomPing): string {
  return JSON.stringify({ roles: [], classes: [], custom: ping });
}

function parseStored(value: string | null | undefined): { roles: unknown; classes: unknown; custom: unknown } {
  if (!value) return { roles: [], classes: [], custom: null };
  try {
    const parsed: unknown = JSON.parse(value);
    // Requests stored before class buffs are a plain roles array.
    if (Array.isArray(parsed)) return { roles: parsed, classes: [], custom: null };
    const stored = parsed as { roles?: unknown; classes?: unknown; custom?: unknown } | null;
    return { roles: stored?.roles ?? [], classes: stored?.classes ?? [], custom: stored?.custom ?? null };
  } catch {
    return { roles: [], classes: [], custom: null };
  }
}

/** Stored snapshot → custom request; re-validated, so a bad row never goes out. */
export function parseLateFillHelpCustom(value: string | null | undefined): CustomPing | null {
  const { custom } = parseStored(value);
  const stored = custom as { text?: unknown; roles?: unknown } | null;
  if (typeof stored?.text !== "string" || !Array.isArray(stored.roles) || customPingTextError(stored.text)) return null;
  const roles = [...new Set(stored.roles.filter((row): row is PingRoleKey => (PING_ROLE_KEYS as readonly unknown[]).includes(row)))];
  return roles.length > 0 ? { text: normalizeCustomPingText(stored.text), roles } : null;
}

/** Everything one stored request pinged, automatic or custom: the shared cooldown's keys. */
export function storedPingKeys(value: string | null | undefined): PingRoleKey[] {
  return [
    ...parseLateFillHelpRoles(value).map((row) => row.role),
    ...parseLateFillHelpClasses(value),
    ...(parseLateFillHelpCustom(value)?.roles ?? []),
  ];
}

/** Stored snapshot → roles; anything malformed is dropped (never pings an unknown role). */
export function parseLateFillHelpRoles(value: string | null | undefined): LateFillHelpRole[] {
  const { roles: stored } = parseStored(value);
  if (!Array.isArray(stored)) return [];
  const seen = new Set<string>();
  const roles: LateFillHelpRole[] = [];
  for (const entry of stored) {
    const row = entry as { role?: unknown; missing?: unknown };
    if (typeof row?.role !== "string" || !(LATE_FILL_HELP_ROLES as readonly string[]).includes(row.role)) continue;
    if (typeof row.missing !== "number" || !Number.isInteger(row.missing) || row.missing <= 0) continue;
    if (seen.has(row.role)) continue;
    seen.add(row.role);
    roles.push({ role: row.role as LateFillHelpRoleKey, missing: row.missing });
  }
  return roles;
}

/** Stored snapshot → classes; unknown values dropped, deduped. */
export function parseLateFillHelpClasses(value: string | null | undefined): WowClass[] {
  const { classes } = parseStored(value);
  if (!Array.isArray(classes)) return [];
  return [...new Set(classes.filter((row): row is WowClass => (WOW_CLASSES as readonly unknown[]).includes(row)))];
}
