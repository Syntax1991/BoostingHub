"use client";

import { useRouter } from "next/navigation";
import {
  archiveRaidAction,
  deleteRaidAction,
  removeDuplicateRaidAction,
  restoreRaidAction,
} from "@/controllers/raid-catalog.actions";
import { RaidCatalogDialog } from "@/components/manage/raid-catalog/raid-catalog-dialog";
import { pluralize } from "@/components/manage/raid-catalog/raid-catalog-format";
import type { RaidLifecycleActions } from "@/services/raid-catalog.service";

const TRIGGER = "h-8 px-2 text-xs";

function RaidFacts({ name, bossCount }: { name: string; bossCount: number }) {
  return (
    <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-y-0.5 text-sm text-foreground">
      <dt className="text-muted">Raid</dt>
      <dd className="break-words">{name}</dd>
      <dt className="text-muted">Bosses</dt>
      <dd>{bossCount}</dd>
    </dl>
  );
}

/**
 * The one lifecycle action a Raid accepts in its current state (computed by
 * the server, which re-checks on submit): Delete, Remove duplicate, Archive
 * or Restore. Nothing is rendered that would only fail after clicking.
 */
export function RaidLifecycleButtons({
  raidId,
  name,
  bossCount,
  actions,
  duplicateOf,
  lockoutCount,
}: {
  raidId: string;
  name: string;
  bossCount: number;
  actions: RaidLifecycleActions;
  duplicateOf: { id: string; name: string } | null;
  lockoutCount: number;
}) {
  const router = useRouter();
  return (
    <>
      {actions.restore ? (
        <RaidCatalogDialog
          triggerLabel="Restore raid"
          triggerClassName={TRIGGER}
          title={`Restore ${name}?`}
          description="The raid returns to the catalog: it can be used for new Runs, Run Setups and Products again (subject to “Available for new Runs” and the product settings)."
          submitLabel="Restore raid"
          pendingLabel="Restoring…"
          onSubmit={() => restoreRaidAction({ raidId })}
        />
      ) : null}
      {actions.archive ? (
        <RaidCatalogDialog
          triggerLabel="Archive raid"
          triggerVariant="ghost"
          triggerClassName={`${TRIGGER} text-warning`}
          title={`Archive ${name}?`}
          description="Existing Runs, lockouts and Warcraft Logs data keep working. The raid is no longer offered for new Runs or Run Setups, products containing it are closed to new planning, and it cannot be added to a product. You can restore it later."
          submitLabel="Archive raid"
          pendingLabel="Archiving…"
          onSubmit={() => archiveRaidAction({ raidId })}
        >
          <RaidFacts name={name} bossCount={bossCount} />
        </RaidCatalogDialog>
      ) : null}
      {actions.removeDuplicate && duplicateOf ? (
        <RaidCatalogDialog
          triggerLabel="Remove duplicate"
          triggerVariant="ghost"
          triggerClassName={`${TRIGGER} text-danger`}
          title={`Remove duplicate ${name}?`}
          description={
            <>
              This raid shares its Blizzard instance with <strong>{duplicateOf.name}</strong>, which
              is kept. No Run, Run Setup or Product uses this copy.{" "}
              {lockoutCount > 0
                ? `Its ${pluralize(lockoutCount, "Character lockout")} move to the kept raid; exact copies are dropped. `
                : null}
              This permanently removes this Raid from the catalog.
            </>
          }
          submitLabel="Remove duplicate"
          pendingLabel="Removing…"
          danger
          onSubmit={() => removeDuplicateRaidAction({ raidId })}
          onSuccess={() => router.push(`/manage/raid-catalog/raids/${duplicateOf.id}`)}
        >
          <RaidFacts name={name} bossCount={bossCount} />
        </RaidCatalogDialog>
      ) : null}
      {actions.delete ? (
        <RaidCatalogDialog
          triggerLabel="Delete raid"
          triggerVariant="ghost"
          triggerClassName={`${TRIGGER} text-danger`}
          title={`Delete ${name}?`}
          description="This permanently removes this Raid from the catalog. It is not used by any Run, Run Setup, Product or lockout. This cannot be undone."
          submitLabel="Delete raid"
          pendingLabel="Deleting…"
          danger
          onSubmit={() => deleteRaidAction({ raidId })}
          onSuccess={() => router.push("/manage/raid-catalog?tab=raids")}
        >
          <RaidFacts name={name} bossCount={bossCount} />
        </RaidCatalogDialog>
      ) : null}
    </>
  );
}
