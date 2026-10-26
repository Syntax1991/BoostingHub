import { DIFFICULTY_ABBREVIATIONS, RUN_LOOT_TYPE_LABELS, RUN_STATUS_LABELS } from "@/lib/labels";
import type { RaidDifficulty, RunLootType, RunStatus } from "@/models/enums";

/**
 * The one naming helper for Run / Run Setup choices in selects (Create Run,
 * Schedule plan / slot forms, attach / adopt existing Run). Everything is
 * derived from authoritative fields at render time — the persisted Run title
 * (server-derived by `buildRunTitle`, rewritten on every edit) and the Run
 * Setup's live name / contents — so an edit shows up on the next load.
 * Raid contents use the compact short title ("Venom & Tide & Kithix"), never
 * the concatenated full raid names.
 */

/** Compact run type + coverage, e.g. `HC VIP 10/10`. */
export function runMetaLabel(input: { difficulty: RaidDifficulty; lootType: RunLootType; titleCoverage: string }): string {
  return `${DIFFICULTY_ABBREVIATIONS[input.difficulty]} ${RUN_LOOT_TYPE_LABELS[input.lootType]} ${input.titleCoverage}`;
}

function containsToken(text: string, token: string): boolean {
  return text.toLocaleLowerCase("en").split(/[\s·]+/).includes(token.toLocaleLowerCase("en"));
}

/**
 * Run Setup option: its name, the content short title and the run type —
 * minus whatever the name already says (an auto name like `HC 10/10 VIP`
 * is not followed by `HC VIP 10/10` again).
 * e.g. `HC 10/10 VIP · Venom & Tide & Kithix`, `Monday Bundle · Venom & Tide · HC VIP 9/9`.
 */
export function runSetupSelectionLabel(input: {
  name: string;
  contentTitle: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  titleCoverage: string;
}): string {
  const name = input.name.trim();
  const meta = runMetaLabel(input)
    .split(" ")
    .filter((token) => !containsToken(name, token))
    .join(" ");
  // The name already names every raid of the content (any order: "Venom & Tide" covers "Tide & Venom").
  const lowerName = name.toLocaleLowerCase("en");
  const namesAllRaids = input.contentTitle
    .split(" & ")
    .every((raid) => lowerName.includes(raid.trim().toLocaleLowerCase("en")));
  const content = namesAllRaids ? "" : input.contentTitle;
  return [name, content, meta].filter(Boolean).join(" · ");
}

/** Default name for a Run Setup created from a Run / Create Run: `HC VIP 10/10 · Venom & Tide & Kithix`. */
export function runSetupDefaultName(input: {
  contentTitle: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  titleCoverage: string;
}): string {
  return `${runMetaLabel(input)} · ${input.contentTitle}`.slice(0, 80);
}

const QUIET_STATUSES: readonly RunStatus[] = ["OPEN"];

/**
 * Existing Run option: the Run title (`Mon 20:00 HC VIP 10/10 Alantra` —
 * time, type, coverage and Raid Lead), plus its status when that matters for
 * the choice (anything but Open).
 */
export function runSelectionLabel(run: { title: string; status: RunStatus }): string {
  return QUIET_STATUSES.includes(run.status) ? run.title : `${run.title} · ${RUN_STATUS_LABELS[run.status]}`;
}
