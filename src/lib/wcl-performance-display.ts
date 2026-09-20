import { CHARACTER_ROLE_LABELS } from "@/lib/labels";
import type { CharacterRole } from "@/models/enums";

export type WclPerformanceRoleSegment = {
  role: CharacterRole;
  /** Spec label when specialization matches this role; otherwise null. */
  specLabel: string | null;
  bestPct: number | null;
  avgPct: number | null;
};

export type WclPerformanceRaidSegment = {
  raidId: string;
  raidName: string;
  roles: WclPerformanceRoleSegment[];
};

/** Compact display line for one raid segment (multi-role joins with ·). */
export function formatWclPerformanceRaidLine(segment: WclPerformanceRaidSegment): string {
  const roleParts = segment.roles.map((role) => {
    const roleLabel = role.specLabel
      ? `${CHARACTER_ROLE_LABELS[role.role]} (${role.specLabel})`
      : CHARACTER_ROLE_LABELS[role.role];
    const best = role.bestPct != null ? `best ${role.bestPct}%` : null;
    const avg = role.avgPct != null ? `avg ${role.avgPct}%` : null;
    const stats = [best, avg].filter(Boolean).join(" · ");
    return `${roleLabel} ${stats}`;
  });
  return `${segment.raidName} · ${roleParts.join(" · ")}`;
}
