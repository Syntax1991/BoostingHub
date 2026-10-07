import Link from "next/link";
import { formatDateTime } from "@/lib/datetime";
import { CHARACTER_ROLE_LABELS, DIFFICULTY_LABELS, ROLE_LABELS } from "@/lib/labels";
import { ACCOUNT_ROLES, ACCOUNT_STATUSES, CHARACTER_ROLES, RAID_DIFFICULTIES } from "@/models/enums";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import {
  AccountRoleBadge,
  Badge,
} from "@/components/ui/badges";
import { UserAccessDialog } from "@/components/manage/user-access-dialog";
import { PendingBoostingAccessPanel } from "@/components/manage/pending-boosting-access-panel";
import type { managementController } from "@/controllers/app.controller";

type Page = Awaited<ReturnType<typeof managementController.getUsersPage>>;
type AdminUser = Page["users"][number];

function UserIdentity({ user }: { user: AdminUser }) {
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

function BoostingAccessBadge({ isBooster }: { isBooster: boolean }) {
  if (!isBooster) {
    return <span className="text-xs text-muted">—</span>;
  }
  return <Badge className="bg-success/15 text-success">Booster</Badge>;
}

function UserActions({ user }: { user: AdminUser }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <UserAccessDialog
        userId={user.id}
        userName={user.name}
        accountRole={user.accountRole}
        isBooster={user.isBooster}
        characterRoles={user.characterRoles}
      />
      <Link
        href={`/manage/users/${user.id}`}
        className="text-sm text-accent hover:underline"
      >
        Manage
      </Link>
    </div>
  );
}

function buildHref(filters: Page["filters"], patch: Partial<Record<string, string | undefined>>) {
  const href = new URLSearchParams();
  const view = patch.view ?? filters.view;
  if (view === "boosting-access") href.set("view", "boosting-access");

  const query = patch.query !== undefined ? patch.query : filters.query;
  if (query) href.set("query", query);

  if (view === "boosting-access") {
    const difficulty = patch.difficulty !== undefined ? patch.difficulty : filters.difficulty;
    const requestedRole =
      patch.requestedRole !== undefined ? patch.requestedRole : filters.requestedRole;
    if (difficulty) href.set("difficulty", difficulty);
    if (requestedRole) href.set("requestedRole", requestedRole);
  } else {
    const role = patch.role !== undefined ? patch.role : filters.role;
    const boostingRole =
      patch.boostingRole !== undefined ? patch.boostingRole : filters.boostingRole;
    const accountStatus =
      patch.accountStatus !== undefined ? patch.accountStatus : filters.accountStatus;
    const pendingAccess =
      patch.pendingAccess !== undefined
        ? patch.pendingAccess
        : filters.pendingAccess
          ? "1"
          : undefined;
    const sort = patch.sort !== undefined ? patch.sort : filters.sort;
    if (role) href.set("role", role);
    if (boostingRole) href.set("boostingRole", boostingRole);
    if (accountStatus) href.set("accountStatus", accountStatus);
    if (pendingAccess) href.set("pendingAccess", pendingAccess);
    if (sort && sort !== "name") href.set("sort", sort);
  }

  const queryString = href.toString();
  return queryString ? `/manage/users?${queryString}` : "/manage/users";
}

