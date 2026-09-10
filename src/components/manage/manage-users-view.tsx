import Link from "next/link";
import { formatDateTime } from "@/lib/datetime";
import { ROLE_LABELS } from "@/lib/labels";
import { ACCOUNT_ROLES } from "@/models/enums";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { AccountRoleBadge } from "@/components/ui/badges";
import type { managementController } from "@/controllers/app.controller";

type Page = Awaited<ReturnType<typeof managementController.getUsersPage>>;

function accessSummary(user: Page["users"][number]): string {
  const { approvedAccessCount: approved, revokedAccessCount: revoked } = user;
  if (approved === 0 && revoked === 0) return "None";
  if (revoked === 0) return `${approved} approved`;
  return `${approved} approved · ${revoked} revoked`;
}

function UserIdentity({ user }: { user: Page["users"][number] }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-raised text-xs font-semibold">
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" className="h-full w-full object-cover" />
        ) : (
          user.name.slice(0, 2).toUpperCase()
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate font-medium">{user.name}</div>
        <div className="truncate text-xs text-muted">
          {user.discordUsername ? `@${user.discordUsername}` : "No Discord"}
        </div>
      </div>
    </div>
  );
}

export function ManageUsersView({ data }: { data: Page }) {
  const { filters, users } = data;
  const accessValue =
    filters.access === "approved" || filters.access === "none" ? filters.access : "";

  return (
    <div className="min-w-0 overflow-x-hidden">
      <PageHeader
        title="Users"
        description="Account directory, roles, and booster access summaries."
        actions={
          <Link href="/manage" className="text-sm text-accent hover:underline">
            Management
          </Link>
        }
      />
      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3 px-4 py-3" method="get">
          <label className="min-w-[12rem] flex-1 text-xs">
            <span className="mb-1 block text-muted">Search</span>
            <input
              name="query"
              defaultValue={filters.query ?? ""}
              aria-label="Search users"
              placeholder="Name or Discord"
              className="h-9 w-full rounded-md border border-border bg-surface px-2"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted">Role</span>
            <select
              name="role"
              defaultValue={filters.role ?? ""}
              aria-label="Filter by account role"
              className="h-9 rounded-md border border-border bg-surface px-2"
            >
              <option value="">All</option>
              {ACCOUNT_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted">Access</span>
            <select
              name="access"
              defaultValue={accessValue}
              aria-label="Filter by booster access"
              className="h-9 rounded-md border border-border bg-surface px-2"
            >
              <option value="">Any</option>
              <option value="approved">Approved</option>
              <option value="none">None</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted">Sort</span>
            <select
              name="sort"
              defaultValue={filters.sort}
              aria-label="Sort users"
              className="h-9 rounded-md border border-border bg-surface px-2"
            >
              <option value="name">Name</option>
              <option value="joined_desc">Joined (newest)</option>
              <option value="joined_asc">Joined (oldest)</option>
              <option value="role">Role</option>
            </select>
          </label>
          <button
            type="submit"
            className="h-9 rounded-md border border-border px-3 text-xs hover:bg-surface-raised"
          >
            Filter
          </button>
        </form>
      </Card>
      <Card>
        {users.length === 0 ? (
          <EmptyState title="No users found." description="Adjust filters or wait for new sign-ins." />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">User</th>
                    <th className="px-4 py-2 font-medium">Account role</th>
                    <th className="px-4 py-2 font-medium">Characters</th>
                    <th className="px-4 py-2 font-medium">Booster access</th>
                    <th className="px-4 py-2 font-medium">Joined</th>
                    <th className="px-4 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-t border-border align-middle">
                      <td className="px-4 py-3">
                        <UserIdentity user={user} />
                      </td>
                      <td className="px-4 py-3">
                        <AccountRoleBadge role={user.accountRole} />
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted">{user.characterCount}</td>
                      <td className="px-4 py-3 text-muted">{accessSummary(user)}</td>
                      <td className="px-4 py-3 text-xs text-muted">{formatDateTime(user.createdAt)}</td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/manage/users/${user.id}`}
                          className="text-sm text-accent hover:underline"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-border md:hidden">
              {users.map((user) => (
                <li key={user.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <UserIdentity user={user} />
                    <Link
                      href={`/manage/users/${user.id}`}
                      className="shrink-0 text-sm text-accent hover:underline"
                    >
                      View
                    </Link>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-muted">Role</dt>
                      <dd className="mt-0.5">
                        <AccountRoleBadge role={user.accountRole} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Characters</dt>
                      <dd className="mt-0.5 tabular-nums">{user.characterCount}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-muted">Booster access</dt>
                      <dd className="mt-0.5">{accessSummary(user)}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-muted">Joined</dt>
                      <dd className="mt-0.5">{formatDateTime(user.createdAt)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
