import Link from "next/link";
import { formatDateTime } from "@/lib/datetime";
import { ROLE_LABELS } from "@/lib/labels";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { BoostingRoleBadges } from "@/components/ui/badges";
import { hasRaidLeadAccess } from "@/auth/authorization";
import type { profileService } from "@/services/profile.service";

type Profile = Awaited<ReturnType<typeof profileService.getProfile>>;

export function ProfileView({ data }: { data: Profile }) {
  return (
    <div>
      <PageHeader
        title="Profile"
        description="Account identity, permissions, and booster eligibility."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Discord identity" />
          <div className="flex items-center gap-4 px-4 py-4">
            <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-surface-raised text-lg font-semibold">
              {data.user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.user.image} alt="" className="h-full w-full object-cover" />
              ) : (
                data.user.name.slice(0, 2).toUpperCase()
              )}
            </div>
            <div>
              <p className="text-lg font-semibold">{data.user.name}</p>
              <p className="text-sm text-muted">
                {data.user.discordUsername ? `@${data.user.discordUsername}` : "No Discord username stored"}
              </p>
              <p className="text-xs text-muted">{data.user.email ?? "Email is optional"}</p>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Permissions" description="Account roles are not booster/lootbuddy identities." />
          <div className="space-y-2 px-4 py-4 text-sm">
            <p>
              Role: <span className="font-medium">{ROLE_LABELS[data.user.accountRole]}</span>
            </p>
            <p>Status: {data.user.accountStatus}</p>
            <p>
              Characters: {data.activeCharacterCount} active / {data.characterCount} total
            </p>
            <Link href="/characters" className="inline-block text-xs text-accent hover:underline">
              Manage characters
            </Link>
            {hasRaidLeadAccess(data.user.accountRole) ? (
              <Link href="/profile/templates" className="block text-xs text-accent hover:underline">
                My Run Templates
              </Link>
            ) : null}
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Boosting roles"
            description="What you can take part in as. Separate from your account role."
          />
          <div className="flex flex-wrap items-center gap-2 px-4 py-4 text-sm">
            <BoostingRoleBadges roles={data.boostingRoles} emptyLabel="No boosting role yet" />
            {data.boostingRoles.isBooster || data.boostingRoles.discordRaidBooster ? null : (
              <p className="w-full text-xs text-muted">
                Booster signups need Booster access — apply through Discord. Lootbuddy signups are open to everyone.
              </p>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Participation" description="Signup counts for this account. These are not performance KPIs." />
          <dl className="grid grid-cols-2 gap-3 px-4 py-4 text-sm">
            <div>
              <dt className="text-muted">Booster signups</dt>
              <dd className="text-lg font-semibold">{data.participation.boosterSignups}</dd>
            </div>
            <div>
              <dt className="text-muted">Lootbuddy signups</dt>
              <dd className="text-lg font-semibold">{data.participation.lootbuddySignups}</dd>
            </div>
            <div>
              <dt className="text-muted">Selected</dt>
              <dd className="text-lg font-semibold">{data.participation.selected}</dd>
            </div>
            <div>
              <dt className="text-muted">Pending</dt>
              <dd className="text-lg font-semibold">{data.participation.pending}</dd>
            </div>
          </dl>
        </Card>
        <Card>
          <CardHeader
            title="Strikes"
            description="Your disciplinary history. Staff-internal notes are not shown here."
          />
          {data.strikes.length === 0 ? (
            <EmptyState title="No strikes." description="Nothing on record." />
          ) : (
            <ul className="space-y-3 px-4 py-4 text-sm">
              {data.strikes.map((strike) => (
                <li key={strike.id}>
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
                    {formatDateTime(strike.createdAt)}
                  </p>
                  {strike.status === "REVOKED" && strike.revokedReason ? (
                    <p className="mt-1 text-xs text-muted">Revoked: {strike.revokedReason}</p>
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
