import Link from "next/link";
import { formatDateTime } from "@/lib/datetime";
import {
  ACCESS_STATUS_LABELS,
  CHARACTER_ROLE_LABELS,
  DIFFICULTY_LABELS,
} from "@/lib/labels";
import { CHARACTER_ROLES, RAID_DIFFICULTIES } from "@/models/enums";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { AccessBadge, ClassBadge, DifficultyBadge, RoleBadge } from "@/components/ui/badges";
import { ApproveBoosterAccessButton } from "@/components/manage/approve-booster-access-button";
import { BoosterAccessReviewDialog } from "@/components/manage/booster-access-review-dialog";
import { GrantBoosterAccessDialog } from "@/components/manage/grant-booster-access-dialog";
import type { managementController } from "@/controllers/app.controller";
import type { QualificationStatusFilter } from "@/validators/booster-access-filters";

type Page = Awaited<ReturnType<typeof managementController.getBoosterAccessPage>>;

const QUALIFICATION_TABS: QualificationStatusFilter[] = ["ALL", "APPROVED", "REVOKED"];

function buildHref(
  filters: Page["filters"],
  patch: Partial<{ view: string; status: string }>,
) {
  const href = new URLSearchParams();
  const view = patch.view ?? filters.view;
  href.set("view", view);
  if (view === "qualifications") {
    const status = patch.status ?? (filters.status === "PENDING" ? "ALL" : filters.status);
    if (status && status !== "PENDING") href.set("status", status);
  }
  if (filters.difficulty) href.set("difficulty", filters.difficulty);
  if (view === "legacy" && filters.role) href.set("role", filters.role);
  if (filters.query) href.set("query", filters.query);
  if (filters.userId) href.set("userId", filters.userId);
  return `/manage/booster-access?${href.toString()}`;
}

function historicalContext(row: Page["legacyRequests"][number]): string | null {
  if (!row.characterName) return null;
  const realm = row.realm ? `-${row.realm}` : "";
  return `Requested via ${row.characterName}${realm}`;
}

