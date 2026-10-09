import Link from "next/link";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import type { RaidCatalogPageData } from "@/services/raid-catalog.service";
import {
  formatBlizzard,
  formatWarcraftLogs,
  pluralize,
  runAvailabilityLabel,
} from "@/components/manage/raid-catalog/raid-catalog-format";
import { RaidFormDialog } from "@/components/manage/raid-catalog/raid-form-dialog";
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
            <a href="#raids" className="rounded-md px-2 py-1 text-muted hover:bg-surface-raised hover:text-foreground">
              Raids
            </a>
            <a href="#run-presets" className="rounded-md px-2 py-1 text-muted hover:bg-surface-raised hover:text-foreground">
              Run Presets
            </a>
          </nav>
        }
      />

      <Card className="mb-8">
        <div id="raids" className="scroll-mt-20">
          <CardHeader
            title="Raids"
            description="Raid identity is permanent. Raids used by Runs, Run Setups, Products or lockouts keep their encounters fixed."
            action={<RaidFormDialog seasons={page.seasons} />}
          />
        </div>
        {page.raids.length === 0 ? (
          <EmptyState title="No raids yet." description="Create a raid to start." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Raid</th>
                  <th className="px-4 py-2 font-medium">Season</th>
                  <th className="px-4 py-2 font-medium">Bosses</th>
                  <th className="px-4 py-2 font-medium">Lockouts</th>
                  <th className="px-4 py-2 font-medium">Blizzard</th>
                  <th className="px-4 py-2 font-medium">Warcraft Logs</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {page.raids.map((raid) => (
                  <tr key={raid.id} className="border-t border-border align-middle">
                    <td className="px-4 py-3 font-medium">
                      {raid.name}
                      {raid.referenced ? <span className="ml-2 text-xs font-normal text-muted">In use</span> : null}
                    </td>
                    <td className="px-4 py-3 text-muted">{raid.season}</td>
                    <td className="px-4 py-3">{pluralize(raid.bosses.length, "boss", "bosses")}</td>
                    <td className="px-4 py-3">
                      <StatusPill on={raid.trackLockouts}>{raid.trackLockouts ? "Tracked" : "Not tracked"}</StatusPill>
                    </td>
                    <td className="px-4 py-3 text-muted">{formatBlizzard(raid)}</td>
                    <td className="px-4 py-3 text-muted">{formatWarcraftLogs(raid)}</td>
                    <td className="px-4 py-3">
                      <StatusPill on={raid.availableForRuns}>{runAvailabilityLabel(raid.availableForRuns)}</StatusPill>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/manage/raid-catalog/raids/${raid.id}`}
                        className="inline-flex h-8 items-center rounded-md border border-border bg-surface-raised px-2 text-xs font-medium hover:bg-[#222a3b]"
                      >
                        Manage
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          <EmptyState title="No products yet." description="Create a product from one or more raids." />
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
                            {content.raidName} <span className="text-muted">· {content.summary}</span>
                          </li>
                        ))}
                      </ol>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill on={product.active}>{product.active ? "Active" : "Inactive"}</StatusPill>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill on={product.selectable}>{product.selectable ? "Selectable" : "Hidden"}</StatusPill>
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
                        <ProductFlagToggle productId={product.id} flag="active" value={product.active} />
                        <ProductFlagToggle productId={product.id} flag="selectable" value={product.selectable} />
                        {product.seeded ? null : <DeleteProductButton productId={product.id} name={product.name} />}
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
