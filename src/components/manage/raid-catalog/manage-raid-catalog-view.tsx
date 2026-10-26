import Link from "next/link";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { PageWorkspace } from "@/components/ui/layout";
import { cn } from "@/lib/cn";
import type { RaidCatalogPageData } from "@/services/raid-catalog.service";
import {
  formatBlizzard,
  formatIdList,
  formatWarcraftLogs,
  runAvailabilityLabel,
} from "@/components/manage/raid-catalog/raid-catalog-format";
import {
  ImportRaidDialog,
  ImportSeasonDialog,
} from "@/components/manage/raid-catalog/raid-import-dialogs";
import {
  RaidLifecycleBadge,
  RaidStatusBadges,
} from "@/components/manage/raid-catalog/raid-status-badges";
import {
  DEFAULT_RAID_SCOPE,
  effectiveSeason,
  RAID_STATUS_FILTERS,
  raidCatalogHref,
  raidSeasonOptions,
  scopeRaids,
  type RaidCatalogRaidScope,
  type RaidCatalogTab,
  type RaidSeasonFilter,
  type RaidStatusFilter,
} from "@/components/manage/raid-catalog/raid-catalog-tabs";
import { SeasonFilterSelect } from "@/components/manage/raid-catalog/season-filter-select";
import {
  DeleteProductButton,
  ProductFlagToggle,
  ProductFormDialog,
  type ProductRaidOption,
} from "@/components/manage/raid-catalog/product-controls";

function StatusPill({ on, children }: { on: boolean; children: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 text-xs font-medium",
        on ? "bg-success/15 text-success" : "bg-slate-500/15 text-muted",
      )}
    >
      {children}
    </span>
  );
}

function BossIdRow({
  name,
  blizzard,
  wcl,
}: {
  name: string;
  blizzard: readonly number[];
  wcl: readonly number[];
}) {
  return (
    <>
      <dt className="truncate" title={name}>
        {name}
      </dt>
      <dd className="break-words font-mono">
        Blizzard {formatIdList(blizzard)} · WCL {formatIdList(wcl)}
      </dd>
    </>
  );
}

/** Admin Raid Catalog: persisted raids (with encounters) and run presets — DB authority only. */
export function ManageRaidCatalogView({
  page,
  tab,
  scope = DEFAULT_RAID_SCOPE,
}: {
  page: RaidCatalogPageData;
  tab: RaidCatalogTab;
  scope?: RaidCatalogRaidScope;
}) {
  const currentSeason = page.importSeasons.find((season) => season.current)?.name ?? null;
  const scoped = scopeRaids(page.raids, scope, currentSeason);
  // The Raids count is what the Raids tab shows (default: active raids of the current season).
  const tabs: Array<{ id: RaidCatalogTab; label: string; count: number }> = [
    { id: "raids", label: "Raids", count: scoped.visible.length },
    { id: "presets", label: "Run Presets", count: page.products.length },
  ];

  return (
    <PageWorkspace width="wide">
      <PageHeader title="Raid Catalog" description="Raids, encounters, and reusable run presets." />

      <nav
        aria-label="Raid Catalog sections"
        className="-mx-1 mb-3 flex w-full max-w-full gap-0.5 overflow-x-auto border-b border-border px-1 pb-px"
      >
        {tabs.map((item) => {
          const selected = item.id === tab;
          return (
            <Link
              key={item.id}
              href={raidCatalogHref(item.id, scope)}
              aria-current={selected ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-t-md px-3 text-sm font-medium",
                selected
                  ? "border border-b-0 border-border bg-surface text-foreground shadow-[inset_0_2px_0_0_var(--accent)]"
                  : "text-muted hover:bg-surface-raised hover:text-foreground",
              )}
            >
              {item.label}
              <span className="text-xs font-normal text-muted">· {item.count}</span>
            </Link>
          );
        })}
      </nav>

      {tab === "raids" ? (
        <RaidsSection page={page} scope={scope} currentSeason={currentSeason} scoped={scoped} />
      ) : (
        <RunPresetsSection page={page} />
      )}
    </PageWorkspace>
  );
}

