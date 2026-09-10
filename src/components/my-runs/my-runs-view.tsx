import Link from "next/link";
import { formatDateTime } from "@/lib/datetime";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { runDetailPath } from "@/lib/run-routes";
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
  const hasAnySignup =
    data.selected.length + data.pending.length + data.notSelected.length + data.withdrawn.length > 0;

  return (
    <div>
      <PageHeader
        title="My Runs"
        description="Your signup relationships, grouped by status. BOOSTER and LOOTBUDDY are participation types for a run, not account identities."
      />
      {!hasAnySignup ? (
        <Card>
          <EmptyState
            title="You have not signed up for any runs."
            description="Signups from /runs appear here, grouped by pending, selected, not selected, and withdrawn."
          />
        </Card>
      ) : (
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
      )}
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

type RunGroup = {
  runId: string;
  runTitle: string;
  raidName: string;
  difficulty: SignupItem["difficulty"];
  scheduledStartAt: string;
  participationType: SignupItem["participationType"];
  offers: SignupItem[];
};

/**
 * A User may offer several Characters for the same Run (multiple RunSignup
 * rows). Grouped by runId here so one Run renders as one card with all
 * offered Characters listed together, instead of one row per Character.
 */
function groupByRun(items: SignupItem[]): RunGroup[] {
  const groups: RunGroup[] = [];
  for (const item of items) {
    let group = groups.find((entry) => entry.runId === item.runId);
    if (!group) {
      group = {
        runId: item.runId,
        runTitle: item.runTitle,
        raidName: item.raidName,
        difficulty: item.difficulty,
        scheduledStartAt: item.scheduledStartAt,
        participationType: item.participationType,
        offers: [],
      };
      groups.push(group);
    }
    group.offers.push(item);
  }
  return groups;
}

function SignupTable({ items }: { items: SignupItem[] }) {
  const groups = groupByRun(items);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">Run</th>
            <th className="px-4 py-2 font-medium">Schedule</th>
            <th className="px-4 py-2 font-medium">Characters</th>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Offers</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const selected = group.offers.find((offer) => offer.status === "SELECTED");
            return (
              <tr key={group.runId} className="border-t border-border align-top">
                <td className="px-4 py-3">
                  <Link href={runDetailPath(group.runId)} className="max-w-[220px] truncate font-medium text-accent hover:underline">
                    {group.runTitle}
                  </Link>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                    <span className="max-w-[160px] truncate">{group.raidName}</span>
                    <DifficultyBadge difficulty={group.difficulty} />
                  </div>
                </td>
                <td className="px-4 py-3 text-muted">{formatDateTime(group.scheduledStartAt)}</td>
                <td className="px-4 py-3">
                  <p className="max-w-[240px] truncate">
                    <span className="text-muted">Offered:</span>{" "}
                    {group.offers.map((offer) => offer.characterName ?? "Unknown character").join(", ")}
                  </p>
                  <p className="mt-1 max-w-[240px] truncate text-xs text-muted">
                    Selected: {selected?.characterName ?? "Pending"}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <ParticipationBadge type={group.participationType} />
                </td>
                <td className="px-4 py-3">
                  <ul className="space-y-1.5">
                    {group.offers.map((offer) => (
                      <li key={offer.id} className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted">{offer.characterName ?? "—"}</span>
                        {offer.participationType === "LOOTBUDDY" ? (
                          <span className="text-xs text-muted">
                            {offer.lootbuddyMode ? LOOTBUDDY_MODE_LABELS[offer.lootbuddyMode] : "Lootbuddy"}
                            {offer.lootbuddyVerification && offer.lootbuddyVerification !== "NONE"
                              ? ` · ${LOOTBUDDY_VERIFICATION_LABELS[offer.lootbuddyVerification]}`
                              : ""}
                          </span>
                        ) : offer.role ? (
                          <RoleBadge role={offer.role} />
                        ) : null}
                        <SignupStatusBadge status={offer.status} />
                        {offer.canWithdraw ? <WithdrawButton signupId={offer.id} /> : null}
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