export function ManageUsersView({ data }: { data: Page }) {
  const { filters, users, pendingAccessCount, pendingGroups, boostingCounts } = data;
  const isPendingView = filters.view === "boosting-access";
  const boostingRoleValue = filters.boostingRole ?? "";

  return (
    <div className="min-w-0 overflow-x-hidden">
      <PageHeader
        title="Users"
        description="Account directory, platform roles, booster access, and pending boosting-access review."
        actions={
          <Link href="/manage" className="text-sm text-accent hover:underline">
            Management
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href={buildHref(filters, { view: "users" })}
          className={`rounded-md px-3 py-1.5 text-sm ${
            !isPendingView ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-raised"
          }`}
          aria-current={!isPendingView ? "page" : undefined}
        >
          All Users · {boostingCounts.boosters} Boosters
        </Link>
        <Link
          href={buildHref(filters, { view: "boosting-access" })}
          className={`rounded-md px-3 py-1.5 text-sm ${
            isPendingView ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-raised"
          }`}
          aria-current={isPendingView ? "page" : undefined}
        >
          Pending Boosting Access
          {pendingAccessCount > 0 ? ` · ${pendingAccessCount}` : ""}
        </Link>
      </div>

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3 px-4 py-3" method="get">
          {isPendingView ? <input type="hidden" name="view" value="boosting-access" /> : null}
          {isPendingView ? (
            <>
              <label className="text-xs">
                <span className="mb-1 block text-muted">Requested difficulty</span>
                <select
                  name="difficulty"
                  defaultValue={filters.difficulty ?? ""}
                  aria-label="Filter by requested difficulty"
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
                <span className="mb-1 block text-muted">Requested role</span>
                <select
                  name="requestedRole"
                  defaultValue={filters.requestedRole ?? ""}
                  aria-label="Filter by requested role"
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
            </>
          ) : (
            <>
              <label className="text-xs">
                <span className="mb-1 block text-muted">Platform role</span>
                <select
                  name="role"
                  defaultValue={filters.role ?? ""}
                  aria-label="Filter by platform role"
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
                <span className="mb-1 block text-muted">Account status</span>
                <select
                  name="accountStatus"
                  defaultValue={filters.accountStatus ?? ""}
                  aria-label="Filter by account status"
                  className="h-9 rounded-md border border-border bg-surface px-2"
                >
                  <option value="">All</option>
                  {ACCOUNT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status === "ACTIVE" ? "Active" : "Disabled"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-muted">Booster status</span>
                <select
                  name="boostingRole"
                  defaultValue={boostingRoleValue}
                  aria-label="Filter by booster status"
                  className="h-9 rounded-md border border-border bg-surface px-2"
                >
                  <option value="">Any</option>
                  <option value="BOOSTER">Booster</option>
                  <option value="LOOTBUDDY">Lootbuddy</option>
                  <option value="NONE">Neither</option>
                </select>
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-muted">Pending access</span>
                <select
                  name="pendingAccess"
                  defaultValue={filters.pendingAccess ? "1" : ""}
                  aria-label="Filter by pending access"
                  className="h-9 rounded-md border border-border bg-surface px-2"
                >
                  <option value="">Any</option>
                  <option value="1">Has pending</option>
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
            </>
          )}
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
          <button
            type="submit"
            className="h-9 rounded-md border border-border px-3 text-xs hover:bg-surface-raised"
          >
            Filter
          </button>
        </form>
      </Card>

      <Card>
        {isPendingView ? (
          <PendingBoostingAccessPanel groups={pendingGroups} />
        ) : users.length === 0 ? (
          <EmptyState title="No users found." description="Adjust filters or wait for new sign-ins." />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">User</th>
                    <th className="px-4 py-2 font-medium">Platform Role</th>
                    <th className="px-4 py-2 font-medium">Boosting Access</th>
                    <th className="px-4 py-2 font-medium">Account Status</th>
                    <th className="px-4 py-2 font-medium">Characters</th>
                    <th className="px-4 py-2 font-medium">Pending</th>
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
                      <td className="px-4 py-3">
                        <BoostingAccessBadge isBooster={user.isBooster} />
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span
                          className={
                            user.accountStatus === "ACTIVE" ? "text-success" : "text-muted"
                          }
                        >
                          {user.accountStatus === "ACTIVE" ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted">{user.characterCount}</td>
                      <td className="px-4 py-3 tabular-nums text-muted">
                        {user.pendingAccessCount > 0 ? user.pendingAccessCount : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <UserActions user={user} />
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
                    <UserActions user={user} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-muted">Platform Role</dt>
                      <dd className="mt-1">
                        <AccountRoleBadge role={user.accountRole} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Boosting Access</dt>
                      <dd className="mt-1">
                        <BoostingAccessBadge isBooster={user.isBooster} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Status</dt>
                      <dd className="mt-0.5">
                        {user.accountStatus === "ACTIVE" ? "Active" : "Disabled"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Characters</dt>
                      <dd className="mt-0.5 tabular-nums">{user.characterCount}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Pending</dt>
                      <dd className="mt-0.5 tabular-nums">
                        {user.pendingAccessCount > 0 ? user.pendingAccessCount : "—"}
                      </dd>
                    </div>
                    <div>
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