export function BoosterAccessQueueView({ data }: { data: Page }) {
  const {
    filters,
    qualifications,
    legacyRequests,
    grantUsers,
    legacyPendingCount,
    view,
  } = data;
  const isLegacy = view === "legacy";

  return (
    <div className="min-w-0 overflow-x-hidden">
      <PageHeader
        title="Booster access"
        description="Grant account qualifications after Discord review. Resolve historical in-app PENDING rows from Legacy Requests."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <GrantBoosterAccessDialog users={grantUsers} defaultUserId={filters.userId} />
            <Link href="/manage" className="text-sm text-accent hover:underline">
              Management
            </Link>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href={buildHref(filters, { view: "qualifications", status: "ALL" })}
          className={`rounded-md px-3 py-1.5 text-sm ${
            !isLegacy ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-raised"
          }`}
          aria-current={!isLegacy ? "page" : undefined}
        >
          Qualifications
        </Link>
        <Link
          href={buildHref(filters, { view: "legacy" })}
          className={`rounded-md px-3 py-1.5 text-sm ${
            isLegacy ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-raised"
          }`}
          aria-current={isLegacy ? "page" : undefined}
        >
          Legacy Requests · {legacyPendingCount}
        </Link>
      </div>

      {isLegacy ? (
        <p className="mb-4 text-sm text-muted">
          These applications used the previous character/class workflow. Approving one grants
          account-wide access for that difficulty.
        </p>
      ) : null}

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3 px-4 py-3" method="get">
          <input type="hidden" name="view" value={view} />
          {!isLegacy ? (
            <input
              type="hidden"
              name="status"
              value={filters.status === "PENDING" ? "ALL" : filters.status}
            />
          ) : null}
          {filters.userId ? <input type="hidden" name="userId" value={filters.userId} /> : null}
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
          {isLegacy ? (
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
          ) : null}
          <label className="min-w-[12rem] flex-1 text-xs">
            <span className="mb-1 block text-muted">User</span>
            <input
              name="query"
              defaultValue={filters.query ?? ""}
              aria-label="Search user"
              placeholder="Name"
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
        {!isLegacy ? (
          <div className="flex flex-wrap gap-1 border-t border-border px-4 py-2">
            {QUALIFICATION_TABS.map((status) => {
              const active =
                status === "ALL"
                  ? filters.status === "ALL" || filters.status === "PENDING"
                  : filters.status === status;
              return (
                <Link
                  key={status}
                  href={buildHref(filters, { view: "qualifications", status })}
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
        ) : null}
      </Card>

      <Card>
        {isLegacy ? (
          legacyRequests.length === 0 ? (
            <EmptyState
              title="No legacy requests awaiting review."
              description="Historical in-app PENDING applications appear here. New applications go through Discord."
            />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-4 py-2 font-medium">User</th>
                      <th className="px-4 py-2 font-medium">Class</th>
                      <th className="px-4 py-2 font-medium">Role</th>
                      <th className="px-4 py-2 font-medium">Difficulty</th>
                      <th className="px-4 py-2 font-medium">Requested via</th>
                      <th className="px-4 py-2 font-medium">Requested at</th>
                      <th className="px-4 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {legacyRequests.map((row) => (
                      <tr key={row.id} className="border-t border-border align-top">
                        <td className="px-4 py-3 font-medium">{row.userName}</td>
                        <td className="px-4 py-3">
                          <ClassBadge wowClass={row.wowClass} />
                        </td>
                        <td className="px-4 py-3">
                          <RoleBadge role={row.role} />
                        </td>
                        <td className="px-4 py-3">
                          <DifficultyBadge difficulty={row.difficulty} />
                        </td>
                        <td className="px-4 py-3 text-xs text-muted">
                          {historicalContext(row) ?? "No character context"}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted">{formatDateTime(row.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <ApproveBoosterAccessButton accessId={row.id} />
                            <BoosterAccessReviewDialog accessId={row.id} mode="reject" />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-border md:hidden">
                {legacyRequests.map((row) => (
                  <li key={row.id} className="space-y-2 px-4 py-3 text-sm">
                    <div className="font-medium">{row.userName}</div>
                    <div className="flex flex-wrap gap-2">
                      <ClassBadge wowClass={row.wowClass} />
                      <RoleBadge role={row.role} />
                      <DifficultyBadge difficulty={row.difficulty} />
                    </div>
                    <p className="text-xs text-muted">{historicalContext(row) ?? "No character context"}</p>
                    <p className="text-xs text-muted">Requested {formatDateTime(row.createdAt)}</p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <ApproveBoosterAccessButton accessId={row.id} />
                      <BoosterAccessReviewDialog accessId={row.id} mode="reject" />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )
        ) : qualifications.length === 0 ? (
          <EmptyState
            title="No matching qualifications."
            description="Grant access after Discord review, or adjust filters."
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">User</th>
                    <th className="px-4 py-2 font-medium">Difficulty</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Granted by</th>
                    <th className="px-4 py-2 font-medium">Times</th>
                    <th className="px-4 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {qualifications.map((row) => (
                    <tr key={row.id} className="border-t border-border align-top">
                      <td className="px-4 py-3 font-medium">{row.userName}</td>
                      <td className="px-4 py-3">
                        <DifficultyBadge difficulty={row.difficulty} />
                      </td>
                      <td className="px-4 py-3">
                        <AccessBadge status={row.status} />
                        {row.notes ? <p className="mt-1 max-w-48 text-xs text-muted">{row.notes}</p> : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">{row.grantedByName ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted">
                        <div>Created {formatDateTime(row.createdAt)}</div>
                        <div>Granted {row.grantedAt ? formatDateTime(row.grantedAt) : "—"}</div>
                      </td>
                      <td className="px-4 py-3">
                        {row.status === "APPROVED" ? (
                          <BoosterAccessReviewDialog qualificationId={row.id} mode="revoke" />
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-border md:hidden">
              {qualifications.map((row) => (
                <li key={row.id} className="space-y-2 px-4 py-3 text-sm">
                  <div className="font-medium">{row.userName}</div>
                  <div className="flex flex-wrap gap-2">
                    <DifficultyBadge difficulty={row.difficulty} />
                    <AccessBadge status={row.status} />
                  </div>
                  <p className="text-xs text-muted">
                    Granted {row.grantedAt ? formatDateTime(row.grantedAt) : "—"}
                    {row.grantedByName ? ` · ${row.grantedByName}` : ""}
                  </p>
                  {row.notes ? <p className="text-xs text-muted">{row.notes}</p> : null}
                  {row.status === "APPROVED" ? (
                    <div className="pt-1">
                      <BoosterAccessReviewDialog qualificationId={row.id} mode="revoke" />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
