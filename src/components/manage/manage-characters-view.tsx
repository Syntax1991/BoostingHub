import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { PageWorkspace } from "@/components/ui/layout";
import { ClassIcon } from "@/components/ui/badges";
import { CLASS_COLORS, CLASS_LABELS } from "@/lib/labels";
import { formatCharacterPageSpecLine } from "@/lib/character-roster-metadata";
import { formatRetryIn } from "@/lib/blizzard/sync-backoff";
import { formatDateTime } from "@/lib/datetime";
import { cn } from "@/lib/cn";
import { WOW_CLASSES, WOW_REGIONS } from "@/models/enums";
import type { managementController } from "@/controllers/app.controller";
import { SYNC_INELIGIBLE_COPY, type OperationsRow } from "@/services/character-operations.service";
import { ManageCharacterRowActions } from "@/components/manage/character-operations/manage-character-row-actions";
import { ForceRefreshAllButton } from "@/components/manage/character-operations/force-refresh-all-button";
import { ReconcileLinksButton } from "@/components/manage/character-operations/reconcile-links-button";
import {
  LinkageBadge,
  LockoutSlotsCompact,
  StatusBadge,
  SyncHealthBadge,
  Timestamp,
} from "@/components/manage/character-operations/status";

type Page = Awaited<ReturnType<typeof managementController.getCharactersPage>>;

const selectClass = "h-8 rounded-md border border-border bg-surface px-2 text-sm";
const moduleClass = "rounded-lg border border-border bg-surface";

function CharacterCell({ row }: { row: OperationsRow }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <ClassIcon wowClass={row.wowClass} size={22} />
      <div className="min-w-0">
        <Link
          href={`/manage/characters/${row.id}`}
          className="block truncate text-[13px] font-semibold leading-tight hover:underline"
          style={{ color: CLASS_COLORS[row.wowClass] }}
        >
          {row.name}
        </Link>
        <p className="truncate text-[11px] leading-tight text-muted">
          <span className="tabular-nums">{row.itemLevel != null ? row.itemLevel : "—"}</span>
          <span className="text-muted/50"> · </span>
          {formatCharacterPageSpecLine({
            specialization: row.specialization,
            wowClass: row.wowClass,
            playableSpecs: row.playableSpecs,
          })}
        </p>
      </div>
    </div>
  );
}

/**
 * Compact SYNC column — health primary, last success secondary, source tertiary.
 * Lifecycle (Retired) stays in Status; never duplicate it here.
 */
