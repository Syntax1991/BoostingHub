import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ClassIcon } from "@/components/ui/badges";
import { CLASS_COLORS, CLASS_LABELS } from "@/lib/labels";
import { WOW_CLASSES, WOW_REGIONS } from "@/models/enums";
import type { managementController } from "@/controllers/app.controller";
import { SYNC_INELIGIBLE_COPY, type OperationsRow } from "@/services/character-operations.service";
import { CharacterSyncButtons } from "@/components/manage/character-operations/character-sync-buttons";
import { ForceRefreshAllButton } from "@/components/manage/character-operations/force-refresh-all-button";
import { ReconcileLinksButton } from "@/components/manage/character-operations/reconcile-links-button";
import {
  LinkageBadge,
  LockoutSlotsCompact,
  StatusBadge,
  SummaryStat,
  SyncHealthBadge,
  Timestamp,
} from "@/components/manage/character-operations/status";

type Page = Awaited<ReturnType<typeof managementController.getCharactersPage>>;

const selectClass = "h-9 rounded-md border border-border bg-surface px-2";

function CharacterCell({ row }: { row: OperationsRow }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <ClassIcon wowClass={row.wowClass} size={20} />
      <div className="min-w-0">
        <Link
          href={`/manage/characters/${row.id}`}
          className="block truncate font-medium hover:underline"
          style={{ color: CLASS_COLORS[row.wowClass] }}
        >
          {row.name}
        </Link>
        <div className="text-xs text-muted tabular-nums">
          {row.itemLevel != null ? `ilvl ${row.itemLevel}` : "ilvl Unknown"}
        </div>
      </div>
    </div>
  );
}

function ApiCell({ row }: { row: OperationsRow }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <LinkageBadge linkage={row.linkage} />
      {row.health === "ERROR" && row.lastSyncErrorLabel ? (
        <span className="text-xs text-danger">
          {row.lastSyncErrorLabel}
          {row.syncFailureCount > 1 ? ` ×${row.syncFailureCount}` : ""}
        </span>
      ) : null}
    </div>
  );
}

function Actions({ row }: { row: OperationsRow }) {
  return (
    <CharacterSyncButtons
      characterId={row.id}
      characterLabel={`${row.name}-${row.realm}`}
      ineligibleCopy={row.syncIneligibleReason ? SYNC_INELIGIBLE_COPY[row.syncIneligibleReason] : null}
      cooldownRemainingMs={row.cooldownRemainingMs}
      compact
    />
  );
}

