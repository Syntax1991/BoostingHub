import { formatDateTime } from "@/lib/datetime";
import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { ClassBadge, ParticipationBadge, RoleBadge } from "@/components/ui/badges";
import { RosterBuilderView } from "@/components/manage/roster-builder";
import type { RunDetailView } from "@/services/run-detail.service";

export function RunRosterSection({ data }: { data: RunDetailView }) {
  if (data.permissions.canManageRun && data.manager) {
    return <RosterBuilderView data={data.manager} embedded />;
  }

  if (!data.publishedRoster) {
    return (
      <Card>
        <EmptyState
          title="Roster is not published yet."
          description="The published selection appears here after a raid lead or admin publishes."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Published roster"
        description={`Published by ${data.publishedRoster.publishedByName ?? "Unknown"} · ${formatDateTime(data.publishedRoster.publishedAt)}`}
      />
      {data.publishedRoster.members.length === 0 ? (
        <EmptyState title="No selected members." description="Publication metadata exists, but no SELECTED signups remain." />
      ) : (
        <ul className="divide-y divide-border">
          {data.publishedRoster.members.map((member) => (
            <li key={member.signupId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">
                  {member.characterName}
                  {member.characterRealm ? `-${member.characterRealm}` : ""}
                </p>
                <p className="text-xs text-muted">{member.userName}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {member.wowClass ? <ClassBadge wowClass={member.wowClass} /> : null}
                {member.role ? <RoleBadge role={member.role} /> : null}
                <ParticipationBadge type={member.participationType} />
                {member.isBackup ? <span className="text-xs text-muted">Backup</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
