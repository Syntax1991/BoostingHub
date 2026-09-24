import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { isActiveSignupOffer } from "@/services/signup-state";
import {
  ClassBadge,
  ParticipationBadge,
  OfferedRolesBadges,
  SignupStatusBadge,
  AccessBadge,
} from "@/components/ui/badges";
import { WithdrawButton } from "@/components/my-runs/withdraw-button";
import { AddStrikeButton } from "@/components/runs/add-strike-button";
import { CHARACTER_ROLE_LABELS, CLASS_LABELS, LOOTBUDDY_MODE_LABELS, LOOTBUDDY_VERIFICATION_LABELS } from "@/lib/labels";
import { formatContentLockoutLines, formatContentLockoutTooltip } from "@/lib/run-content-lockouts";
import type { RunDetailView } from "@/services/run-detail.service";
import type { RosterManagementView } from "@/services/roster.service";
import type { WowClass } from "@/models/enums";

type ManagerSignup = RosterManagementView["groups"]["tanks"][number];

function boosterLockoutLines(signup: ManagerSignup): string[] {
  if (signup.participationType !== "BOOSTER" || !signup.character) return [];
  if (signup.contentSaves?.length) {
    return formatContentLockoutLines(signup.contentSaves);
  }
  return [];
}

function resolvedClass(signup: {
  lootbuddyClass?: WowClass | null;
  character?: { wowClass: WowClass } | null;
}): WowClass | null {
  return signup.lootbuddyClass ?? signup.character?.wowClass ?? null;
}

function characterLabel(signup: {
  characterName?: string | null;
  characterRealm?: string | null;
  lootbuddyClass?: WowClass | null;
  character?: { name: string; realm: string; wowClass: WowClass } | null;
}): string {
  if (signup.character) {
    return `${signup.character.name}-${signup.character.realm}`;
  }
  if (signup.characterName) {
    return signup.characterRealm ? `${signup.characterName}-${signup.characterRealm}` : signup.characterName;
  }
  const wowClass = resolvedClass(signup);
  return wowClass ? CLASS_LABELS[wowClass] : "Unknown character";
}

function uniqueManagerSignups(manager: NonNullable<RunDetailView["manager"]>): ManagerSignup[] {
  return [...manager.boosters, ...manager.groups.lootbuddies];
}

export function RunSignupsSection({ data }: { data: RunDetailView }) {
  if (data.permissions.canViewManagerSignups && data.manager) {
    return (
      <ManagerSignupList
        runId={data.run.id}
        signups={uniqueManagerSignups(data.manager)}
      />
    );
  }

  return <OwnSignupList signups={data.viewerSignups} />;
}

