import Link from "next/link";
import { formatDateTime } from "@/lib/datetime";
import { ROLE_LABELS } from "@/lib/labels";
import type {
  AccountRole,
  BoosterAccessStatus,
  CharacterRole,
  RaidDifficulty,
  WowClass,
} from "@/models/enums";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import {
  AccessBadge,
  AccountRoleBadge,
  ClassBadge,
  DifficultyBadge,
  RoleBadge,
} from "@/components/ui/badges";
import { ChangeAccountRoleDialog } from "@/components/manage/change-account-role-dialog";
import { GrantBoosterAccessDialog } from "@/components/manage/grant-booster-access-dialog";
import type { managementController } from "@/controllers/app.controller";

type Page = Awaited<ReturnType<typeof managementController.getUserDetailPage>>;

function asWowClass(value: string): WowClass {
  return value as WowClass;
}

function asCharacterRole(value: string): CharacterRole {
  return value as CharacterRole;
}

function asDifficulty(value: string): RaidDifficulty {
  return value as RaidDifficulty;
}

function asAccessStatus(value: string): BoosterAccessStatus {
  return value as BoosterAccessStatus;
}

export function ManageUserDetailView({ data }: { data: Page }) {
  const { user, characters, access, audit } = data;
  const approved = access.filter((row) => row.status === "APPROVED").length;
  const revoked = access.filter((row) => row.status === "REVOKED").length;

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
              <ChangeAccountRoleDialog
                userId={user.id}
                userName={user.name}
                currentRole={user.accountRole as AccountRole}
              />
            }
          />
          <div className="px-4 py-4">
            <AccountRoleBadge role={user.accountRole} />
            <p className="mt-3 text-xs text-muted">
              BOOSTER / LOOTBUDDY are run participation types, not account roles.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Characters"
            description={`${characters.length} on this account.`}
          />
          {characters.length === 0 ? (
            <EmptyState title="No characters." description="This user has not added characters yet." />
          ) : (
            <ul className="divide-y divide-border">
              {characters.map((character) => (
                <li key={character.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{character.name}</p>
                    <p className="text-xs text-muted">
                      {character.realm}
                      {character.isActive ? "" : " · inactive"}
                      {character.blizzardLinked ? " · Battle.net" : ""}
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
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Booster qualifications"
            description={
              approved === 0 && revoked === 0
                ? "No difficulty qualifications."
                : `${approved} approved${revoked ? ` · ${revoked} revoked` : ""}`
            }
            action={
              <div className="flex flex-wrap items-center gap-3">
                <GrantBoosterAccessDialog
                  users={[
                    {
                      id: user.id,
                      name: user.name,
                      discordUsername: user.discordUsername,
                    },
                  ]}
                  defaultUserId={user.id}
                />
                <Link
                  href={`/manage/booster-access?view=qualifications&userId=${encodeURIComponent(user.id)}`}
                  className="text-sm text-accent hover:underline"
                >
                  Open queue
                </Link>
              </div>
            }
          />
          {access.length === 0 ? (
            <EmptyState
              title="No booster access."
              description="Grant access from the booster access queue."
            />
          ) : (
            <ul className="divide-y divide-border">
              {access.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <DifficultyBadge difficulty={asDifficulty(row.difficulty)} />
                  </div>
                  <div className="text-right">
                    <AccessBadge status={asAccessStatus(row.status)} />
                    {row.grantedAt ? (
                      <p className="mt-1 text-xs text-muted">{formatDateTime(row.grantedAt)}</p>
                    ) : null}
                  </div>
                  {row.notes ? <p className="w-full text-xs text-muted">{row.notes}</p> : null}
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
