import Link from "next/link";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import type { RaidCatalogPageData } from "@/services/raid-catalog.service";
import {
  formatBlizzard,
  formatIdList,
  formatWarcraftLogs,
  runAvailabilityLabel,
} from "@/components/manage/raid-catalog/raid-catalog-format";
import {
  ImportRaidDialog,
  ImportSeasonDialog,
} from "@/components/manage/raid-catalog/raid-import-dialogs";
import { RaidStatusBadges } from "@/components/manage/raid-catalog/raid-status-badges";
import {
  DeleteProductButton,
  ProductFlagToggle,
  ProductFormDialog,
  type ProductRaidOption,
} from "@/components/manage/raid-catalog/product-controls";

function StatusPill({ on, children }: { on: boolean; children: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 text-xs font-medium",
        on ? "bg-success/15 text-success" : "bg-slate-500/15 text-muted",
      )}
    >
      {children}
    </span>
  );
}

function BossIdRow({
  name,
  blizzard,
  wcl,
}: {
  name: string;
  blizzard: readonly number[];
  wcl: readonly number[];
}) {
  return (
    <>
      <dt className="truncate" title={name}>
        {name}
      </dt>
      <dd className="break-words font-mono">
        Blizzard {formatIdList(blizzard)} · WCL {formatIdList(wcl)}
      </dd>
    </>
  );
}

/** Admin Raid Catalog: persisted raids (with encounters) and run presets — DB authority only. */
export function ManageRaidCatalogView({ page }: { page: RaidCatalogPageData }) {
  const raidOptions: ProductRaidOption[] = page.raids.map((raid) => ({
    id: raid.id,
    name: raid.name,
    bossTotal: raid.bosses.length,
  }));

  return (
    <div>
      <PageHeader
        title="Raid Catalog"
        description="Manage raids, encounters and reusable run presets."
        actions={
          <nav aria-label="Raid Catalog sections" className="flex gap-2 text-sm">
            <a
              href="#raids"
              className="rounded-md px-2 py-1 text-muted hover:bg-surface-raised hover:text-foreground"
            >
              Raids
            </a>
            <a
              href="#run-presets"
              className="rounded-md px-2 py-1 text-muted hover:bg-surface-raised hover:text-foreground"
            >
              Run Presets
            </a>
          </nav>
        }
      />

      <Card className="mb-8">
        <div id="raids" className="scroll-mt-20">
          <CardHeader
            title="Raids"
            description="Imported from the Blizzard Adventure Journal: names, bosses, boss order and encounter ids stay in sync with Blizzard. Season, order, lockout tracking and run availability are yours to edit."
            action={
              <div className="flex flex-wrap gap-2">
                <ImportSeasonDialog seasons={page.importSeasons} />
                <ImportRaidDialog seasons={page.seasons} />
              </div>
            }
          />
        </div>
        {page.raids.length === 0 ? (
          <EmptyState
            title="No raids yet."
            description="Import a season or a raid from Blizzard to start."
          />
        ) : (
          <ul className="divide-y divide-border">
            {page.raids.map((raid) => (
              <li key={raid.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words font-medium">
                      {raid.name}
                      {raid.referenced ? (
                        <span className="ml-2 text-xs font-normal text-muted">In use</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted">
                      {raid.season} · {runAvailabilityLabel(raid.availableForRuns)}
                    </p>
                  </div>
                  <Link
                    href={`/manage/raid-catalog/raids/${raid.id}`}
                    className="inline-flex h-8 shrink-0 items-center rounded-md border border-border bg-surface-raised px-2 text-xs font-medium hover:bg-[#222a3b]"
                  >
                    Manage
                  </Link>
                </div>
                <RaidStatusBadges status={raid.status} className="mt-2" />
                <details className="mt-2 text-xs text-muted">
                  <summary className="cursor-pointer select-none hover:text-foreground">
                    Details
                  </summary>
                  <dl className="mt-1 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-2 gap-y-0.5">
                    <dt>Blizzard</dt>
                    <dd className="break-words">{formatBlizzard(raid)}</dd>
                    <dt>Warcraft Logs</dt>
                    <dd className="break-words">{formatWarcraftLogs(raid)}</dd>
                    {raid.bosses.map((boss) => (
                      <BossIdRow
                        key={boss.id}
                        name={boss.name}
                        blizzard={boss.blizzardEncounterIds}
                        wcl={boss.wclEncounterIds}
                      />
                    ))}
                  </dl>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div id="run-presets" className="scroll-mt-20">
          <CardHeader
            title="Run Presets"
            description="What can be scheduled or sold. Run creation still uses the current presets; products drive selection in a later update."
            action={<ProductFormDialog raids={raidOptions} />}
          />
        </div>
        {page.products.length === 0 ? (
          <EmptyState
            title="No products yet."
            description="Create a product from one or more raids."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Product</th>
                  <th className="px-4 py-2 font-medium">Contents</th>
                  <th className="px-4 py-2 font-medium">Active</th>
                  <th className="px-4 py-2 font-medium">Selectable</th>
                  <th className="px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {page.products.map((product) => (
                  <tr key={product.id} className="border-t border-border align-top">
                    <td className="px-4 py-3 font-medium">{product.name}</td>
                    <td className="px-4 py-3">
                      <ol className="space-y-0.5">
                        {product.contents.map((content) => (
                          <li key={content.id}>
                            {content.raidName}{" "}
                            <span className="text-muted">· {content.summary}</span>
                          </li>
                        ))}
                      </ol>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill on={product.active}>
                        {product.active ? "Active" : "Inactive"}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill on={product.selectable}>
                        {product.selectable ? "Selectable" : "Hidden"}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        <ProductFormDialog
                          raids={raidOptions}
                          product={{
                            productId: product.id,
                            name: product.name,
                            active: product.active,
                            selectable: product.selectable,
                            sortOrder: product.sortOrder,
                            contents: product.contents,
                          }}
                        />
                        <ProductFlagToggle
                          productId={product.id}
                          flag="active"
                          value={product.active}
                        />
                        <ProductFlagToggle
                          productId={product.id}
                          flag="selectable"
                          value={product.selectable}
                        />
                        {product.seeded ? null : (
                          <DeleteProductButton productId={product.id} name={product.name} />
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
