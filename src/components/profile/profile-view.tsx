import { ROLE_LABELS, DIFFICULTY_LABELS, CHARACTER_ROLE_LABELS } from "@/lib/labels";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { ClassBadge } from "@/components/ui/badges";
import type { profileService } from "@/services/profile.service";

type Profile = Awaited<ReturnType<typeof profileService.getProfile>>;

export function ProfileView({ data }: { data: Profile }) {
  return (
    <div>
      <PageHeader
        title="Profile"
        description="Account identity, permissions, and booster eligibility. Payout and attendance remain reserved."
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
            <p>Characters: {data.activeCharacterCount} active / {data.characterCount} total</p>
          </div>
        </Card>
        <Card>
          <CardHeader title="Booster access" />
          <div className="px-4 py-4 text-sm">
            {data.boosterAccess.approvals.length === 0 ? (
              <p className="text-muted">No approved booster combinations.</p>
            ) : (
              <ul className="space-y-2">
                {data.boosterAccess.approvals.map((approval) => (
                  <li key={`${approval.wowClass}-${approval.role}-${approval.difficulty}`} className="flex items-center justify-between gap-2">
                    <ClassBadge wowClass={approval.wowClass} />
                    <span className="text-xs text-muted">
                      {CHARACTER_ROLE_LABELS[approval.role]} · {DIFFICULTY_LABELS[approval.difficulty]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted">
              {data.boosterAccess.pendingCount} pending · {data.boosterAccess.revokedCount} revoked
            </p>
          </div>
        </Card>
        <Card>
          <CardHeader title="Participation" description="Seeded signup history, not live performance KPIs." />
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
          <CardHeader title="Reserved" description="These sections are placeholders, not fake ledgers." />
          <ul className="space-y-2 px-4 py-4 text-sm text-muted">
            <li>Attendance history — deferred</li>
            <li>Availability calendar — deferred</li>
            <li>Payout / gold balance — deferred</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
