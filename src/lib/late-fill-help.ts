import type { RunStaffingShortage } from "@/lib/run-staffing";
import type { RunStatus } from "@/models/enums";

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

export function serializeLateFillHelpRoles(roles: readonly LateFillHelpRole[]): string {
  return JSON.stringify(roles.map((row) => ({ role: row.role, missing: row.missing })));
}

/** Stored snapshot → roles; anything malformed is dropped (never pings an unknown role). */
export function parseLateFillHelpRoles(value: string | null | undefined): LateFillHelpRole[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const roles: LateFillHelpRole[] = [];
  for (const entry of parsed) {
    const row = entry as { role?: unknown; missing?: unknown };
    if (typeof row?.role !== "string" || !(LATE_FILL_HELP_ROLES as readonly string[]).includes(row.role)) continue;
    if (typeof row.missing !== "number" || !Number.isInteger(row.missing) || row.missing <= 0) continue;
    if (seen.has(row.role)) continue;
    seen.add(row.role);
    roles.push({ role: row.role as LateFillHelpRoleKey, missing: row.missing });
  }
  return roles;
}
