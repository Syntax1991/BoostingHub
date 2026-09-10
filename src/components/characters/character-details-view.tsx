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
import { DiscordBoosterApplicationCta } from "@/components/characters/discord-booster-application-cta";
import { refreshBlizzardCharacterAction } from "@/controllers/blizzard.actions";
import type { characterService } from "@/services/character.service";
import type { BoosterQualificationStatus } from "@/models/enums";

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
  return (
    <div>
      <PageHeader
        title={data.name}
        description={
          data.blizzardLinked
            ? `${data.realm} · ${REGION_LABELS[data.region]} · Battle.net linked.`
            : `${data.realm} · ${REGION_LABELS[data.region]} · Class and Item Level from Blizzard.`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/characters" className="inline-flex h-8 items-center text-sm text-accent hover:underline">
              All characters
            </Link>
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
            {data.blizzardLinked ? <BlizzardRefreshButton characterId={data.id} /> : null}
            <CharacterLifecycleButton characterId={data.id} isActive={data.isActive} />
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
                : "Connect Battle.net on the Characters page and link this character to enable Blizzard refresh."
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
            {!data.blizzardLinked ? (
              <p className="pt-1 text-xs text-muted">
                Refresh requires Battle.net linking from the Characters page import session.
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
            description={`Current reset ${data.currentReset}${data.currentLockoutRaid ? ` · ${data.currentLockoutRaid.name}` : ""}. Derived from Blizzard Character Raid Encounters on Refresh (profile data may lag until logout). Missing difficulties show as unknown — never invented 0/N. Mythic is boss-kill progress only.`}
          />
          {data.lockouts.length === 0 ? (
            <EmptyState
              title="Unknown"
              description="No verified current-reset lockout data. Missing or stale rows are not treated as clear."
            />
          ) : (
            <ul className="divide-y divide-border">
              {data.lockouts.map((lockout) => (
                <li key={`${lockout.raidName}-${lockout.difficulty}-${lockout.resetIdentifier}`} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{lockout.raidName}</span>
                    <DifficultyBadge difficulty={lockout.difficulty} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {lockout.resetIdentifier} · {lockout.bossesDefeated}/{lockout.bossTotal}
                    {lockout.isComplete ? " complete" : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
