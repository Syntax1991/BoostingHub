import {
  TIDEBOUND_GROTTO_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
  findRaidCatalogById,
} from "@/lib/wow-raid-catalog";

/**
 * Commercial Create products — not raw Raid rows.
 * Presets expand into RunRaidContent definitions; persisted contents remain
 * authoritative for existing Runs (never regenerate history from presets).
 */
export const RUN_CONTENT_PRESET_KEYS = ["VENOMOUS_ABYSS", "MIDNIGHT_S2_BUNDLE"] as const;
export type RunContentPresetKey = (typeof RUN_CONTENT_PRESET_KEYS)[number];

export type ExpandedRunContent = {
  raidId: string;
  sortOrder: number;
  plannedBossCount: number;
};

export type RunContentDisplay = {
  productKey: RunContentPresetKey | null;
  productLabel: string;
  summary: string;
  shortSummary: string;
};

export type ContentIdentitySlice = {
  raidId: string;
  sortOrder: number;
  plannedBossCount: number;
};

const VENOMOUS_MIN = 1;
const VENOMOUS_MAX = 8;

export function listCreateRunContentPresets(): Array<{
  key: RunContentPresetKey;
  displayName: string;
}> {
  return [
    { key: "VENOMOUS_ABYSS", displayName: "The Venomous Abyss" },
    {
      key: "MIDNIGHT_S2_BUNDLE",
      displayName: "Season 2 Bundle — Nymrissa + The Venomous Abyss",
    },
  ];
}

export function assertValidVenomousPlannedBossCount(value: number): number {
  if (!Number.isInteger(value) || value < VENOMOUS_MIN || value > VENOMOUS_MAX) {
    throw new Error(`Venomous planned boss count must be an integer from ${VENOMOUS_MIN} to ${VENOMOUS_MAX}.`);
  }
  return value;
}

/**
 * Expand a commercial preset into ordered RunRaidContent write specs.
 * Tidebound planned count is always 1 for the Bundle product.
 */
export function expandRunContentPreset(input: {
  preset: RunContentPresetKey;
  venomousPlannedBossCount: number;
}): ExpandedRunContent[] {
  const venomousPlannedBossCount = assertValidVenomousPlannedBossCount(input.venomousPlannedBossCount);

  if (input.preset === "VENOMOUS_ABYSS") {
    return [
      {
        raidId: VENOMOUS_ABYSS_RAID_ID,
        sortOrder: 1,
        plannedBossCount: venomousPlannedBossCount,
      },
    ];
  }

  return [
    {
      raidId: TIDEBOUND_GROTTO_RAID_ID,
      sortOrder: 1,
      plannedBossCount: 1,
    },
    {
      raidId: VENOMOUS_ABYSS_RAID_ID,
      sortOrder: 2,
      plannedBossCount: venomousPlannedBossCount,
    },
  ];
}

/** Transitional singular Run.raidId / plannedBossCount mirror — Venomous is primary. */
export function legacyMirrorFromContents(contents: ExpandedRunContent[]): {
  raidId: string;
  plannedBossCount: number;
} {
  const venomous =
    contents.find((row) => row.raidId === VENOMOUS_ABYSS_RAID_ID) ??
    contents.slice().sort((a, b) => a.sortOrder - b.sortOrder)[0];
  if (!venomous) {
    throw new Error("Run contents must include at least one raid content row.");
  }
  return {
    raidId: venomous.raidId,
    plannedBossCount: venomous.plannedBossCount,
  };
}

/**
 * Classify persisted contents by raid identity (not length alone).
 * Display still honors persisted sortOrder via projectRunContentDisplay.
 */
export function classifyRunContents(
  contents: readonly ContentIdentitySlice[],
): RunContentPresetKey | "CUSTOM" {
  const ordered = [...contents].sort((a, b) => a.sortOrder - b.sortOrder);
  if (ordered.length === 0) return "CUSTOM";

  if (
    ordered.length === 1 &&
    ordered[0]!.raidId === VENOMOUS_ABYSS_RAID_ID
  ) {
    return "VENOMOUS_ABYSS";
  }

  if (ordered.length === 2) {
    const ids = new Set(ordered.map((row) => row.raidId));
    if (ids.has(TIDEBOUND_GROTTO_RAID_ID) && ids.has(VENOMOUS_ABYSS_RAID_ID) && ids.size === 2) {
      const tidebound = ordered.find((row) => row.raidId === TIDEBOUND_GROTTO_RAID_ID)!;
      if (tidebound.plannedBossCount === 1) {
        return "MIDNIGHT_S2_BUNDLE";
      }
    }
  }

  return "CUSTOM";
}

function bossSegment(name: string, planned: number, total: number): string {
  return `${name} ${planned}/${total}`;
}

function contentDisplayName(raidId: string, raidName: string): string {
  if (raidId === TIDEBOUND_GROTTO_RAID_ID) return "Nymrissa";
  return raidName;
}

export function projectRunContentDisplay(
  contents: ReadonlyArray<{
    raidId: string;
    raidName: string;
    sortOrder: number;
    plannedBossCount: number;
    totalBossCount: number;
  }>,
): RunContentDisplay {
  const ordered = [...contents].sort((a, b) => a.sortOrder - b.sortOrder);
  const productKey = classifyRunContents(ordered);
  const key = productKey === "CUSTOM" ? null : productKey;

  const productLabel =
    key === "MIDNIGHT_S2_BUNDLE"
      ? "Season 2 Bundle"
      : key === "VENOMOUS_ABYSS"
        ? "The Venomous Abyss"
        : ordered.map((row) => row.raidName).join(" · ") || "Unknown content";

  const summary = ordered
    .map((row) =>
      bossSegment(contentDisplayName(row.raidId, row.raidName), row.plannedBossCount, row.totalBossCount),
    )
    .join(" · ");

  return {
    productKey: key,
    productLabel,
    summary,
    shortSummary: summary,
  };
}

export function venomousBossMaxFromCatalog(): number {
  return findRaidCatalogById(VENOMOUS_ABYSS_RAID_ID)?.bosses.length ?? VENOMOUS_MAX;
}
