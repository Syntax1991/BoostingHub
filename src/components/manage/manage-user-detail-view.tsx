import Link from "next/link";
import { hasOwnerAccess } from "@/auth/authorization";
import { formatDateTime } from "@/lib/datetime";
import {
  CHARACTER_ROLE_LABELS,
  DIFFICULTY_LABELS,
  ROLE_LABELS,
  REGION_LABELS,
} from "@/lib/labels";
import { formatCompactMultiRaidLockoutProgress } from "@/lib/lockout-display";
import type { AccountRole, BoostingRole, CharacterRole, WowClass, WowRegion } from "@/models/enums";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import {
  AccountRoleBadge,
  ClassBadge,
  DifficultyBadge,
  RoleBadge,
} from "@/components/ui/badges";
import { AccountRoleAction } from "@/components/manage/account-role-action";
import { ApproveBoosterAccessButton } from "@/components/manage/approve-booster-access-button";
import { BoosterAccessReviewDialog } from "@/components/manage/booster-access-review-dialog";
import { BoostingRoleControl } from "@/components/manage/boosting-role-control";
import { AddStrikeDialog } from "@/components/manage/add-strike-dialog";
import { RevokeStrikeDialog } from "@/components/manage/revoke-strike-dialog";
import {
  boosterAccessSourceLabel,
  hasEffectiveBoosterAccess,
  hasEffectiveLootbuddyAccess,
  lootbuddyAccessSourceLabel,
} from "@/services/boosting-role.service";
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
  const {
    user,
    characters,
    boostingRoles,
    audit,
    strikes,
    currentLockoutRaids,
    pendingAccess,
  } = data;
  const boosterGrant = hasEffectiveBoosterAccess(boostingRoles);
  const lootbuddyGrant = hasEffectiveLootbuddyAccess(boostingRoles);
  const roleRows: Array<{
    role: BoostingRole;
    label: string;
    manual: boolean;
    grant: ReturnType<typeof hasEffectiveBoosterAccess>;
    sourceLabel: string | null;
    description: string;
  }> = [
    {
      role: "BOOSTER",
      label: "Raid Booster Access",
      manual: boostingRoles.isBooster,
      grant: boosterGrant,
      sourceLabel: boosterAccessSourceLabel(boosterGrant),
      description: "May sign up and be rostered as a Booster on Normal, Heroic and Mythic runs.",
    },
    {
      role: "LOOTBUDDY",
      label: "Lootbuddy Access",
      manual: boostingRoles.isLootbuddy,
      grant: lootbuddyGrant,
      sourceLabel: lootbuddyAccessSourceLabel(lootbuddyGrant),
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
          <CardHeader
            title="Account"
            description="Identity and account status."
          />
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
              <dd className="mt-1">
                {user.accountStatus === "ACTIVE" ? "Active" : "Disabled"}
              </dd>
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
            title="Platform access"
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
            title="Boosting access"
            description="Manual grants and Discord-derived access are independent. Effective access is Manual or Discord for each capability."
          />
          <ul className="divide-y divide-border">
            {roleRows.map((row) => (
              <li
                key={row.role}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium">{row.label}</p>
                  <p className="text-xs text-muted">{row.description}</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                    <dt className="text-muted">Manual</dt>
                    <dd>{row.manual ? "On" : "Off"}</dd>
                    <dt className="text-muted">Effective</dt>
                    <dd className={row.grant.granted ? "text-success" : "text-muted"}>
                      {row.grant.granted ? "Granted" : "Not granted"}
                    </dd>
                    <dt className="text-muted">Source</dt>
                    <dd>{row.sourceLabel ?? "—"}</dd>
                  </dl>
                </div>
                <BoostingRoleControl
                  userId={user.id}
                  userName={user.name}
                  role={row.role}
                  enabled={row.manual}
                />
              </li>
            ))}
          </ul>
          {pendingAccess.length > 0 ? (
            <div className="border-t border-border px-4 py-4">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
                Pending requests · {pendingAccess.length}
              </h3>
              <ul className="mt-3 space-y-3">
                {pendingAccess.map((row) => {
                  const character = row.characterName
                    ? `${row.characterName}${row.realm ? `-${row.realm}` : ""}`
                    : null;
                  const line = character
                    ? `${character} · ${CHARACTER_ROLE_LABELS[row.role]} · ${DIFFICULTY_LABELS[row.difficulty]}`
                    : `${CHARACTER_ROLE_LABELS[row.role]} · ${DIFFICULTY_LABELS[row.difficulty]}`;
                  return (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border px-3 py-3 text-sm"
                    >
                      <div className="min-w-0 space-y-2">
                        <p className="font-medium">{line}</p>
                        <div className="flex flex-wrap gap-2">
                          <ClassBadge wowClass={row.wowClass} />
                          <RoleBadge role={row.role} />
                          <DifficultyBadge difficulty={row.difficulty} />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <ApproveBoosterAccessButton accessId={row.id} />
                        <BoosterAccessReviewDialog accessId={row.id} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
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
