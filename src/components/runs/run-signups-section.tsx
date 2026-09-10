import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import {
  ClassBadge,
  ParticipationBadge,
  RoleBadge,
  SignupStatusBadge,
  AccessBadge,
} from "@/components/ui/badges";
import { WithdrawButton } from "@/components/my-runs/withdraw-button";
import { LOOTBUDDY_MODE_LABELS, LOOTBUDDY_VERIFICATION_LABELS } from "@/lib/labels";
import type { RunDetailView } from "@/services/run-detail.service";
import type { RosterManagementView } from "@/services/roster.service";

type ManagerSignup = RosterManagementView["groups"]["tanks"][number];

export function RunSignupsSection({ data }: { data: RunDetailView }) {
  if (data.permissions.canViewManagerSignups && data.manager) {
    const all = [
      ...data.manager.groups.tanks,
      ...data.manager.groups.healers,
      ...data.manager.groups.dps,
      ...data.manager.groups.lootbuddies,
    ];
    return <ManagerSignupList signups={all} />;
  }

  return <OwnSignupList signups={data.viewerSignups} />;
}

function OwnSignupList({ signups }: { signups: RunDetailView["viewerSignups"] }) {
  return (
    <Card>
      <CardHeader
        title="Your signups"
        description="Only your own participation on this run. Withdrawal follows existing signup rules."
      />
      {signups.length === 0 ? (
        <EmptyState
          title="You have not signed this run."
          description="Use Sign up while the window is open. Eligibility is evaluated on submit."
        />
      ) : (
        <ul className="divide-y divide-border">
          {signups.map((signup) => (
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
      )}
    </Card>
  );
}

function ManagerSignupList({ signups }: { signups: ManagerSignup[] }) {
  return (
    <Card>
      <CardHeader
        title="Signups"
        description="Operational list for rostering. Draft selection happens on the Roster tab."
      />
      {signups.length === 0 ? (
        <EmptyState title="No signups yet." description="New offers appear while the signup window is open." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Player</th>
                <th className="px-4 py-2 font-medium">Character</th>
                <th className="px-4 py-2 font-medium">Offer</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {signups.map((signup) => (
                <tr key={signup.id} className="border-t border-border align-top">
                  <td className="px-4 py-3">{signup.userName}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>
                        {signup.character
                          ? `${signup.character.name}-${signup.character.realm}`
                          : "Unknown character"}
                      </span>
                      {signup.character ? <ClassBadge wowClass={signup.character.wowClass} /> : null}
                    </div>
                    {signup.character ? (
                      <p className="mt-1 text-xs text-muted">
                        {typeof signup.character.itemLevel === "number" ? signup.character.itemLevel : "Unknown"} ilvl ·{" "}
                        {signup.character.specialization ?? signup.character.primaryRole}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <ParticipationBadge type={signup.participationType} />
                      {signup.role ? <RoleBadge role={signup.role} /> : null}
                      {signup.participationType === "BOOSTER" ? (
                        <span className="text-xs text-muted">{signup.isBackup ? "Backup" : "Primary"}</span>
                      ) : null}
                    </div>
                    {signup.participationType === "BOOSTER" && signup.boosterApproved ? (
                      <div className="mt-1">
                        <AccessBadge status="APPROVED" />
                      </div>
                    ) : null}
                    {signup.participationType === "LOOTBUDDY" ? (
                      <p className="mt-1 text-xs text-muted">
                        {signup.lootbuddyMode ? LOOTBUDDY_MODE_LABELS[signup.lootbuddyMode] : "Lootbuddy"}
                        {signup.lootbuddyVerification && signup.lootbuddyVerification !== "NONE"
                          ? ` · ${LOOTBUDDY_VERIFICATION_LABELS[signup.lootbuddyVerification]}`
                          : ""}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <SignupStatusBadge status={signup.status} />
                    {signup.issue ? <p className="mt-1 text-xs text-danger">{signup.issue}</p> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
