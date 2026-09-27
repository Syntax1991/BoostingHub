import Link from "next/link";
import { hasOwnerAccess } from "@/auth/authorization";
import { formatDateTime } from "@/lib/datetime";
import { ROLE_LABELS, REGION_LABELS } from "@/lib/labels";
import { formatCompactMultiRaidLockoutProgress } from "@/lib/lockout-display";
import type { AccountRole, BoostingRole, CharacterRole, WowClass, WowRegion } from "@/models/enums";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { AccountRoleBadge, ClassBadge, RoleBadge } from "@/components/ui/badges";
import { AccountRoleAction } from "@/components/manage/account-role-action";
import { BoostingRoleControl } from "@/components/manage/boosting-role-control";
import { AddStrikeDialog } from "@/components/manage/add-strike-dialog";
import { RevokeStrikeDialog } from "@/components/manage/revoke-strike-dialog";
import type { managementController } from "@/controllers/app.controller";

type Page = Awaited<ReturnType<typeof managementController.getUserDetailPage>>;

function asWowClass(value: string): WowClass {
  return value as WowClass;
}

function asCharacterRole(value: string): CharacterRole {
  return value as CharacterRole;
}

function asRegion(value: string): WowRegion {
  return value as WowRegion;
}

export function ManageUserDetailView({ data }: { data: Page }) {
  const { user, characters, boostingRoles, audit, strikes, currentLockoutRaids } = data;
  const roleRows: Array<{ role: BoostingRole; label: string; enabled: boolean; description: string }> = [
    {
      role: "BOOSTER",
      label: "Booster",
      enabled: boostingRoles.isBooster,
      description: "May sign up and be rostered as a Booster on Normal, Heroic and Mythic runs.",
    },
    {
      role: "LOOTBUDDY",
      label: "Lootbuddy",
      enabled: boostingRoles.isLootbuddy,
      description: "Recognised Lootbuddy. Lootbuddy signups are not gated by this role.",
    },
  ];
  const activeStrikes = strikes.filter((row) => row.status === "ACTIVE").length;
  const lockoutRaidLabel = currentLockoutRaids?.length
    ? currentLockoutRaids.map((raid) => raid.name).join(" · ")
    : null;

  return (
    <div className="min-w-0 overflow-x-hidden">
      <PageHeader
        title={user.name}
        description={
          user.discordUsername
            ? `@${user.discordUsername} · account administration`
            : "Account administration"
        }
        actions={
          <Link href="/manage/users" className="text-sm text-accent hover:underline">
            All users
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Overview" />
          <dl className="grid grid-cols-2 gap-3 px-4 py-4 text-sm">
            <div className="col-span-2 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-surface-raised text-sm font-semibold">
                {user.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.image} alt="" className="h-full w-full object-cover" />
                ) : (
                  user.name.slice(0, 2).toUpperCase()
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted">
                  {user.discordUsername ? `@${user.discordUsername}` : "No Discord"}
                </p>
              </div>
            </div>
            <div>
              <dt className="text-muted">Status</dt>
              <dd className="mt-1">{user.accountStatus}</dd>
            </div>
            <div>
              <dt className="text-muted">Joined</dt>
              <dd className="mt-1 text-xs">{formatDateTime(user.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-muted">Email</dt>
              <dd className="mt-1 truncate text-xs">{user.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Discord ID</dt>
              <dd className="mt-1 truncate text-xs">{user.discordUserId ?? "—"}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardHeader
            title="Account role"
            description={`${ROLE_LABELS[user.accountRole]} · platform permissions only.`}
            action={
              <AccountRoleAction
                userId={user.id}
                userName={user.name}
                accountRole={user.accountRole as AccountRole}
              />
            }
          />
          <div className="px-4 py-4">
            <AccountRoleBadge role={user.accountRole} />
            {hasOwnerAccess(user.accountRole) ? (
              <p className="mt-3 text-xs text-muted">
                The Platform Owner has every Admin permission and cannot be changed through role management.
              </p>
            ) : null}
            <p className="mt-3 text-xs text-muted">
              Booster and Lootbuddy are Boosting Roles, managed separately — never account roles.
            </p>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Boosting roles"
            description="Operational participation, independent of the account role and of each other. Not scoped by raid difficulty."
          />
          <ul className="divide-y divide-border">
            {roleRows.map((row) => (
              <li
                key={row.role}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {row.label}
                    <span className={row.enabled ? "text-xs text-success" : "text-xs text-muted"}>
                      {row.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </p>
                  <p className="text-xs text-muted">{row.description}</p>
                </div>
                <BoostingRoleControl
                  userId={user.id}
                  userName={user.name}
                  role={row.role}
                  enabled={row.enabled}
                />
              </li>
            ))}
          </ul>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Characters"
            description={
              characters.length === 0
                ? "No characters on this account."
                : `${characters.length} on this account${
                    lockoutRaidLabel ? ` · current lockouts (${lockoutRaidLabel})` : ""
                  }`
            }
          />
          {characters.length === 0 ? (
            <EmptyState title="No characters." description="This user has not added characters yet." />
          ) : (
            <ul className="divide-y divide-border">
              {characters.map((character) => (
                <li key={character.id} className="space-y-2 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{character.name}</p>
                      <p className="text-xs text-muted">
                        {character.realm} · {REGION_LABELS[asRegion(character.region)]}
                        {character.isActive ? "" : " · inactive"}
                        {character.blizzardLinked ? " · Battle.net" : ""}
                        {" · "}
                        {character.currentReset}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <ClassBadge wowClass={asWowClass(character.wowClass)} />
                      <RoleBadge role={asCharacterRole(character.primaryRole)} />
                      <span className="text-xs text-muted">
                        {character.specialization} · ilvl{" "}
                        {typeof character.itemLevel === "number" ? character.itemLevel : "Unknown"}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted">
                    <span className="font-medium text-foreground">Lockouts: </span>
                    {formatCompactMultiRaidLockoutProgress(
                      character.lockouts,
                      currentLockoutRaids ?? [],
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Strikes"
            description={
              strikes.length === 0
                ? "No disciplinary history."
                : `${activeStrikes} active${strikes.length - activeStrikes > 0 ? ` · ${strikes.length - activeStrikes} revoked` : ""}`
            }
            action={<AddStrikeDialog userId={user.id} userName={user.name} />}
          />
          {strikes.length === 0 ? (
            <EmptyState title="No strikes." description="Disciplinary history will appear here." />
          ) : (
            <ul className="divide-y divide-border">
              {strikes.map((strike) => (
                <li key={strike.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{strike.reason}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          strike.status === "ACTIVE" ? "bg-warning/15 text-warning" : "bg-surface-raised text-muted"
                        }`}
                      >
                        {strike.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {strike.runTitle ? `${strike.runTitle} · ` : ""}
                      Added by {strike.createdByName} · {formatDateTime(strike.createdAt)}
                    </p>
                    {strike.notes ? <p className="mt-1 text-xs text-muted">{strike.notes}</p> : null}
                    {strike.status === "REVOKED" ? (
                      <p className="mt-1 text-xs text-muted">
                        Revoked by {strike.revokedByName ?? "Unknown"}
                        {strike.revokedAt ? ` · ${formatDateTime(strike.revokedAt)}` : ""}
                        {strike.revokedReason ? ` · ${strike.revokedReason}` : ""}
                      </p>
                    ) : null}
                  </div>
                  {strike.status === "ACTIVE" ? <RevokeStrikeDialog strikeId={strike.id} /> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Audit" description="Recent activity involving this account." />
          {audit.length === 0 ? (
            <EmptyState title="No audit events." description="Role changes and related activity will appear here." />
          ) : (
            <ul className="divide-y divide-border">
              {audit.map((event) => (
                <li key={event.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{event.type}</span>
                    <span className="text-xs text-muted">{formatDateTime(event.occurredAt)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{event.message}</p>
                  {event.actorName ? (
                    <p className="mt-1 text-[11px] text-muted">By {event.actorName}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
