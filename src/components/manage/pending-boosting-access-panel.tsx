import Link from "next/link";
import { formatDateTime } from "@/lib/datetime";
import { CHARACTER_ROLE_LABELS, DIFFICULTY_LABELS } from "@/lib/labels";
import { ClassBadge, DifficultyBadge, RoleBadge } from "@/components/ui/badges";
import { EmptyState } from "@/components/ui/primitives";
import { ApproveBoosterAccessButton } from "@/components/manage/approve-booster-access-button";
import { BoosterAccessReviewDialog } from "@/components/manage/booster-access-review-dialog";
import type { PendingBoostingAccessGroup } from "@/services/user-management.service";

function requestLine(row: PendingBoostingAccessGroup["requests"][number]): string {
  const character = row.characterName
    ? `${row.characterName}${row.realm ? `-${row.realm}` : ""}`
    : null;
  const role = CHARACTER_ROLE_LABELS[row.role];
  const difficulty = DIFFICULTY_LABELS[row.difficulty];
  if (character) {
    return `${character} · ${role} · ${difficulty}`;
  }
  return `${role} · ${difficulty}`;
}

export function PendingBoostingAccessPanel({
  groups,
}: {
  groups: PendingBoostingAccessGroup[];
}) {
  if (groups.length === 0) {
    return (
      <EmptyState
        title="No pending boosting-access requests."
        description="Historical in-app PENDING applications appear here. New applications go through Discord."
      />
    );
  }

  return (
    <ul className="divide-y divide-border">
      {groups.map((group) => (
        <li key={group.userId} className="px-4 py-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <Link
                href={`/manage/users/${group.userId}`}
                className="font-medium hover:underline"
              >
                {group.userName}
              </Link>
              <p className="text-xs text-muted">
                {group.requests.length} pending
              </p>
            </div>
            <Link
              href={`/manage/users/${group.userId}`}
              className="text-sm text-accent hover:underline"
            >
              Open user
            </Link>
          </div>
          <ul className="space-y-3">
            {group.requests.map((row) => (
              <li
                key={row.id}
                className="rounded-md border border-border px-3 py-3 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <p className="font-medium">{requestLine(row)}</p>
                    <div className="flex flex-wrap gap-2">
                      <ClassBadge wowClass={row.wowClass} />
                      <RoleBadge role={row.role} />
                      <DifficultyBadge difficulty={row.difficulty} />
                    </div>
                    <p className="text-xs text-muted">
                      Requested {formatDateTime(row.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ApproveBoosterAccessButton accessId={row.id} />
                    <BoosterAccessReviewDialog accessId={row.id} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
