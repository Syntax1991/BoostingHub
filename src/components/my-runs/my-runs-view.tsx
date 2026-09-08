import { formatDateTime } from "@/lib/datetime";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import {
  DifficultyBadge,
  ParticipationBadge,
  RoleBadge,
  SignupStatusBadge,
} from "@/components/ui/badges";
import { WithdrawButton } from "@/components/my-runs/withdraw-button";
import { LOOTBUDDY_MODE_LABELS, LOOTBUDDY_VERIFICATION_LABELS } from "@/lib/labels";
import type { signupService } from "@/services/signup.service";

type MyRuns = Awaited<ReturnType<typeof signupService.getMyRuns>>;
type SignupItem = MyRuns["pending"][number];

export function MyRunsView({ data }: { data: MyRuns }) {
  return (
    <div>
      <PageHeader
        title="My Runs"
        description="Your signup relationships, grouped by status. BOOSTER and LOOTBUDDY are participation types for a run, not account identities."
      />
      <div className="grid gap-4">
        <SignupGroup title="Selected" items={data.selected} empty="No selected signups." />
        <SignupGroup title="Pending" items={data.pending} empty="No pending signups." />
        <SignupGroup title="Not Selected" items={data.notSelected} empty="No declined signups." />
        <details className="rounded-md border border-border bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
            Withdrawn ({data.withdrawn.length})
          </summary>
          {data.withdrawn.length === 0 ? (
            <EmptyState title="No withdrawn signups" description="Withdrawn records stay persisted for audit." />
          ) : (
            <SignupTable items={data.withdrawn} />
          )}
        </details>
      </div>
    </div>
  );
}

function SignupGroup({
  title,
  items,
  empty,
}: {
  title: string;
  items: SignupItem[];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader title={title} description={`${items.length} signup${items.length === 1 ? "" : "s"}`} />
      {items.length === 0 ? (
        <EmptyState title={empty} description="Status groups stay visible so pending, selected, and not selected never collapse together." />
      ) : (
        <SignupTable items={items} />
      )}
    </Card>
  );
}

function SignupTable({ items }: { items: SignupItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">Run</th>
            <th className="px-4 py-2 font-medium">Schedule</th>
            <th className="px-4 py-2 font-medium">Character</th>
            <th className="px-4 py-2 font-medium">Role / Mode</th>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Backup</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-border">
              <td className="px-4 py-3">
                <div className="max-w-[220px] truncate font-medium">{item.runTitle}</div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                  <span className="max-w-[160px] truncate">{item.raidName}</span>
                  <DifficultyBadge difficulty={item.difficulty} />
                </div>
              </td>
              <td className="px-4 py-3 text-muted">{formatDateTime(item.scheduledStartAt)}</td>
              <td className="px-4 py-3">
                <div className="max-w-[180px] truncate">{item.characterName ?? "—"}</div>
                <div className="max-w-[180px] truncate text-xs text-muted">{item.characterRealm ?? ""}</div>
              </td>
              <td className="px-4 py-3">
                {item.participationType === "LOOTBUDDY" ? (
                  <div className="text-xs text-muted">
                    {item.lootbuddyMode ? LOOTBUDDY_MODE_LABELS[item.lootbuddyMode] : "Lootbuddy"}
                    {item.lootbuddyVerification && item.lootbuddyVerification !== "NONE"
                      ? ` · ${LOOTBUDDY_VERIFICATION_LABELS[item.lootbuddyVerification]}`
                      : ""}
                  </div>
                ) : item.role ? (
                  <RoleBadge role={item.role} />
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3">
                <ParticipationBadge type={item.participationType} />
              </td>
              <td className="px-4 py-3 text-muted">
                {item.participationType === "BOOSTER" ? (item.isBackup ? "Backup" : "Primary") : "—"}
              </td>
              <td className="px-4 py-3">
                <SignupStatusBadge status={item.status} />
              </td>
              <td className="px-4 py-3">
                {item.canWithdraw ? <WithdrawButton signupId={item.id} /> : <span className="text-xs text-muted">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