function OwnSignupList({ signups }: { signups: RunDetailView["viewerSignups"] }) {
  const active = signups.filter((signup) => signup.status !== "WITHDRAWN");
  const selected = active.find((signup) => signup.status === "SELECTED");
  const stillPending = active.some((signup) => signup.status === "PENDING");
  const selectedLabel = selected ? characterLabel(selected) : stillPending ? "Pending" : "Not selected";

  return (
    <Card>
      <CardHeader
        title="Your signups"
        description="Only your own participation on this run. Withdrawal follows existing signup rules."
      />
      {active.length === 0 ? (
        <EmptyState
          title="You have not signed this run."
          description="Use Sign up while the window is open. Eligibility is evaluated on submit."
        />
      ) : (
        <>
          {active.length > 0 ? (
            <div className="border-b border-border px-4 py-3 text-sm">
              <p>
                <span className="text-muted">Offered:</span> {active.map(characterLabel).join(", ")}
              </p>
              <p className="mt-1">
                <span className="text-muted">Selected:</span> {selectedLabel}
              </p>
            </div>
          ) : null}
        <ul className="divide-y divide-border">
          {active.map((signup) => (
            <li key={signup.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{characterLabel(signup)}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  {resolvedClass(signup) ? <ClassBadge wowClass={resolvedClass(signup)!} /> : null}
                  <ParticipationBadge type={signup.participationType} />
                  <OfferedRolesBadges roles={signup.offeredRoles} />
                  <SignupStatusBadge status={signup.status} />
                  {signup.participationType === "BOOSTER" ? (
                    <span>{signup.isBackup ? "Backup" : "Primary"}</span>
                  ) : null}
                  {signup.participationType === "LOOTBUDDY" ? (
                    <span>
                      {signup.lootbuddyMode ? LOOTBUDDY_MODE_LABELS[signup.lootbuddyMode] : "Lootbuddy"}
                      {signup.lootbuddyVerification && signup.lootbuddyVerification !== "NONE"
                        ? ` · ${LOOTBUDDY_VERIFICATION_LABELS[signup.lootbuddyVerification]}`
                        : ""}
                    </span>
                  ) : null}
                </div>
              </div>
              {signup.canWithdrawWithReason ? (
                <WithdrawButton signupId={signup.id} requireReason />
              ) : signup.canWithdraw ? (
                <WithdrawButton signupId={signup.id} />
              ) : null}
            </li>
          ))}
        </ul>
        </>
      )}
    </Card>
  );
}

type ManagerSignupGroup = {
  userId: string;
  userName: string;
  participationTypes: Array<ManagerSignup["participationType"]>;
  anyApproved: boolean;
  signups: ManagerSignup[];
};

/**
 * The Signups tab is a read-only operational overview, not the roster
 * candidate pool: a NOT_SELECTED row (a past roster outcome) belongs on the
 * Roster tab where it remains a legitimate re-selection candidate, not here
 * as if it were a current offer.
 */
function groupSignupsByUser(signups: ManagerSignup[]): ManagerSignupGroup[] {
  const groups: ManagerSignupGroup[] = [];
  for (const signup of signups) {
    if (!isActiveSignupOffer(signup.status)) continue;
    let group = groups.find((item) => item.userId === signup.userId);
    if (!group) {
      group = {
        userId: signup.userId,
        userName: signup.userName,
        participationTypes: [],
        anyApproved: false,
        signups: [],
      };
      groups.push(group);
    }
    group.signups.push(signup);
    if (!group.participationTypes.includes(signup.participationType)) {
      group.participationTypes.push(signup.participationType);
    }
    if (signup.participationType === "BOOSTER" && signup.boosterApproved) {
      group.anyApproved = true;
    }
  }
  return groups;
}

/**
 * One User may hold Booster + N Lootbuddy rows on the same Run. Grouped by
 * userId for the operational overview; each row still keeps its own
 * participation identity (RunSignup.id) and type badge.
 */
function ManagerSignupList({
  runId,
  signups,
}: {
  runId: string;
  signups: ManagerSignup[];
}) {
  const groups = groupSignupsByUser(signups);
  return (
    <Card>
      <CardHeader
        title="Signups"
        description="Operational list for rostering, grouped by User. Draft selection happens on the Roster tab."
      />
      {groups.length === 0 ? (
        <EmptyState title="No signups yet." description="New offers appear while the signup window is open." />
      ) : (
        <ul className="divide-y divide-border">
          {groups.map((group) => (
            <li key={group.userId} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{group.userName}</span>
                  {group.participationTypes.map((type) => (
                    <ParticipationBadge key={type} type={type} />
                  ))}
                  {group.participationTypes.includes("BOOSTER") && group.anyApproved ? (
                    <AccessBadge status="APPROVED" />
                  ) : null}
                </div>
                <AddStrikeButton runId={runId} userId={group.userId} userName={group.userName} />
              </div>
              <ul className="mt-2 space-y-1.5">
                {group.signups.map((signup) => {
                  const wowClass = resolvedClass(signup);
                  const lockoutLines = boosterLockoutLines(signup);
                  const lockoutAttention = signup.contentSaves?.some((row) => row.label.attention) ?? false;
                  return (
                  <li key={signup.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span>{characterLabel(signup)}</span>
                    {wowClass ? <ClassBadge wowClass={wowClass} /> : null}
                    <OfferedRolesBadges roles={signup.offeredRoles} />
                    {signup.selectedRole ? (
                      <span className="text-xs text-muted">Rostered as {CHARACTER_ROLE_LABELS[signup.selectedRole]}</span>
                    ) : null}
                    {signup.participationType === "LOOTBUDDY" ? (
                      <span className="text-xs text-muted">
                        {signup.lootbuddyMode ? LOOTBUDDY_MODE_LABELS[signup.lootbuddyMode] : "Lootbuddy"}
                        {signup.lootbuddyVerification && signup.lootbuddyVerification !== "NONE"
                          ? ` · ${LOOTBUDDY_VERIFICATION_LABELS[signup.lootbuddyVerification]}`
                          : ""}
                      </span>
                    ) : null}
                    <SignupStatusBadge status={signup.status} />
                    {lockoutLines.length > 0 ? (
                      <span
                        className={`cursor-help text-xs underline decoration-dotted underline-offset-2 ${lockoutAttention ? "text-warning" : "text-muted"}`}
                        title={formatContentLockoutTooltip(signup.contentSaves ?? [])}
                      >
                        {lockoutLines.join(" · ")}
                      </span>
                    ) : null}
                    {signup.issue ? <span className="text-xs text-danger">{signup.issue}</span> : null}
                  </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
