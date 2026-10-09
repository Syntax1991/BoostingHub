import Link from "next/link";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import type { RaidCatalogRaidRow } from "@/services/raid-catalog.service";
import {
  formatBlizzard,
  formatIdList,
  pluralize,
  runAvailabilityLabel,
} from "@/components/manage/raid-catalog/raid-catalog-format";
import { RaidFormDialog } from "@/components/manage/raid-catalog/raid-form-dialog";
import { RaidWclIntegration } from "@/components/manage/raid-catalog/raid-wcl-integration";
import { DeleteRaidButton } from "@/components/manage/raid-catalog/delete-raid-button";
import {
  DeleteEncounterButton,
  EncounterFormDialog,
  EncounterMoveButtons,
} from "@/components/manage/raid-catalog/encounter-controls";

function referenceLines(raid: RaidCatalogRaidRow): string[] {
  const { references } = raid;
  const lines: string[] = [];
  if (references.runContents > 0) lines.push(pluralize(references.runContents, "Run content"));
  const setups = references.templateContents + references.templates;
  if (setups > 0) lines.push(pluralize(setups, "Run Setup reference"));
  if (references.productContents > 0) lines.push(pluralize(references.productContents, "Product content"));
  if (references.lockouts > 0) lines.push(pluralize(references.lockouts, "Character lockout"));
  return lines;
}

/** One raid: identity-preserving metadata, usage, and its encounters (structure locked when in use). */
export function ManageRaidCatalogRaidView({ raid, seasons }: { raid: RaidCatalogRaidRow; seasons: readonly string[] }) {
  const usage = referenceLines(raid);
  const canDelete = !raid.referenced && !raid.seeded;

  return (
    <div>
      <Link href="/manage/raid-catalog" className="mb-3 inline-block text-xs text-muted hover:text-foreground">
        ← Raid Catalog
      </Link>
      <PageHeader
        title={raid.name}
        description={`${raid.season} · ${pluralize(raid.bosses.length, "encounter")}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <RaidFormDialog
              seasons={seasons}
              raid={{
                raidId: raid.id,
                name: raid.name,
                season: raid.season,
                sortOrder: raid.sortOrder,
                trackLockouts: raid.trackLockouts,
                availableForRuns: raid.availableForRuns,
                blizzardInstanceId: raid.blizzardInstanceId,
              }}
            />
            {canDelete ? <DeleteRaidButton raidId={raid.id} name={raid.name} /> : null}
          </div>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card className="px-4 py-3">
          <h2 className="mb-2 text-sm font-semibold">Details</h2>
          <dl className="grid grid-cols-[9rem_1fr] gap-y-1 text-sm">
            <dt className="text-muted">Order</dt>
            <dd>{raid.sortOrder}</dd>
            <dt className="text-muted">Lockouts</dt>
            <dd>{raid.trackLockouts ? "Tracked (Blizzard sync)" : "Not tracked"}</dd>
            <dt className="text-muted">Status</dt>
            <dd>{runAvailabilityLabel(raid.availableForRuns)}</dd>
            <dt className="text-muted">Blizzard</dt>
            <dd>{formatBlizzard(raid)}</dd>
          </dl>
        </Card>
        <Card className="px-4 py-3">
          <h2 className="mb-2 text-sm font-semibold">Integrations</h2>
          <RaidWclIntegration
            raidId={raid.id}
            wclZoneId={raid.wclZoneId}
            wclRankingEncounterId={raid.wclRankingEncounterId}
          />
        </Card>
        <Card className="px-4 py-3">
          <h2 className="mb-2 text-sm font-semibold">Usage</h2>
          {usage.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-4 text-sm">
              {usage.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Not used by any Run, Run Setup, Product or lockout.</p>
          )}
          <p className="mt-2 text-xs text-muted">
            {raid.structureLocked
              ? raid.referenced
                ? "Encounters cannot be added, removed or reordered: boss counts and stored lockouts depend on them. Names and integration ids stay editable."
                : "Core catalog raid: encounters cannot be added, removed or reordered. Names and integration ids stay editable."
              : "Unused raid: encounters can be added, edited, reordered and deleted."}
            {raid.referenced || raid.seeded ? " This raid cannot be deleted; turn off “Available for new Runs” instead." : null}
          </p>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Encounters"
          description="Ordered as in the raid. Blizzard ids drive lockout sync; Warcraft Logs ids attach logged fights."
          action={raid.structureLocked ? null : <EncounterFormDialog raidId={raid.id} />}
        />
        {raid.bosses.length === 0 ? (
          <EmptyState title="No encounters yet." description="Add the raid's encounters in order." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Order</th>
                  <th className="px-4 py-2 font-medium">Encounter</th>
                  <th className="px-4 py-2 font-medium">Blizzard</th>
                  <th className="px-4 py-2 font-medium">Warcraft Logs</th>
                  <th className="px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {raid.bosses.map((boss, index) => (
                  <tr key={boss.id} className="border-t border-border align-middle">
                    <td className="px-4 py-3 text-muted">{boss.sortOrder}</td>
                    <td className="px-4 py-3 font-medium">{boss.name}</td>
                    <td className="px-4 py-3 text-muted">{formatIdList(boss.blizzardEncounterIds)}</td>
                    <td className="px-4 py-3 text-muted">{formatIdList(boss.wclEncounterIds)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        <EncounterFormDialog
                          raidId={raid.id}
                          encounter={{
                            bossId: boss.id,
                            name: boss.name,
                            blizzardEncounterIds: boss.blizzardEncounterIds,
                            wclEncounterIds: boss.wclEncounterIds,
                          }}
                        />
                        {raid.structureLocked ? null : (
                          <>
                            <EncounterMoveButtons
                              bossId={boss.id}
                              first={index === 0}
                              last={index === raid.bosses.length - 1}
                            />
                            <DeleteEncounterButton bossId={boss.id} name={boss.name} />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