const STATUS_LABELS: Record<RaidStatusFilter, string> = {
  active: "Active",
  archived: "Archived",
  all: "All",
};

function seasonFilterValue(season: RaidSeasonFilter): string {
  return season.kind === "season" ? `season:${season.name}` : season.kind;
}

/** Active / Archived / All segmented control + Season select; both live in the URL. */
function RaidScopeFilters({
  page,
  scope,
  currentSeason,
  counts,
}: {
  page: RaidCatalogPageData;
  scope: RaidCatalogRaidScope;
  currentSeason: string | null;
  counts: Record<RaidStatusFilter, number>;
}) {
  const seasons = raidSeasonOptions(page.seasons, page.importSeasons);
  const seasonChoices: RaidSeasonFilter[] = [
    { kind: "current" },
    ...seasons.map((name) => ({ kind: "season" as const, name })),
    { kind: "all" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2">
      <div
        role="group"
        aria-label="Raid status"
        className="inline-flex shrink-0 rounded-md border border-border bg-surface-raised p-0.5"
      >
        {RAID_STATUS_FILTERS.map((status) => {
          const selected = scope.status === status;
          return (
            <Link
              key={status}
              href={raidCatalogHref("raids", { ...scope, status })}
              aria-current={selected ? "true" : undefined}
              className={cn(
                "inline-flex min-h-9 items-center gap-1 rounded px-2.5 text-xs font-medium",
                selected
                  ? "bg-surface text-foreground shadow-[inset_0_-2px_0_0_var(--accent)]"
                  : "text-muted hover:text-foreground",
              )}
            >
              {STATUS_LABELS[status]}
              <span className="font-normal text-muted">{counts[status]}</span>
            </Link>
          );
        })}
      </div>
      <SeasonFilterSelect
        value={seasonFilterValue(effectiveSeason(scope))}
        options={seasonChoices.map((season) => ({
          value: seasonFilterValue(season),
          label:
            season.kind === "current"
              ? currentSeason
                ? `Current season (${currentSeason})`
                : "Current season"
              : season.kind === "all"
                ? "All seasons"
                : season.name,
          href: raidCatalogHref("raids", { ...scope, season }),
        }))}
      />
    </div>
  );
}

function RaidsSection({
  page,
  scope,
  currentSeason,
  scoped,
}: {
  page: RaidCatalogPageData;
  scope: RaidCatalogRaidScope;
  currentSeason: string | null;
  scoped: ReturnType<typeof scopeRaids<RaidCatalogPageData["raids"][number]>>;
}) {
  return (
    <Card flush>
      <div id="raids">
        <CardHeader
          title="Raids"
          description="Imported from the Blizzard Adventure Journal: names, bosses, boss order and encounter ids stay in sync with Blizzard. Season, order, lockout tracking and run availability are yours to edit."
          action={
            <div className="flex flex-wrap gap-2">
              <ImportSeasonDialog seasons={page.importSeasons} />
              <ImportRaidDialog seasons={page.seasons} />
            </div>
          }
        />
      </div>
      {page.raids.length === 0 ? (
        <EmptyState
          title="No raids yet."
          description="Import a season or a raid from Blizzard to start."
        />
      ) : (
        <>
          <RaidScopeFilters
            page={page}
            scope={scope}
            currentSeason={currentSeason}
            counts={scoped.counts}
          />
          {scoped.visible.length === 0 ? (
            <EmptyState
              title={`No ${scope.status === "all" ? "" : `${STATUS_LABELS[scope.status].toLowerCase()} `}raids in this season scope.`}
              description="Choose All or another season to see older or archived raids."
            />
          ) : (
            <ul className="divide-y divide-border">
              {scoped.visible.map((raid) => (
                <li key={raid.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-medium">
                        {raid.name}
                        {raid.referenced ? (
                          <span className="ml-2 text-xs font-normal text-muted">In use</span>
                        ) : null}
                      </p>
                      <RaidLifecycleBadge raid={raid} />
                      <p className="text-xs text-muted">
                        {raid.season} · {runAvailabilityLabel(raid.availableForRuns)}
                      </p>
                    </div>
                    <Link
                      href={`/manage/raid-catalog/raids/${raid.id}`}
                      className="inline-flex h-8 shrink-0 items-center rounded-md border border-border bg-surface-raised px-2 text-xs font-medium hover:bg-[#222a3b]"
                    >
                      Manage
                    </Link>
                  </div>
                  <RaidStatusBadges status={raid.status} className="mt-2" />
                  <details className="mt-2 text-xs text-muted">
                    <summary className="cursor-pointer select-none hover:text-foreground">
                      Details
                    </summary>
                    <dl className="mt-1 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-2 gap-y-0.5">
                      <dt>Blizzard</dt>
                      <dd className="break-words">{formatBlizzard(raid)}</dd>
                      <dt>Warcraft Logs</dt>
                      <dd className="break-words">{formatWarcraftLogs(raid)}</dd>
                      {raid.bosses.map((boss) => (
                        <BossIdRow
                          key={boss.id}
                          name={boss.name}
                          blizzard={boss.blizzardEncounterIds}
                          wcl={boss.wclEncounterIds}
                        />
                      ))}
                    </dl>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function raidOption(raid: RaidCatalogPageData["raids"][number]): ProductRaidOption {
  return { id: raid.id, name: raid.name, bossTotal: raid.bosses.length };
}

function RunPresetsSection({ page }: { page: RaidCatalogPageData }) {
  // Archived raids are never offered for new product contents; a product keeps the ones it holds.
  const newContentRaids = page.raids.filter((raid) => !raid.archived);
  const raidOptionsFor = (product: RaidCatalogPageData["products"][number]): ProductRaidOption[] =>
    page.raids
      .filter(
        (raid) => !raid.archived || product.contents.some((content) => content.raidId === raid.id),
      )
      .map(raidOption);

  return (
    <Card>
      <div id="run-presets">
        <CardHeader
          title="Run Presets"
          description="What can be scheduled or sold. Run creation still uses the current presets; products drive selection in a later update."
          action={<ProductFormDialog raids={newContentRaids.map(raidOption)} />}
        />
      </div>
      {page.products.length === 0 ? (
        <EmptyState
          title="No products yet."
          description="Create a product from one or more raids."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Product</th>
                <th className="px-4 py-2 font-medium">Contents</th>
                <th className="px-4 py-2 font-medium">Active</th>
                <th className="px-4 py-2 font-medium">Selectable</th>
                <th className="px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {page.products.map((product) => (
                <tr key={product.id} className="border-t border-border align-top">
                  <td className="px-4 py-3 font-medium">{product.name}</td>
                  <td className="px-4 py-3">
                    <ol className="space-y-0.5">
                      {product.contents.map((content) => (
                        <li key={content.id}>
                          {content.raidName} <span className="text-muted">· {content.summary}</span>
                        </li>
                      ))}
                    </ol>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill on={product.active}>
                      {product.active ? "Active" : "Inactive"}
                    </StatusPill>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill on={product.selectable}>
                      {product.selectable ? "Selectable" : "Hidden"}
                    </StatusPill>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <ProductFormDialog
                        raids={raidOptionsFor(product)}
                        product={{
                          productId: product.id,
                          name: product.name,
                          active: product.active,
                          selectable: product.selectable,
                          sortOrder: product.sortOrder,
                          contents: product.contents,
                        }}
                      />
                      <ProductFlagToggle
                        productId={product.id}
                        flag="active"
                        value={product.active}
                      />
                      <ProductFlagToggle
                        productId={product.id}
                        flag="selectable"
                        value={product.selectable}
                      />
                      {product.seeded ? null : (
                        <DeleteProductButton productId={product.id} name={product.name} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
