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

/** "1 Healer · 2 DPS" */
export function formatLateFillHelpRoles(roles: readonly LateFillHelpRole[]): string {
  return roles
    .map((row) => `${row.missing} ${row.missing === 1 ? LATE_FILL_HELP_ROLE_LABELS[row.role].one : LATE_FILL_HELP_ROLE_LABELS[row.role].many}`)
    .join(" · ");
}

/** The stored request: the roles to ping, and the classes whose buffs the roster misses. */
export function serializeLateFillHelp(roles: readonly LateFillHelpRole[], classes: readonly WowClass[]): string {
  return JSON.stringify({ roles: roles.map((row) => ({ role: row.role, missing: row.missing })), classes });
}

function parseStored(value: string | null | undefined): { roles: unknown; classes: unknown } {
  if (!value) return { roles: [], classes: [] };
  try {
    const parsed: unknown = JSON.parse(value);
    // Requests stored before class buffs are a plain roles array.
    if (Array.isArray(parsed)) return { roles: parsed, classes: [] };
    const stored = parsed as { roles?: unknown; classes?: unknown } | null;
    return { roles: stored?.roles ?? [], classes: stored?.classes ?? [] };
  } catch {
    return { roles: [], classes: [] };
  }
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
