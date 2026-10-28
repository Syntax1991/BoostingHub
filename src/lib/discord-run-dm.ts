import { absoluteRunUrl } from "@/lib/app-url";
import { discordTimestamp } from "@/lib/discord-timestamp";
import { DIFFICULTY_LABELS } from "@/lib/labels";
import type { RunDetailTab } from "@/lib/run-routes";
import type { RaidDifficulty, RunLootType } from "@/models/enums";

/**
 * The Run identity every Run-related Discord DM shows, derived once per DM:
 * the compact content title (`contentShortTitle` — "Venom & Tide & Kithix",
 * the same identity as the Signup post and lifecycle announcements), the
 * start time, difficulty and Run type.
 */
export type DmRunContext = {
  runId: string;
  contentTitle: string;
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
};

/** `<t:…:F> · HEROIC · VIP` */
export function dmRunMetaLine(run: Pick<DmRunContext, "scheduledStartAt" | "difficulty" | "lootType">): string {
  return `${discordTimestamp(run.scheduledStartAt, "F")} · ${DIFFICULTY_LABELS[run.difficulty].toUpperCase()} · ${run.lootType}`;
}

/**
 * Shared DM hierarchy head: event heading, blank, compact Run title, meta
 * line, blank. Event-specific lines follow; the Run / Roster link goes last.
 */
export function dmRunHeader(heading: string, run: DmRunContext): string[] {
  return [heading, "", run.contentTitle, dmRunMetaLine(run), ""];
}

/** Absolute Run link for the closing line; null when the app URL is not configured. */
export function dmRunUrl(run: Pick<DmRunContext, "runId">, tab?: RunDetailTab): string | null {
  return absoluteRunUrl(run.runId, tab);
}
