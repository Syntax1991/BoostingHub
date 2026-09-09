import Link from "next/link";
import { formatDateTime } from "@/lib/datetime";
import {
  ACCESS_STATUS_LABELS,
  CHARACTER_ROLE_LABELS,
  CLASS_LABELS,
  DIFFICULTY_LABELS,
  REGION_LABELS,
} from "@/lib/labels";
import { CHARACTER_ROLES, RAID_DIFFICULTIES } from "@/models/enums";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { AccessBadge, ClassBadge, DifficultyBadge, RoleBadge } from "@/components/ui/badges";
import { ApproveBoosterAccessButton } from "@/components/manage/approve-booster-access-button";
import { BoosterAccessReviewDialog } from "@/components/manage/booster-access-review-dialog";
import type { managementController } from "@/controllers/app.controller";

type Page = Awaited<ReturnType<typeof managementController.getBoosterAccessPage>>;

const STATUS_TABS = ["PENDING", "APPROVED", "REJECTED", "REVOKED", "ALL"] as const;

export function BoosterAccessQueueView({ data }: { data: Page }) {
  const { filters, requests } = data;

  return (
    <div>
      <PageHeader
        title="Booster access"
        description="Admin review of booster eligibility. Raid leads cannot approve from this queue."
        actions={
          <Link href="/manage" className="text-sm text-accent hover:underline">
            Management
          </Link>
        }
      />
      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3 px-4 py-3" method="get">
          <input type="hidden" name="status" value={filters.status} />
          <label className="text-xs">
            <span className="mb-1 block text-muted">Difficulty</span>
            <select
              name="difficulty"
              defaultValue={filters.difficulty ?? ""}
              aria-label="Filter by difficulty"
              className="h-9 rounded-md border border-border bg-surface px-2"
            >
              <option value="">All</option>
              {RAID_DIFFICULTIES.map((difficulty) => (
                <option key={difficulty} value={difficulty}>
                  {DIFFICULTY_LABELS[difficulty]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted">Role</span>
            <select
              name="role"
              defaultValue={filters.role ?? ""}
              aria-label="Filter by role"
              className="h-9 rounded-md border border-border bg-surface px-2"
            >
              <option value="">All</option>
              {CHARACTER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {CHARACTER_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[12rem] flex-1 text-xs">
            <span className="mb-1 block text-muted">Character or user</span>
            <input
              name="query"
              defaultValue={filters.query ?? ""}
              aria-label="Search character or user"
              className="h-9 w-full rounded-md border border-border bg-surface px-2"
            />
          </label>
          <button
            type="submit"
            className="h-9 rounded-md border border-border px-3 text-xs hover:bg-surface-raised"
          >
            Filter
          </button>
        </form>
        <div className="flex flex-wrap gap-1 border-t border-border px-4 py-2">
          {STATUS_TABS.map((status) => {
            const href = new URLSearchParams();
            href.set("status", status);
            if (filters.difficulty) href.set("difficulty", filters.difficulty);
            if (filters.role) href.set("role", filters.role);
            if (filters.query) href.set("query", filters.query);
            const active = filters.status === status;
            return (
              <Link
                key={status}
                href={`/manage/booster-access?${href.toString()}`}
                className={`rounded-md px-2 py-1 text-xs ${
                  active ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-raised"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {status === "ALL" ? "All" : ACCESS_STATUS_LABELS[status]}
              </Link>
            );
          })}
        </div>
      </Card>
      <Card>
        {requests.length === 0 ? (
          <EmptyState title="No matching access rows." description="Adjust filters or wait for a new request." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">User / Character</th>
                  <th className="px-4 py-2 font-medium">Class / spec</th>
                  <th className="px-4 py-2 font-medium">Request</th>
                  <th className="px-4 py-2 font-medium">Item level</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Times</th>
                  <th className="px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((row) => (
                  <tr key={row.id} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">{row.userName}</div>
                      <div className="text-xs text-muted">
                        {row.characterName ?? "No character"}
                        {row.realm ? ` · ${row.realm}` : ""}
                        {row.region ? ` · ${REGION_LABELS[row.region]}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <ClassBadge wowClass={row.wowClass} />
                      <div className="mt-1 text-xs text-muted">
                        {row.specialization ?? CLASS_LABELS[row.wowClass]}
                        {row.primaryRole ? ` · ${CHARACTER_ROLE_LABELS[row.primaryRole]}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <RoleBadge role={row.role} />
                        <DifficultyBadge difficulty={row.difficulty} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{row.itemLevel ?? "—"}</td>
                    <td className="px-4 py-3">
                      <AccessBadge status={row.status} />
                      {row.notes ? <p className="mt-1 max-w-48 text-xs text-muted">{row.notes}</p> : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      <div>Requested {formatDateTime(row.createdAt)}</div>
                      <div>
                        Reviewed {row.reviewedAt ? formatDateTime(row.reviewedAt) : "—"}
                        {row.reviewedByName ? ` · ${row.reviewedByName}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {row.status === "PENDING" ? (
                          <>
                            <ApproveBoosterAccessButton accessId={row.id} />
                            <BoosterAccessReviewDialog accessId={row.id} mode="reject" />
                          </>
                        ) : null}
                        {row.status === "APPROVED" ? (
                          <BoosterAccessReviewDialog accessId={row.id} mode="revoke" />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