export function ManageCharactersView({ data }: { data: Page }) {
  const { filters, rows, summary, bulkEligibleCount } = data;
  const healthHref = (health: string) => `/manage/characters?status=active&health=${health}`;

  return (
    <div className="min-w-0 overflow-x-hidden">
      <PageHeader
        title="Characters"
        description="All characters with Blizzard sync health, linkage and current lockouts."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/manage" className="text-sm text-accent hover:underline">
              Management
            </Link>
            <ReconcileLinksButton />
            <ForceRefreshAllButton eligibleCount={bulkEligibleCount} />
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <SummaryStat label={`Total (${summary.retired} retired)`} value={summary.total} />
        <SummaryStat label="Healthy" value={summary.healthy} tone="success" href={healthHref("HEALTHY")} />
        <SummaryStat label="Stale" value={summary.stale} tone="warning" href={healthHref("STALE")} />
        <SummaryStat label="Sync errors" value={summary.errors} tone="danger" href={healthHref("ERROR")} />
        <SummaryStat label="Never synced" value={summary.neverSynced} tone="info" href={healthHref("NEVER_SYNCED")} />
        <SummaryStat label="Blizzard linked" value={summary.linked} href="/manage/characters?status=active&linkage=LINKED" />
        <SummaryStat
          label="Public API (manual)"
          value={summary.notLinked}
          tone="info"
          href="/manage/characters?status=active&linkage=NOT_LINKED"
        />
      </div>
      <p className="-mt-2 mb-4 text-xs text-muted">
        Counts cover active characters; retired characters never count as problems. Public API = manually added (or no
        owner Battle.net connection): item level and lockouts sync from the public Blizzard API, ownership unverified.
      </p>

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3 px-4 py-3" method="get">
          <label className="min-w-[10rem] flex-1 text-xs">
            <span className="mb-1 block text-muted">Character / realm</span>
            <input
              name="query"
              defaultValue={filters.query ?? ""}
              aria-label="Search character or realm"
              placeholder="Name or realm"
              className="h-9 w-full rounded-md border border-border bg-surface px-2"
            />
          </label>
          <label className="min-w-[9rem] text-xs">
            <span className="mb-1 block text-muted">Owner</span>
            <input
              name="owner"
              defaultValue={filters.owner ?? ""}
              aria-label="Filter by owner"
              placeholder="Name or Discord"
              className="h-9 w-full rounded-md border border-border bg-surface px-2"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted">Class</span>
            <select name="class" defaultValue={filters.wowClass ?? ""} aria-label="Filter by class" className={selectClass}>
              <option value="">All</option>
              {WOW_CLASSES.map((wowClass) => (
                <option key={wowClass} value={wowClass}>
                  {CLASS_LABELS[wowClass]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted">Region</span>
            <select name="region" defaultValue={filters.region ?? ""} aria-label="Filter by region" className={selectClass}>
              <option value="">All</option>
              {WOW_REGIONS.map((region) => (
                <option key={region} value={region}>
                  {region}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted">Status</span>
            <select name="status" defaultValue={filters.status} aria-label="Filter by status" className={selectClass}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="retired">Retired</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted">Blizzard</span>
            <select name="linkage" defaultValue={filters.linkage ?? ""} aria-label="Filter by Blizzard linkage" className={selectClass}>
              <option value="">All</option>
              <option value="LINKED">Linked</option>
              <option value="NOT_LINKED">Public API (manual)</option>
              <option value="NO_CONNECTION">Public API (no connection)</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted">Sync health</span>
            <select name="health" defaultValue={filters.health ?? ""} aria-label="Filter by sync health" className={selectClass}>
              <option value="">All</option>
              <option value="HEALTHY">Healthy</option>
              <option value="STALE">Stale</option>
              <option value="ERROR">Error</option>
              <option value="NEVER_SYNCED">Never synced</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted">Sort</span>
            <select name="sort" defaultValue={filters.sort} aria-label="Sort characters" className={selectClass}>
              <option value="character">Character</option>
              <option value="owner">Owner</option>
              <option value="last_success">Last success</option>
              <option value="health">Sync health (problems first)</option>
            </select>
          </label>
          <button type="submit" className="h-9 rounded-md border border-border px-3 text-xs hover:bg-surface-raised">
            Filter
          </button>
          <Link href="/manage/characters" className="h-9 px-1 text-xs leading-9 text-muted hover:text-foreground">
            Reset
          </Link>
        </form>
        <p className="border-t border-border px-4 py-2 text-xs text-muted">
          {rows.length} of {summary.total} characters. A health filter shows active characters only.
        </p>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No characters match." description="Adjust or reset the filters." />
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[1180px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Character</th>
                    <th className="px-3 py-2 font-medium">Owner</th>
                    <th className="px-3 py-2 font-medium">Class</th>
                    <th className="px-3 py-2 font-medium">Region / Realm</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Last success</th>
                    <th className="px-3 py-2 font-medium">Sync health</th>
                    <th className="px-3 py-2 font-medium">Blizzard/API</th>
                    <th className="px-3 py-2 font-medium">Lockouts</th>
                    <th className="px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-border align-top">
                      <td className="px-3 py-2.5">
                        <CharacterCell row={row} />
                      </td>
                      <td className="px-3 py-2.5">
                        <Link href={`/manage/users/${row.owner.id}`} className="hover:underline">
                          {row.owner.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: CLASS_COLORS[row.wowClass] }}>
                        {CLASS_LABELS[row.wowClass]}
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        <span className="font-medium">{row.region}</span> · {row.realm}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge retired={row.retired} />
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        <Timestamp value={row.lastSyncedAt} />
                      </td>
                      <td className="px-3 py-2.5">
                        <SyncHealthBadge health={row.health} retired={row.retired} />
                      </td>
                      <td className="px-3 py-2.5">
                        <ApiCell row={row} />
                      </td>
                      <td className="px-3 py-2.5">
                        <LockoutSlotsCompact slots={row.lockoutSlots} />
                      </td>
                      <td className="px-3 py-2.5">
                        <Actions row={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-border lg:hidden">
              {rows.map((row) => (
                <li key={row.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <CharacterCell row={row} />
                    <SyncHealthBadge health={row.health} retired={row.retired} />
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-muted">Owner</dt>
                      <dd>
                        <Link href={`/manage/users/${row.owner.id}`} className="hover:underline">
                          {row.owner.name}
                        </Link>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Region / Realm</dt>
                      <dd>
                        {row.region} · {row.realm}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Last success</dt>
                      <dd>
                        <Timestamp value={row.lastSyncedAt} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Blizzard/API</dt>
                      <dd>
                        <ApiCell row={row} />
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-muted">Lockouts</dt>
                      <dd>
                        <LockoutSlotsCompact slots={row.lockoutSlots} />
                      </dd>
                    </div>
                  </dl>
                  <Actions row={row} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
