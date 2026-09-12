import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { isActiveSignupOffer } from "@/services/signup-state";
import {
  ClassBadge,
  ParticipationBadge,
  RoleBadge,
  SignupStatusBadge,
  AccessBadge,
} from "@/components/ui/badges";
import { WithdrawButton } from "@/components/my-runs/withdraw-button";
import { AddStrikeButton } from "@/components/runs/add-strike-button";
import { DIFFICULTY_ABBREVIATIONS, LOOTBUDDY_MODE_LABELS, LOOTBUDDY_VERIFICATION_LABELS } from "@/lib/labels";
import type { RunDetailView } from "@/services/run-detail.service";
import type { RosterManagementView } from "@/services/roster.service";

type ManagerSignup = RosterManagementView["groups"]["tanks"][number];

/** "HC 8/8 · Saved" — informational only, never a reason a signup is flagged. */
function formatRaidSave(raidSave: ManagerSignup["raidSave"]): string | null {
  if (!raidSave) return null;
  return `${DIFFICULTY_ABBREVIATIONS[raidSave.difficulty]} ${raidSave.bossesDefeated}/${raidSave.totalBossCount} · Saved`;
}

export function RunSignupsSection({ data }: { data: RunDetailView }) {
  if (data.permissions.canViewManagerSignups && data.manager) {
    const all = [
      ...data.manager.groups.tanks,
      ...data.manager.groups.healers,
      ...data.manager.groups.dps,
      ...data.manager.groups.lootbuddies,
    ];
    return <ManagerSignupList runId={data.run.id} signups={all} />;
  }

  return <OwnSignupList signups={data.viewerSignups} />;
}

function characterLabel(signup: { characterName: string | null; characterRealm: string | null }): string {
  if (!signup.characterName) return "Unknown character";
  return signup.characterRealm ? `${signup.characterName}-${signup.characterRealm}` : signup.characterName;
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
                <p className="font-medium">
                  {signup.characterName ?? "Unknown character"}
                  {signup.characterRealm ? `-${signup.characterRealm}` : ""}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <ParticipationBadge type={signup.participationType} />
                  {signup.role ? <RoleBadge role={signup.role} /> : null}
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
              {signup.canWithdraw ? <WithdrawButton signupId={signup.id} /> : null}
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
  participationType: ManagerSignup["participationType"];
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
        participationType: signup.participationType,
        anyApproved: false,
        signups: [],
      };
      groups.push(group);
    }
    group.signups.push(signup);
    if (signup.participationType === "BOOSTER" && signup.boosterApproved) {
      group.anyApproved = true;
    }
  }
  return groups;
}

/**
 * One User may offer several Characters for the same Run (multiple RunSignup
 * rows sharing userId). Grouped here so a User with three offers reads as one
 * signup intent, not three unrelated rows — draft selection itself still
 * happens per exact RunSignup row on the Roster tab.
 */
function ManagerSignupList({ runId, signups }: { runId: string; signups: ManagerSignup[] }) {
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
                  <ParticipationBadge type={group.participationType} />
                  {group.participationType === "BOOSTER" && group.anyApproved ? (
                    <AccessBadge status="APPROVED" />
                  ) : null}
                </div>
                <AddStrikeButton runId={runId} userId={group.userId} userName={group.userName} />
              </div>
              <ul className="mt-2 space-y-1.5">
                {group.signups.map((signup) => (
                  <li key={signup.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span>
                      {signup.character ? `${signup.character.name}-${signup.character.realm}` : "Unknown character"}
                    </span>
                    {signup.character ? <ClassBadge wowClass={signup.character.wowClass} /> : null}
                    {signup.role ? <RoleBadge role={signup.role} /> : null}
                    {signup.participationType === "LOOTBUDDY" ? (
                      <span className="text-xs text-muted">
                        {signup.lootbuddyMode ? LOOTBUDDY_MODE_LABELS[signup.lootbuddyMode] : "Lootbuddy"}
                        {signup.lootbuddyVerification && signup.lootbuddyVerification !== "NONE"
                          ? ` · ${LOOTBUDDY_VERIFICATION_LABELS[signup.lootbuddyVerification]}`
                          : ""}
                      </span>
                    ) : null}
                    <SignupStatusBadge status={signup.status} />
                    {formatRaidSave(signup.raidSave) ? (
                      <span className="text-xs text-muted">{formatRaidSave(signup.raidSave)}</span>
                    ) : null}
                    {signup.issue ? <span className="text-xs text-danger">{signup.issue}</span> : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
