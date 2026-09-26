"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/datetime";
import { REGION_LABELS } from "@/lib/labels";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { AccessBadge, ClassBadge, DifficultyBadge, RoleBadge } from "@/components/ui/badges";
import { CharacterFormDialog } from "@/components/characters/character-form-dialog";
import { CharacterLifecycleButton } from "@/components/characters/character-lifecycle-button";
import { CharacterScheduleCommitmentsSection } from "@/components/characters/character-schedule-commitments-section";
import { WeeklyAvailabilityDialog } from "@/components/characters/weekly-availability-dialog";
import { formatWeeklyAvailabilityDetailSummary } from "@/lib/weekly-availability-display";
import { projectCurrentRaidLockoutSlots } from "@/lib/lockout-display";
import { DiscordBoosterApplicationCta } from "@/components/characters/discord-booster-application-cta";
import { WarcraftLogsLink } from "@/components/characters/warcraft-logs-link";
import { LinkWarcraftLogsButton } from "@/components/characters/link-warcraft-logs-button";
import { refreshBlizzardCharacterAction } from "@/controllers/blizzard.actions";
import type { characterService } from "@/services/character.service";
import type { BoosterQualificationStatus } from "@/models/enums";
import {
  BLIZZARD_PROFILE_UNAVAILABLE_HINT,
  BLIZZARD_PROFILE_UNAVAILABLE_TITLE,
  BLIZZARD_SYNC_STALE_HINT,
} from "@/lib/blizzard/sync-state";
import { DeleteCharacterButton } from "@/components/characters/delete-character-button";

type Details = Awaited<ReturnType<typeof characterService.getCharacterDetails>>;

function statusLabel(status: BoosterQualificationStatus | "NONE") {
  if (status === "NONE") return "Not granted";
  if (status === "APPROVED") return "Approved";
  return "Revoked";
}

