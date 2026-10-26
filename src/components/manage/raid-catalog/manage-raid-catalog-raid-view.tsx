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
import { RefreshRaidDialog } from "@/components/manage/raid-catalog/raid-import-dialogs";
import {
  RaidLifecycleNotice,
  RaidStatusBadges,
} from "@/components/manage/raid-catalog/raid-status-badges";
import { RaidWclIntegration } from "@/components/manage/raid-catalog/raid-wcl-integration";
import { effectiveWclRankingEncounterId } from "@/lib/raid-catalog";
import { RaidLifecycleButtons } from "@/components/manage/raid-catalog/raid-lifecycle-actions";
import {
  DeleteEncounterButton,
  EncounterFormDialog,
  EncounterMoveButtons,
} from "@/components/manage/raid-catalog/encounter-controls";

function referenceLines(raid: RaidCatalogRaidRow): string[] {
  const { references } = raid;
  const lines: string[] = [];
  if (references.runContents > 0) lines.push(pluralize(references.runContents, "Run content"));
  const setups = references.templateContents;
  if (setups > 0) lines.push(pluralize(setups, "Run Setup reference"));
  if (references.productContents > 0)
    lines.push(pluralize(references.productContents, "Product content"));
  if (references.lockouts > 0) lines.push(pluralize(references.lockouts, "Character lockout"));
  return lines;
}

/** One raid: BoostingHub settings, Blizzard / WCL status, usage, and its encounters. */
export function ManageRaidCatalogRaidView({
  raid,
  seasons,
}: {
  raid: RaidCatalogRaidRow;
  seasons: readonly string[];
}) {
  const usage = referenceLines(raid);
  // Blizzard owns the boss list of an imported raid: no manual encounter editing.
  const blizzardLinked = raid.blizzardInstanceId != null;
  const encountersEditable = !blizzardLinked && !raid.structureLocked;

  return (
    <div>
      <Link
        href="/manage/raid-catalog?tab=raids"
        className="mb-3 inline-block text-xs text-muted hover:text-foreground"
      >
        ← Raid Catalog
      </Link>
      <PageHeader
        title={raid.name}
        description={`${raid.season} · ${pluralize(raid.bosses.length, "encounter")}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {blizzardLinked ? <RefreshRaidDialog raidId={raid.id} /> : null}
            <RaidFormDialog
              seasons={seasons}
              raid={{
                raidId: raid.id,
                name: raid.name,
                shortName: raid.shortName,
                season: raid.season,
                sortOrder: raid.sortOrder,
                trackLockouts: raid.trackLockouts,
                availableForRuns: raid.availableForRuns,
                blizzardInstanceId: raid.blizzardInstanceId,
              }}
            />
            <RaidLifecycleButtons
              raidId={raid.id}
              name={raid.name}
              bossCount={raid.bosses.length}
              actions={raid.actions}
              duplicateOf={raid.duplicateOf}
              lockoutCount={raid.references.lockouts}
            />
          </div>
        }
      />

      <RaidLifecycleNotice raid={raid} className="mb-3" />
      <RaidStatusBadges status={raid.status} className="mb-4" />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card className="px-4 py-3">
          <h2 className="mb-2 text-sm font-semibold">Details</h2>
          <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-y-1 text-sm">
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
            wclRankingEncounterId={effectiveWclRankingEncounterId(raid)}
            rankingFromOnlyEncounter={
              raid.wclRankingEncounterId == null && effectiveWclRankingEncounterId(raid) != null
            }
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
            <p className="text-sm text-muted">
              Not used by any Run, Run Setup, Product or lockout.
            </p>
          )}
          <p className="mt-2 text-xs text-muted">
            {blizzardLinked
              ? raid.structureLocked
                ? "Bosses, order and Blizzard ids come from the Blizzard journal (Refresh from Blizzard). Because this raid is in use or core content, a refresh never adds or removes bosses — differences are shown for reconciliation."
                : "Bosses, order and Blizzard ids come from the Blizzard journal (Refresh from Blizzard)."
              : raid.structureLocked
                ? raid.referenced
                  ? "Encounters cannot be added, removed or reordered: boss counts and stored lockouts depend on them. Names and integration ids stay editable."
                  : "Core catalog raid: encounters cannot be added, removed or reordered. Names and integration ids stay editable."
                : "Unused raid: encounters can be added, edited, reordered and deleted."}
            {raid.actions.archive
              ? raid.referenced
                ? " Because it is in use, this raid cannot be deleted — archive it to retire it."
                : " Core catalog raid: it cannot be deleted — archive it to retire it."
              : null}
          </p>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Encounters"
          description="Ordered as in the raid. Blizzard ids drive lockout sync; Warcraft Logs ids attach logged fights."
          action={encountersEditable ? <EncounterFormDialog raidId={raid.id} /> : null}
        />
        {raid.bosses.length === 0 ? (
          <EmptyState
            title="No encounters yet."
            description="Import the raid from Blizzard to add its bosses."
          />
        ) : (
          <ol className="divide-y divide-border">
            {raid.bosses.map((boss, index) => (
              <li
                key={boss.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="break-words font-medium">
                    <span className="mr-2 text-muted">{boss.sortOrder}.</span>
                    {boss.name}
                  </p>
                  <p className="text-xs text-muted">
                    {boss.blizzardEncounterIds.length > 0
                      ? "Blizzard mapped"
                      : "Blizzard not mapped"}{" "}
                    ·{" "}
                    {boss.wclEncounterIds.length > 0
                      ? "Warcraft Logs mapped"
                      : "Warcraft Logs needs mapping"}
                  </p>
                  <details className="text-xs text-muted">
                    <summary className="cursor-pointer select-none hover:text-foreground">
                      Ids
                    </summary>
                    <span className="font-mono">
                      Blizzard {formatIdList(boss.blizzardEncounterIds)} · WCL{" "}
                      {formatIdList(boss.wclEncounterIds)}
                    </span>
                  </details>
                </div>
                {blizzardLinked ? null : (
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
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
