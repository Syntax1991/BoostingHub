import Link from "next/link";
import { formatDateTime } from "@/lib/datetime";
import { CHARACTER_ROLE_LABELS, DIFFICULTY_LABELS, REGION_LABELS } from "@/lib/labels";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { AccessBadge, ClassBadge, DifficultyBadge, RoleBadge } from "@/components/ui/badges";
import { CharacterFormDialog } from "@/components/characters/character-form-dialog";
import { CharacterLifecycleButton } from "@/components/characters/character-lifecycle-button";
import type { characterService } from "@/services/character.service";

type Details = Awaited<ReturnType<typeof characterService.getCharacterDetails>>;

export function CharacterDetailsView({ data }: { data: Details }) {
  return (
    <div>
      <PageHeader
        title={data.name}
        description={`${data.realm} · ${REGION_LABELS[data.region]} · manually maintained character data.`}
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
              <dd className="mt-1">{data.itemLevel} (manual)</dd>
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
          </dl>
        </Card>
        <Card>
          <CardHeader title="Metadata" description="Blizzard identifiers stay empty until a later sync." />
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
          </dl>
        </Card>
        <Card>
          <CardHeader
            title="Booster access"
            description="Read-only. Approval is a separate domain from character identity."
          />
          {data.boosterAccess.length === 0 ? (
            <EmptyState title="No booster access assigned." description="Existing characters can still sign as lootbuddy." />
          ) : (
            <ul className="divide-y divide-border">
              {data.boosterAccess.map((access) => (
                <li key={`${access.role}-${access.difficulty}-${access.status}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span>
                    {CHARACTER_ROLE_LABELS[access.role]} · {DIFFICULTY_LABELS[access.difficulty]}
                  </span>
                  <AccessBadge status={access.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Raid lockouts" description="Stored lockouts only. Not live Blizzard data." />
          {data.lockouts.length === 0 ? (
            <EmptyState title="No tracked raid lockouts." description="Lockouts are system state and cannot be edited here." />
          ) : (
            <ul className="divide-y divide-border">
              {data.lockouts.map((lockout) => (
                <li key={`${lockout.raidName}-${lockout.difficulty}-${lockout.resetIdentifier}`} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{lockout.raidName}</span>
                    <DifficultyBadge difficulty={lockout.difficulty} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {lockout.resetIdentifier} ·{" "}
                    {lockout.isComplete ? "complete" : `${lockout.bossesDefeated} bosses`}
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