function BlizzardRefreshButton({ characterId }: { characterId: string }) {
  const router = useRouter();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await refreshBlizzardCharacterAction({ characterId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={run}
        className="h-8 px-2 text-xs"
        aria-describedby={error ? errorId : undefined}
      >
        {pending ? "Refreshing…" : "Refresh"}
      </Button>
      {error ? (
        <span id={errorId} role="alert" className="max-w-48 text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function CharacterDetailsView({ data }: { data: Details }) {
  const panel = data.accessPanel;
  const lockoutSlots = projectCurrentRaidLockoutSlots(
    data.lockouts,
    data.currentLockoutRaids ?? [],
  );
  return (
    <div>
      <PageHeader
        title={data.name}
        description={
          data.blizzardLinked
            ? `${data.realm} · ${REGION_LABELS[data.region]} · Battle.net linked.`
            : `${data.realm} · ${REGION_LABELS[data.region]} · Synced from the public Blizzard API.`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/characters" className="inline-flex h-8 items-center text-sm text-accent hover:underline">
              All characters
            </Link>
            <WarcraftLogsLink
              warcraftLogsId={data.warcraftLogsId}
              label="Warcraft Logs"
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-surface-raised"
            />
            {!data.warcraftLogsId ? <LinkWarcraftLogsButton characterId={data.id} /> : null}
            <CharacterFormDialog
              mode="edit"
              triggerLabel="Edit"
              initial={{
                id: data.id,
                name: data.name,
                realm: data.realm,
                region: data.region,
                wowClass: data.wowClass,
                specialization: data.specialization ?? "",
                itemLevel: data.itemLevel,
              }}
            />
            {data.isActive ? <BlizzardRefreshButton characterId={data.id} /> : null}
            <CharacterLifecycleButton characterId={data.id} isActive={data.isActive} />
            <DeleteCharacterButton
              characterId={data.id}
              characterLabel={`${data.name}-${data.realm}`}
              mode="owner"
              redirectTo="/characters"
            />
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Identity" />
          <dl className="grid grid-cols-2 gap-3 px-4 py-4 text-sm">
            <div>
              <dt className="text-muted">Class</dt>
              <dd className="mt-1">
                <ClassBadge wowClass={data.wowClass} />
              </dd>
            </div>
            <div>
              <dt className="text-muted">Specialization</dt>
              <dd className="mt-1">{data.specialization ?? "None"}</dd>
            </div>
            <div>
              <dt className="text-muted">Primary role</dt>
              <dd className="mt-1">
                <RoleBadge role={data.primaryRole} />
              </dd>
            </div>
            <div>
              <dt className="text-muted">Item level</dt>
              <dd className="mt-1">
                {typeof data.itemLevel === "number" ? data.itemLevel : "Unknown"}{" "}
                <span className="text-xs text-muted">(Blizzard)</span>
              </dd>
            </div>
            <div>
              <dt className="text-muted">Status</dt>
              <dd className="mt-1">{data.isActive ? "Active" : "Inactive"}</dd>
            </div>
            <div>
              <dt className="text-muted">Region / realm</dt>
              <dd className="mt-1">
                {REGION_LABELS[data.region]} · {data.realm}
              </dd>
            </div>
            {data.blizzardLinked ? (
              <div>
                <dt className="text-muted">Battle.net</dt>
                <dd className="mt-1">Battle.net Linked</dd>
              </div>
            ) : null}
          </dl>
        </Card>
        <Card>
          <CardHeader
            title="Metadata"
            description={
              data.blizzardLinked
                ? "Linked to Battle.net. Use Refresh to pull the latest Blizzard profile."
                : "Synced from the public Blizzard API (item level + raid lockouts). Connect Battle.net on the Characters page to link it to your account."
            }
          />
          <dl className="space-y-2 px-4 py-4 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Created</dt>
              <dd>{data.createdAt ? formatDateTime(data.createdAt) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Updated</dt>
              <dd>{data.updatedAt ? formatDateTime(data.updatedAt) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Last synced</dt>
              <dd>{data.lastSyncedAt ? formatDateTime(data.lastSyncedAt) : "Never synced"}</dd>
            </div>
            {data.blizzardSyncState.kind === "PROFILE_UNAVAILABLE" ? (
              <div role="status" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                <p className="font-medium text-warning">{BLIZZARD_PROFILE_UNAVAILABLE_TITLE}</p>
                <p className="mt-1 text-muted">{BLIZZARD_PROFILE_UNAVAILABLE_HINT}</p>
              </div>
            ) : data.blizzardSyncState.kind === "STALE" ? (
              <div role="status" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                <p className="font-medium text-warning">Blizzard sync failing</p>
                <p className="mt-1 text-muted">{BLIZZARD_SYNC_STALE_HINT}</p>
              </div>
            ) : null}
            {!data.blizzardLinked ? (
              <p className="pt-1 text-xs text-muted">
                Not linked to Battle.net yet — connecting Battle.net links it automatically when it is on your account.
              </p>
            ) : null}
          </dl>
        </Card>
        <Card>
          <CardHeader
            title="Account booster access"
            description="Difficulty qualifications on your account. Shared by every character — not owned by this character. Approved difficulty unlocks all valid roles for each class."
            action={<DiscordBoosterApplicationCta discordTicketUrl={panel.discordTicketUrl} />}
          />
          <ul className="divide-y divide-border">
            {panel.difficulties.map((cell) => (
              <li key={cell.difficulty} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <DifficultyBadge difficulty={cell.difficulty} />
                <span className="flex items-center gap-2">
                  {cell.status === "NONE" ? (
                    <span className="text-xs text-muted">{statusLabel(cell.status)}</span>
                  ) : (
                    <AccessBadge status={cell.status} />
                  )}
                </span>
                {cell.notes && cell.status === "REVOKED" ? (
                  <p className="w-full text-xs text-muted">{cell.notes}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader
            title="Raid lockouts"
            description={`Current reset ${data.currentReset}${
              data.currentLockoutRaids?.length
                ? ` · ${data.currentLockoutRaids.map((raid) => raid.name).join(" · ")}`
                : ""
            }. Derived from Blizzard Character Raid Encounters on Refresh (profile data may lag until logout). Missing difficulties show as unknown — never invented 0/N. Mythic is boss-kill progress only.`}
          />
          {lockoutSlots.length === 0 ? (
            <EmptyState
              title="Unknown"
              description="No verified current-reset lockout data. Missing or stale rows are not treated as clear."
            />
          ) : (
            <ul className="divide-y divide-border">
              {lockoutSlots.map((slot) =>
                slot.status === "UNKNOWN" ? (
                  <li key={slot.raidId} className="px-4 py-3 text-sm">
                    <span className="font-medium">{slot.raidName}</span>
                    <p className="mt-1 text-xs text-muted">Unknown — no verified current-reset data.</p>
                  </li>
                ) : (
                  slot.rows.map((lockout) => (
                    <li
                      key={`${slot.raidId}-${lockout.difficulty}`}
                      className="px-4 py-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{slot.raidName}</span>
                        <DifficultyBadge difficulty={lockout.difficulty} />
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {data.currentReset} · {lockout.bossesDefeated}/{lockout.bossTotal}
                        {lockout.isComplete ? " complete" : ""}
                      </p>
                    </li>
                  ))
                ),
              )}
            </ul>
          )}
        </Card>
      </div>
      <div className="mt-4 grid gap-4">
        <Card>
          <CardHeader
            title="Availability"
            description="Current regional WoW reset only. New resets default to Available."
          />
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
            <div>
              <p className="text-xs text-muted">{data.weeklyAvailability.resetWindowLabel}</p>
              {(() => {
                const summary = formatWeeklyAvailabilityDetailSummary(
                  data.weeklyAvailability.unavailableDifficulties,
                );
                return (
                  <>
                    <p
                      className={
                        data.weeklyAvailability.status === "UNAVAILABLE"
                          ? "mt-1 text-sm font-semibold text-[#f0b4b4]"
                          : "mt-1 text-sm font-semibold text-[#b7e0c0]"
                      }
                    >
                      {summary.headline}
                    </p>
                    {summary.detail ? (
                      <p className="mt-0.5 text-xs text-muted">{summary.detail}</p>
                    ) : null}
                  </>
                );
              })()}
            </div>
            <WeeklyAvailabilityDialog
              characterId={data.id}
              characterName={data.name}
              weeklyAvailability={data.weeklyAvailability}
              triggerLabel="Change"
              triggerClassName="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
        </Card>
        <CharacterScheduleCommitmentsSection commitments={data.scheduleCommitments} />
      </div>
    </div>
  );
}