function SyncCell({ row }: { row: OperationsRow }) {
  const linkage = <LinkageBadge linkage={row.linkage} />;
  const errorDetail =
    row.health === "ERROR" && row.lastSyncErrorLabel ? (
      <span className="truncate text-danger" title={row.lastSyncErrorLabel}>
        {row.lastSyncErrorLabel}
        {row.syncFailureCount > 1 ? ` ×${row.syncFailureCount}` : ""}
      </span>
    ) : null;
  const retry = row.autoRetryAt ? (
    <p
      className="text-muted"
      title={`Automatic sync paused until ${formatDateTime(row.autoRetryAt)}. Sync now still works.`}
    >
      Retry {formatRetryIn(row.autoRetryInMs)}
    </p>
  ) : null;

  if (row.retired) {
    return (
      <div className="min-w-0 space-y-0.5 text-[11px] leading-snug">
        {row.lastSyncedAt ? (
          <p className="text-muted">
            Last sync <Timestamp value={row.lastSyncedAt} />
          </p>
        ) : (
          <p className="text-muted">No sync history</p>
        )}
        <div>{linkage}</div>
      </div>
    );
  }

  if (row.health === "NEVER_SYNCED") {
    return (
      <div className="min-w-0 space-y-0.5 text-[11px] leading-snug">
        <SyncHealthBadge health={row.health} retired={false} />
        <div>{linkage}</div>
        {retry}
      </div>
    );
  }

  if (row.health === "ERROR") {
    return (
      <div className="min-w-0 space-y-0.5 text-[11px] leading-snug">
        <SyncHealthBadge health={row.health} retired={false} />
        {row.lastSyncedAt ? (
          <p className="text-muted">
            Last success <Timestamp value={row.lastSyncedAt} />
          </p>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {linkage}
          {errorDetail}
        </div>
        {retry}
      </div>
    );
  }

  // HEALTHY | STALE — compose health · relative time on one primary line
  return (
    <div className="min-w-0 space-y-0.5 text-[11px] leading-snug">
      <div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
        <SyncHealthBadge health={row.health} retired={false} />
        {row.lastSyncedAt ? (
          <span className="truncate text-muted">
            <span className="text-muted/40" aria-hidden>
              ·{" "}
            </span>
            <Timestamp value={row.lastSyncedAt} />
          </span>
        ) : null}
      </div>
      <div>{linkage}</div>
      {retry}
    </div>
  );
}

function HealthStrip({ summary }: { summary: Page["summary"] }) {
  const healthHref = (health: string) => `/manage/characters?status=active&health=${health}`;
  const item = (
    href: string | null,
    label: string,
    value: number,
    tone?: "success" | "warning" | "danger" | "info",
  ) => {
    const body = (
      <span className="inline-flex items-baseline gap-1">
        <span
          className={cn(
            "tabular-nums font-semibold",
            value > 0 && tone === "success" && "text-success",
            value > 0 && tone === "warning" && "text-warning",
            value > 0 && tone === "danger" && "text-danger",
            value > 0 && tone === "info" && "text-info",
            !(value > 0 && tone) && "text-foreground",
          )}
        >
          {value}
        </span>
        <span className="text-muted">{label}</span>
      </span>
    );
    if (!href) return <span key={label}>{body}</span>;
    return (
      <Link key={label} href={href} className="hover:underline underline-offset-2">
        {body}
      </Link>
    );
  };

  return (
    <div className={cn(moduleClass, "mb-3 px-3.5 py-2.5")}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        {item(null, `total (${summary.retired} retired)`, summary.total)}
        <span className="text-muted/40" aria-hidden>
          ·
        </span>
        {item(healthHref("HEALTHY"), "healthy", summary.healthy, "success")}
        <span className="text-muted/40" aria-hidden>
          ·
        </span>
        {item(healthHref("STALE"), "stale", summary.stale, "warning")}
        <span className="text-muted/40" aria-hidden>
          ·
        </span>
        {item(healthHref("ERROR"), "sync errors", summary.errors, "danger")}
        <span className="text-muted/40" aria-hidden>
          ·
        </span>
        {item(healthHref("NEVER_SYNCED"), "never synced", summary.neverSynced, "info")}
        <span className="text-muted/40" aria-hidden>
          ·
        </span>
        {item("/manage/characters?status=active&linkage=LINKED", "Blizzard linked", summary.linked)}
        <span className="text-muted/40" aria-hidden>
          ·
        </span>
        {item("/manage/characters?status=active&linkage=NOT_LINKED", "Public API", summary.notLinked, "info")}
      </div>
      <p className="mt-1 text-[11px] text-muted">
        Active characters only in health counts. Public API = manual / no Battle.net — ownership unverified.
      </p>
    </div>
  );
}

export function ManageCharactersView({ data }: { data: Page }) {
  const { filters, rows, summary, bulkEligibleCount } = data;

  return (
    <PageWorkspace width="full" className="min-w-0 overflow-x-hidden">
      <PageHeader
        title="Characters"
        description="Blizzard sync health, linkage, and current lockouts."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/manage" className="text-xs text-accent hover:underline">
              Management
            </Link>
            <ReconcileLinksButton />
            <ForceRefreshAllButton eligibleCount={bulkEligibleCount} />
          </div>
        }
      />

      <HealthStrip summary={summary} />

      <div className={cn(moduleClass, "mb-3")}>
        <form className="flex flex-wrap items-end gap-2 px-3 py-2.5" method="get">
          <label className="min-w-[12rem] flex-[2] text-xs">
            <span className="mb-1 block text-muted">Character / realm</span>
            <input
              name="query"
              defaultValue={filters.query ?? ""}
              aria-label="Search character or realm"
              placeholder="Name or realm"
              className="h-9 w-full rounded-md border border-border bg-surface px-2"
            />
          </label>
          <label className="min-w-[9rem] flex-1 text-xs">
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
          <button type="submit" className="h-8 rounded-md border border-border px-2.5 text-xs hover:bg-surface-raised">
            Filter
          </button>
          <Link href="/manage/characters" className="h-8 px-1 text-xs leading-8 text-muted hover:text-foreground">
            Reset
          </Link>
        </form>
        <p className="border-t border-border/70 px-3.5 py-1.5 text-[11px] text-muted">
          {rows.length} of {summary.total} characters. Health filters show active only.
        </p>
      </div>

      <div className={cn(moduleClass, "overflow-hidden")}>
        {rows.length === 0 ? (
          <EmptyState title="No characters match." description="Adjust or reset the filters." />
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[1040px] text-left text-sm">
                <thead className="text-[10px] uppercase tracking-wide text-muted">
                  <tr className="border-b border-border/80">
                    <th className="px-3 py-2 font-medium">Character</th>
                    <th className="px-3 py-2 font-medium">Owner</th>
                    <th className="px-3 py-2 font-medium">Realm</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Sync</th>
                    <th className="px-3 py-2 font-medium">Lockouts</th>
                    <th className="px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-border/70 align-middle hover:bg-surface-raised/25">
                      <td className="px-3 py-2">
                        <CharacterCell row={row} />
                      </td>
                      <td className="px-3 py-2 text-[13px]">
                        <Link href={`/manage/users/${row.owner.id}`} className="hover:underline">
                          {row.owner.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-[12px] text-muted">
                        <span className="font-medium text-foreground/80">{row.region}</span> · {row.realm}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge retired={row.retired} />
                      </td>
                      <td className="px-3 py-2">
                        <SyncCell row={row} />
                      </td>
                      <td className="px-3 py-2">
                        <LockoutSlotsCompact slots={row.lockoutSlots} />
                      </td>
                      <td className="relative px-3 py-2">
                        <ManageCharacterRowActions
                          row={{
                            id: row.id,
                            name: row.name,
                            realm: row.realm,
                            cooldownRemainingMs: row.cooldownRemainingMs,
                            ineligibleCopy: row.syncIneligibleReason
                              ? SYNC_INELIGIBLE_COPY[row.syncIneligibleReason]
                              : null,
                            deleteBlockedReason: row.deleteBlockedReason,
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-border lg:hidden">
              {rows.map((row) => (
                <li key={row.id} className="space-y-2.5 px-3.5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <CharacterCell row={row} />
                    <StatusBadge retired={row.retired} />
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
                      <dt className="text-muted">Realm</dt>
                      <dd>
                        {row.region} · {row.realm}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-muted">Sync</dt>
                      <dd>
                        <SyncCell row={row} />
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="mb-1 text-muted">Lockouts</dt>
                      <dd>
                        <LockoutSlotsCompact slots={row.lockoutSlots} />
                      </dd>
                    </div>
                  </dl>
                  <div className="relative">
                    <ManageCharacterRowActions
                      row={{
                        id: row.id,
                        name: row.name,
                        realm: row.realm,
                        cooldownRemainingMs: row.cooldownRemainingMs,
                        ineligibleCopy: row.syncIneligibleReason
                          ? SYNC_INELIGIBLE_COPY[row.syncIneligibleReason]
                          : null,
                        deleteBlockedReason: row.deleteBlockedReason,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </PageWorkspace>
  );
}
