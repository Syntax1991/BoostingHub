import Link from "next/link";
import { formatDateTime } from "@/lib/datetime";
import { CHARACTER_ROLE_LABELS, DIFFICULTY_LABELS } from "@/lib/labels";
import { CHARACTER_ROLES, RAID_DIFFICULTIES } from "@/models/enums";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { AccountRoleBadge, ClassBadge, DifficultyBadge, RoleBadge } from "@/components/ui/badges";
import { ApproveBoosterAccessButton } from "@/components/manage/approve-booster-access-button";
import { BoosterAccessReviewDialog } from "@/components/manage/booster-access-review-dialog";
import { BoostingRoleControl } from "@/components/manage/boosting-role-control";
import type { managementController } from "@/controllers/app.controller";
import type { BoostingRoleFilter } from "@/validators/boosting-roles";

type Page = Awaited<ReturnType<typeof managementController.getBoostingRolesPage>>;

const ROLE_TABS: Array<{ value: BoostingRoleFilter; label: string }> = [
  { value: "ALL", label: "All users" },
  { value: "BOOSTER", label: "Boosters" },
  { value: "LOOTBUDDY", label: "Lootbuddies" },
  { value: "NONE", label: "Neither" },
];

function buildHref(filters: Page["filters"], patch: Partial<{ view: string; role: string }>) {
  const href = new URLSearchParams();
  const view = patch.view ?? filters.view;
  if (view === "legacy") href.set("view", "legacy");
  if (view === "roles") {
    const role = patch.role ?? filters.role;
    if (role !== "ALL") href.set("role", role);
  }
  // Difficulty / requested role filter historical requests only — Boosting Roles have no difficulty.
  if (view === "legacy" && filters.difficulty) href.set("difficulty", filters.difficulty);
  if (view === "legacy" && filters.requestedRole) href.set("requestedRole", filters.requestedRole);
  if (filters.query) href.set("query", filters.query);
  const query = href.toString();
  return query ? `/manage/boosting-roles?${query}` : "/manage/boosting-roles";
}

function historicalContext(row: Page["legacyRequests"][number]): string | null {
  if (!row.characterName) return null;
  const realm = row.realm ? `-${row.realm}` : "";
  return `Requested via ${row.characterName}${realm}`;
}

function RoleCell({
  user,
  role,
}: {
  user: Page["users"][number];
  role: "BOOSTER" | "LOOTBUDDY";
}) {
  const enabled = role === "BOOSTER" ? user.isBooster : user.isLootbuddy;
  return (
    <div className="flex items-center gap-2">
      <span className={enabled ? "w-16 text-xs text-success" : "w-16 text-xs text-muted"}>
        {enabled ? "Enabled" : "Disabled"}
      </span>
      <BoostingRoleControl userId={user.id} userName={user.name} role={role} enabled={enabled} />
    </div>
  );
}

export function BoostingRolesView({ data }: { data: Page }) {
  const { filters, users, legacyRequests, legacyPendingCount, counts } = data;
  const isLegacy = filters.view === "legacy";

  return (
    <div className="min-w-0 overflow-x-hidden">
      <PageHeader
        title="Boosting Roles"
        description="Grant or revoke the Booster and Lootbuddy roles after Discord review. Each role is independent of the other and of the account role, and Booster covers every raid difficulty."
        actions={
          <Link href="/manage" className="text-sm text-accent hover:underline">
            Management
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href={buildHref(filters, { view: "roles", role: "ALL" })}
          className={`rounded-md px-3 py-1.5 text-sm ${
            !isLegacy ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-raised"
          }`}
          aria-current={!isLegacy ? "page" : undefined}
        >
          Roles · {counts.boosters} Boosters · {counts.lootbuddies} Lootbuddies
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
          Historical in-app applications from the previous character/class/difficulty workflow. They
          are history only; approving one grants the account-level Booster role (all difficulties).
        </p>
      ) : null}

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3 px-4 py-3" method="get">
          {isLegacy ? <input type="hidden" name="view" value="legacy" /> : null}
          {!isLegacy && filters.role !== "ALL" ? <input type="hidden" name="role" value={filters.role} /> : null}
          {isLegacy ? (
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
          ) : null}
          {isLegacy ? (
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
          ) : null}
          <label className="min-w-[12rem] flex-1 text-xs">
            <span className="mb-1 block text-muted">User</span>
            <input
              name="query"
              defaultValue={filters.query ?? ""}
              aria-label="Search user"
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
        {!isLegacy ? (
          <div className="flex flex-wrap gap-1 border-t border-border px-4 py-2">
            {ROLE_TABS.map((tab) => {
              const active = filters.role === tab.value;
              return (
                <Link
                  key={tab.value}
                  href={buildHref(filters, { view: "roles", role: tab.value })}
                  className={`rounded-md px-2 py-1 text-xs ${
                    active ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-raised"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  {tab.label}
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
                      <th className="px-4 py-2 font-medium">Requested difficulty</th>
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
                            <BoosterAccessReviewDialog accessId={row.id} />
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
                      <BoosterAccessReviewDialog accessId={row.id} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )
        ) : users.length === 0 ? (
          <EmptyState title="No matching users." description="Adjust the filters or search." />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">User</th>
                    <th className="px-4 py-2 font-medium">Account role</th>
                    <th className="px-4 py-2 font-medium">Booster</th>
                    <th className="px-4 py-2 font-medium">Lootbuddy</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-t border-border align-middle">
                      <td className="px-4 py-3">
                        <Link href={`/manage/users/${user.id}`} className="font-medium hover:underline">
                          {user.name}
                        </Link>
                        <div className="text-xs text-muted">
                          {user.discordUsername ? `@${user.discordUsername}` : "No Discord"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <AccountRoleBadge role={user.accountRole} />
                      </td>
                      <td className="px-4 py-3">
                        <RoleCell user={user} role="BOOSTER" />
                      </td>
                      <td className="px-4 py-3">
                        <RoleCell user={user} role="LOOTBUDDY" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-border md:hidden">
              {users.map((user) => (
                <li key={user.id} className="space-y-3 px-4 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/manage/users/${user.id}`} className="font-medium hover:underline">
                        {user.name}
                      </Link>
                      <div className="truncate text-xs text-muted">
                        {user.discordUsername ? `@${user.discordUsername}` : "No Discord"}
                      </div>
                    </div>
                    <AccountRoleBadge role={user.accountRole} />
                  </div>
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted">Booster</span>
                      <RoleCell user={user} role="BOOSTER" />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted">Lootbuddy</span>
                      <RoleCell user={user} role="LOOTBUDDY" />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
