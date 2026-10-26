/** Raid Catalog sections, represented in the URL (`?tab=`) so refresh, back/forward and deep links keep them. */
export const RAID_CATALOG_TABS = ["raids", "presets"] as const;

export type RaidCatalogTab = (typeof RAID_CATALOG_TABS)[number];

type SearchValue = string | string[] | undefined;

/** Missing, repeated or unknown `?tab=` values fall back to Raids. */
export function resolveRaidCatalogTab(value: SearchValue): RaidCatalogTab {
  return RAID_CATALOG_TABS.find((tab) => tab === value) ?? "raids";
}

/* ------------------------------------------------------------ Raids scope */

/** Lifecycle filter of the Raids tab (`?status=`). */
export const RAID_STATUS_FILTERS = ["active", "archived", "all"] as const;

export type RaidStatusFilter = (typeof RAID_STATUS_FILTERS)[number];

/** A season scope: the current season, every season, or one persisted `Raid.season` value. */
export type RaidSeasonFilter =
  | { kind: "current" }
  | { kind: "all" }
  | { kind: "season"; name: string };

/**
 * `season: null` means "no season chosen" (`?season=` absent): Active then
 * means the current season, Archived / All mean every season — so the
 * default view is the short current working set while archived raids of
 * older seasons are one click away.
 */
export type RaidCatalogRaidScope = { status: RaidStatusFilter; season: RaidSeasonFilter | null };

export const DEFAULT_RAID_SCOPE: RaidCatalogRaidScope = { status: "active", season: null };

export function defaultSeasonFor(status: RaidStatusFilter): RaidSeasonFilter {
  return status === "active" ? { kind: "current" } : { kind: "all" };
}

export function effectiveSeason(scope: RaidCatalogRaidScope): RaidSeasonFilter {
  return scope.season ?? defaultSeasonFor(scope.status);
}

/**
 * Season filter options, newest first: the code-defined Blizzard seasons
 * (`RAID_SEASONS`, via the page's import seasons) that have persisted raids,
 * then any other persisted `Raid.season` value (manual raids), A–Z.
 */
export function raidSeasonOptions(
  persistedSeasons: readonly string[],
  importSeasons: ReadonlyArray<{ name: string }>,
): string[] {
  const persisted = new Set(persistedSeasons);
  const known = importSeasons.map((season) => season.name).filter((name) => persisted.has(name));
  const knownSet = new Set(known);
  return [...known, ...persistedSeasons.filter((name) => !knownSet.has(name))];
}

/** Unknown / repeated values fall back to the defaults (Active, no season chosen). */
export function resolveRaidCatalogScope(
  params: { status?: SearchValue; season?: SearchValue },
  seasonOptions: readonly string[],
): RaidCatalogRaidScope {
  const status =
    RAID_STATUS_FILTERS.find((value) => value === params.status) ?? DEFAULT_RAID_SCOPE.status;
  const raw = params.season;
  const season: RaidSeasonFilter | null =
    raw === "all"
      ? { kind: "all" }
      : raw === "current"
        ? { kind: "current" }
        : typeof raw === "string" && seasonOptions.includes(raw)
          ? { kind: "season", name: raw }
          : null;
  return { status, season };
}

type ScopedRaid = { season: string; archived: boolean };

export function matchesRaidSeason(
  raid: ScopedRaid,
  season: RaidSeasonFilter,
  currentSeason: string | null,
): boolean {
  if (season.kind === "all") return true;
  if (season.kind === "season") return raid.season === season.name;
  // No season is marked current in code: nothing to narrow by.
  return currentSeason == null || raid.season === currentSeason;
}

export function matchesRaidStatus(raid: ScopedRaid, status: RaidStatusFilter): boolean {
  if (status === "all") return true;
  return status === "archived" ? raid.archived : !raid.archived;
}

function scopedFor<T extends ScopedRaid>(
  raids: readonly T[],
  scope: RaidCatalogRaidScope,
  currentSeason: string | null,
): T[] {
  const season = effectiveSeason(scope);
  return raids.filter(
    (raid) => matchesRaidSeason(raid, season, currentSeason) && matchesRaidStatus(raid, scope.status),
  );
}

/** The raids the Raids tab shows, plus what each status link would show (same season choice). */
export function scopeRaids<T extends ScopedRaid>(
  raids: readonly T[],
  scope: RaidCatalogRaidScope,
  currentSeason: string | null,
): { visible: T[]; counts: Record<RaidStatusFilter, number> } {
  const countFor = (status: RaidStatusFilter) =>
    scopedFor(raids, { status, season: scope.season }, currentSeason).length;
  return {
    visible: scopedFor(raids, scope, currentSeason),
    counts: { active: countFor("active"), archived: countFor("archived"), all: countFor("all") },
  };
}

function sameSeason(a: RaidSeasonFilter, b: RaidSeasonFilter): boolean {
  return a.kind === b.kind && (a.kind !== "season" || a.name === (b as { name: string }).name);
}

/** Tab / filter links: defaults are left out, so `?tab=raids` is the clean default view. */
export function raidCatalogHref(
  tab: RaidCatalogTab,
  scope: RaidCatalogRaidScope = DEFAULT_RAID_SCOPE,
): string {
  const params = new URLSearchParams({ tab });
  if (tab === "raids") {
    if (scope.status !== DEFAULT_RAID_SCOPE.status) params.set("status", scope.status);
    const season = scope.season;
    if (season && !sameSeason(season, defaultSeasonFor(scope.status))) {
      params.set("season", season.kind === "season" ? season.name : season.kind);
    }
  }
  return `/manage/raid-catalog?${params.toString()}`;
}

export function raidCatalogTabHref(tab: RaidCatalogTab): string {
  return raidCatalogHref(tab);
}
