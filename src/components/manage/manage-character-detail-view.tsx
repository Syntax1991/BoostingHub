import Link from "next/link";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { ClassBadge, DifficultyBadge } from "@/components/ui/badges";
import { CHARACTER_ROLE_LABELS } from "@/lib/labels";
import { formatDateTime } from "@/lib/datetime";
import type { RaidDifficulty } from "@/models/enums";
import type { managementController } from "@/controllers/app.controller";
import { SYNC_INELIGIBLE_COPY } from "@/services/character-operations.service";
import { CharacterSyncButtons } from "@/components/manage/character-operations/character-sync-buttons";
import {
  LinkageBadge,
  StatusBadge,
  SyncHealthBadge,
  Timestamp,
} from "@/components/manage/character-operations/status";
import { DeleteCharacterButton } from "@/components/characters/delete-character-button";

type Data = Awaited<ReturnType<typeof managementController.getCharacterOperationsPage>>;

const TRACKED: RaidDifficulty[] = ["NORMAL", "HEROIC", "MYTHIC"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function ExactTime({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted">—</span>;
  return (
    <span>
      <Timestamp value={value} /> <span className="text-xs text-muted">({formatDateTime(value)})</span>
    </span>
  );
}

export function ManageCharacterDetailView({ data }: { data: Data }) {
  const { row, identity, weeklyAvailability, boosterAccess, currentReset } = data;
  const ineligibleCopy = row.syncIneligibleReason ? SYNC_INELIGIBLE_COPY[row.syncIneligibleReason] : null;

  return (
    <div className="min-w-0">
      <PageHeader
        title={`${row.name}-${row.realm}`}
        description={`${row.region} · character operations`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/manage/characters" className="text-sm text-accent hover:underline">
              All characters
            </Link>
            <DeleteCharacterButton
              characterId={row.id}
              characterLabel={`${row.name}-${row.realm}`}
              mode="admin"
              redirectTo="/manage/characters"
            />
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Identity" />
          <dl className="px-4 py-3 text-sm">
            <Field label="Character">{row.name}</Field>
            <Field label="Realm">{row.realm}</Field>
            <Field label="Region">{row.region}</Field>
            <Field label="Class">
              <ClassBadge wowClass={row.wowClass} />
            </Field>
            <Field label="Specialization">{row.specialization ?? "—"}</Field>
            <Field label="Role">{CHARACTER_ROLE_LABELS[identity.primaryRole]}</Field>
            <Field label="Item level">{row.itemLevel ?? "Unknown"}</Field>
            <Field label="Status">
              <StatusBadge retired={row.retired} />
            </Field>
          </dl>
        </Card>

        <Card>
          <CardHeader
            title="Sync"
            action={
              <CharacterSyncButtons
                characterId={row.id}
                characterLabel={`${row.name}-${row.realm}`}
                ineligibleCopy={ineligibleCopy}
                cooldownRemainingMs={row.cooldownRemainingMs}
              />
            }
          />
          <dl className="px-4 py-3 text-sm">
            <Field label="Health">
              <SyncHealthBadge health={row.health} retired={row.retired} />
            </Field>
            <Field label="Last attempt">
              <ExactTime value={row.lastSyncAttemptAt} />
            </Field>
            <Field label="Last success">
              <ExactTime value={row.lastSyncedAt} />
            </Field>
            <Field label="Last error">
              <ExactTime value={row.lastSyncErrorAt} />
            </Field>
            <Field label="Error category">
              {row.lastSyncErrorLabel ? <span className="text-danger">{row.lastSyncErrorLabel}</span> : "—"}
            </Field>
            <Field label="Consecutive failures">{row.syncFailureCount}</Field>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Owner & Blizzard" />
          <dl className="px-4 py-3 text-sm">
            <Field label="Owner">
              <Link href={`/manage/users/${row.owner.id}`} className="text-accent hover:underline">
                {row.owner.name}
              </Link>
            </Field>
            <Field label="Discord">{row.owner.discordUsername ? `@${row.owner.discordUsername}` : "—"}</Field>
            <Field label="Blizzard linkage">
              <LinkageBadge linkage={row.linkage} />
            </Field>
            <Field label={`Battle.net connection (${row.region})`}>
              {identity.ownerHasRegionConnection ? "Connected" : <span className="text-warning">Not connected</span>}
            </Field>
            <Field label="Blizzard character id">{identity.blizzardCharacterId ?? "—"}</Field>
            <Field label="Blizzard realm id">{identity.blizzardRealmId ?? "—"}</Field>
          </dl>
          {row.linkage !== "LINKED" ? (
            <p className="border-t border-border px-4 py-2 text-xs text-muted">
              Synced from the public Blizzard API (item level + raid lockouts). Ownership is not verified via Battle.net;
              connecting Battle.net and importing links it automatically.
            </p>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="Current lockouts" description={`Reset ${currentReset}. Unknown = no verified data; 0/N = verified none.`} />
          <div className="overflow-x-auto px-4 py-3">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-1 pr-3 font-medium">Raid</th>
                  {TRACKED.map((difficulty) => (
                    <th key={difficulty} className="py-1 pr-3 font-medium">
                      <DifficultyBadge difficulty={difficulty} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {row.lockoutSlots.map((slot) => (
                  <tr key={slot.raidId} className="border-t border-border">
                    <td className="py-1.5 pr-3 font-medium">{slot.raidName}</td>
                    {TRACKED.map((difficulty) => {
                      const lockout = slot.status === "VERIFIED" ? slot.rows.find((item) => item.difficulty === difficulty) : null;
                      return (
                        <td key={difficulty} className="py-1.5 pr-3 tabular-nums">
                          {lockout ? (
                            `${lockout.bossesDefeated}/${lockout.bossTotal}`
                          ) : (
                            <span className="text-muted">Unknown</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Weekly availability" />
          <div className="px-4 py-3 text-sm">
            {weeklyAvailability ? (
              <>
                <p>
                  {weeklyAvailability.status === "AVAILABLE" ? (
                    <span className="text-success">Available</span>
                  ) : (
                    <span className="text-warning">Unavailable</span>
                  )}{" "}
                  <span className="text-xs text-muted">{weeklyAvailability.resetWindowLabel}</span>
                </p>
                {weeklyAvailability.unavailableDifficulties.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {weeklyAvailability.unavailableDifficulties.map((difficulty) => (
                      <DifficultyBadge key={difficulty} difficulty={difficulty} />
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <span className="text-muted">—</span>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Booster Access" description="Account-level qualifications (read-only)." />
          <dl className="px-4 py-3 text-sm">
            {boosterAccess.difficulties.map((entry) => (
              <Field key={entry.difficulty} label={entry.difficulty.charAt(0) + entry.difficulty.slice(1).toLowerCase()}>
                <span className={entry.status === "APPROVED" ? "text-success" : "text-muted"}>
                  {entry.status === "NONE" ? "None" : entry.status.charAt(0) + entry.status.slice(1).toLowerCase()}
                </span>
              </Field>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}
