import Link from "next/link";
import { formatDate, formatTime } from "@/lib/datetime";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { PageWorkspace } from "@/components/ui/layout";
import { runDetailPath } from "@/lib/run-routes";
import { DifficultyBadge } from "@/components/ui/badges";
import { LootbuddyIcon, RoleIcon } from "@/components/ui/ops-icons";
import { WithdrawButton } from "@/components/my-runs/withdraw-button";
import {
  CHARACTER_ROLE_LABELS,
  CLASS_LABELS,
  LOOTBUDDY_MODE_LABELS,
  LOOTBUDDY_VERIFICATION_LABELS,
  SIGNUP_STATUS_LABELS,
} from "@/lib/labels";
import { cn } from "@/lib/cn";
import type { CharacterRole } from "@/models/enums";
import type { signupService } from "@/services/signup.service";

type MyRuns = Awaited<ReturnType<typeof signupService.getMyRuns>>;
type SignupItem = MyRuns["pending"][number];

type SectionTone = "emphasis" | "default" | "quiet";

/** A characterless Lootbuddy has no Character — its own Class snapshot stands in for display. */
function characterLabel(item: Pick<SignupItem, "characterName" | "characterRealm" | "lootbuddyClass">): string {
  if (item.characterName) {
    return item.characterRealm ? `${item.characterName}-${item.characterRealm}` : item.characterName;
  }
  if (item.lootbuddyClass) {
    return CLASS_LABELS[item.lootbuddyClass];
  }
  return "Unknown character";
}

function selectionPhrase(offer: SignupItem): string {
  if (offer.selectionState === "PUBLISHED") return "Selected · Confirmed";
  if (offer.selectionState === "DRAFT") return "Selected · Draft";
  return SIGNUP_STATUS_LABELS[offer.status];
}

function selectionTone(offer: SignupItem): string {
  if (offer.selectionState === "PUBLISHED") return "text-success";
  if (offer.selectionState === "DRAFT" || offer.status === "SELECTED") return "text-success";
  if (offer.status === "PENDING") return "text-warning";
  return "text-muted";
}

export function MyRunsView({ data, timeZone }: { data: MyRuns; timeZone: string }) {
  const hasAnySignup =
    data.selected.length + data.pending.length + data.notSelected.length + data.withdrawn.length > 0;

  return (
    <PageWorkspace width="wide">
      <PageHeader
        title="My Runs"
        description="Your participation across runs — selected, pending, not selected, and withdrawn."
      />
      {!hasAnySignup ? (
        <EmptyState
          title="You have not signed up for any runs."
          description="Signups from /runs appear here, grouped by pending, selected, not selected, and withdrawn."
        />
      ) : (
        <div className="space-y-3.5">
          <SignupGroup
            title="Selected"
            items={data.selected}
            empty="No selected signups."
            timeZone={timeZone}
            tone="emphasis"
          />
          <SignupGroup
            title="Pending"
            items={data.pending}
            empty="No pending signups."
            timeZone={timeZone}
            tone="default"
          />
          <SignupGroup
            title="Not Selected"
            items={data.notSelected}
            empty="No declined signups."
            timeZone={timeZone}
            tone="quiet"
          />
          <WithdrawnSection items={data.withdrawn} timeZone={timeZone} />
        </div>
      )}
    </PageWorkspace>
  );
}

function SignupGroup({
  title,
  items,
  empty,
  timeZone,
  tone,
}: {
  title: string;
  items: SignupItem[];
  empty: string;
  timeZone: string;
  tone: SectionTone;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border p-4",
        tone === "emphasis" && "border-border bg-surface-raised",
        tone === "default" && "border-border bg-surface",
        tone === "quiet" && "border-border/80 bg-surface/80",
      )}
    >
      <h2 className="mb-3 text-sm font-semibold tracking-tight text-foreground">
        {title}
        <span className="ml-1.5 font-normal text-muted">· {items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-xs text-muted">{empty}</p>
      ) : (
        <RunOfferList items={items} timeZone={timeZone} />
      )}
    </section>
  );
}

function WithdrawnSection({ items, timeZone }: { items: SignupItem[]; timeZone: string }) {
  return (
    <details className="group rounded-lg border border-border/80 bg-surface/80">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold tracking-tight text-foreground marker:content-none [&::-webkit-details-marker]:hidden">
        Withdrawn
        <span className="ml-1.5 font-normal text-muted">· {items.length}</span>
      </summary>
      <div className="border-t border-border/60 px-4 pb-4 pt-3">
        {items.length === 0 ? (
          <p className="text-xs text-muted">No withdrawn signups.</p>
        ) : (
          <RunOfferList items={items} timeZone={timeZone} />
        )}
      </div>
    </details>
  );
}

type RunGroup = {
  runId: string;
  runTitle: string;
  productLabel: string;
  contentSummary?: string;
  difficulty: SignupItem["difficulty"];
  scheduledStartAt: string;
  offers: SignupItem[];
};

function groupByRun(items: SignupItem[]): RunGroup[] {
  const groups: RunGroup[] = [];
  for (const item of items) {
    let group = groups.find((entry) => entry.runId === item.runId);
    if (!group) {
      group = {
        runId: item.runId,
        runTitle: item.runTitle,
        productLabel: item.productLabel,
        contentSummary: item.contentSummary,
        difficulty: item.difficulty,
        scheduledStartAt: item.scheduledStartAt,
        offers: [],
      };
      groups.push(group);
    }
    group.offers.push(item);
  }
  return groups;
}

function RunOfferList({ items, timeZone }: { items: SignupItem[]; timeZone: string }) {
  const groups = groupByRun(items);
  return (
    <ul className="divide-y divide-border/60">
      {groups.map((group) => (
        <li key={group.runId} className="py-3 first:pt-0 last:pb-0">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(7.5rem,0.55fr)_minmax(0,1.7fr)] lg:items-start lg:gap-4">
            {/* Run identity */}
            <div className="min-w-0">
              <Link
                href={runDetailPath(group.runId)}
                className="block truncate text-[15px] font-semibold leading-snug text-foreground hover:text-accent"
              >
                {group.runTitle}
              </Link>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] leading-snug text-muted">
                <span className="truncate">
                  {group.productLabel}
                  {group.contentSummary ? ` · ${group.contentSummary}` : ""}
                </span>
                <DifficultyBadge difficulty={group.difficulty} />
              </p>
            </div>

            {/* When — quiet, no column banner */}
            <div className="min-w-0 lg:pt-0.5">
              <p className="text-[13px] leading-snug text-foreground/90">
                {formatDate(group.scheduledStartAt, timeZone)}
              </p>
              <p className="text-[12px] leading-snug text-muted">{formatTime(group.scheduledStartAt, timeZone)}</p>
            </div>

            {/* Participations + per-offer Withdraw */}
            <ul className="min-w-0 space-y-2">
              {group.offers.map((offer) => (
                <OfferRow key={offer.id} offer={offer} />
              ))}
            </ul>
          </div>
        </li>
      ))}
    </ul>
  );
}

function OfferRow({ offer }: { offer: SignupItem }) {
  const isLootbuddy = offer.participationType === "LOOTBUDDY";
  const primaryRole: CharacterRole | null =
    offer.displayRole ?? (offer.offeredRoles.length === 1 ? offer.offeredRoles[0] : null);
  const canWithdraw = offer.canWithdrawWithReason || offer.canWithdraw;

  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {isLootbuddy ? (
            <LootbuddyIcon size={16} />
          ) : primaryRole ? (
            <RoleIcon role={primaryRole} size={16} />
          ) : null}
          <span className="truncate text-[13px] font-medium leading-snug text-foreground">
            {characterLabel(offer)}
          </span>
        </div>
        <p className="mt-0.5 text-[12px] leading-snug text-muted">
          {isLootbuddy ? (
            <>
              Lootbuddy
              {offer.lootbuddyMode ? ` · ${LOOTBUDDY_MODE_LABELS[offer.lootbuddyMode]}` : ""}
              {offer.lootbuddyVerification && offer.lootbuddyVerification !== "NONE"
                ? ` · ${LOOTBUDDY_VERIFICATION_LABELS[offer.lootbuddyVerification]}`
                : ""}
            </>
          ) : primaryRole ? (
            CHARACTER_ROLE_LABELS[primaryRole]
          ) : offer.offeredRoles.length > 0 ? (
            offer.offeredRoles.map((role) => CHARACTER_ROLE_LABELS[role]).join(" · ")
          ) : (
            "Booster"
          )}
        </p>
        <p className={cn("mt-0.5 text-[12px] font-medium leading-snug", selectionTone(offer))}>
          {selectionPhrase(offer)}
          {offer.scheduleConflicts.length > 0 ? (
            <span
              className="ml-1.5 font-normal text-warning"
              title={offer.scheduleConflicts.map((row) => row.message).join("\n")}
            >
              · Conflict
            </span>
          ) : null}
        </p>
      </div>
      {canWithdraw ? (
        <div className="shrink-0 pt-0.5">
          {offer.canWithdrawWithReason ? (
            <WithdrawButton signupId={offer.id} requireReason />
          ) : (
            <WithdrawButton signupId={offer.id} />
          )}
        </div>
      ) : null}
    </div>
  );
}
