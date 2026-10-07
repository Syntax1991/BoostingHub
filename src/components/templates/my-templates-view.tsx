import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { DifficultyBadge } from "@/components/ui/badges";
import { RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import type { profileController } from "@/controllers/app.controller";

type MyTemplatesPage = Awaited<ReturnType<typeof profileController.getMyTemplatesPage>>;

/**
 * Read-only catalog of global Run Setups for Raid Leads.
 * Create/Edit/Delete remain Admin/Owner on /manage/schedule and /manage/templates.
 */
export function MyTemplatesView({ data }: { data: MyTemplatesPage }) {
  return (
    <div>
      <PageHeader
        title="Run Setups"
        description="Global reusable planning presets. Admins manage these; you can apply them when creating Runs. Raid Lead and composition overrides are chosen per Schedule or Run."
      />
      <Card>
        <CardHeader
          title="Available setups"
          description={`${data.templates.length} setup${data.templates.length === 1 ? "" : "s"}`}
        />
        {data.templates.length === 0 ? (
          <EmptyState
            title="No Run Setups yet."
            description="Ask an Admin to create global Run Setups on Manage Schedule."
          />
        ) : (
          <ul className="divide-y divide-border">
            {data.templates.map((template) => (
              <li key={template.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{template.name}</p>
                    <DifficultyBadge difficulty={template.difficulty} />
                    <span className="text-xs text-muted">{RUN_LOOT_TYPE_LABELS[template.lootType]}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        template.isActive ? "bg-success/15 text-success" : "bg-muted/15 text-muted"
                      }`}
                    >
                      {template.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {template.contentDisplay.productLabel} · {template.contentDisplay.titleCoverage} ·{" "}
                    {template.desiredTankCount}T {template.desiredHealerCount}H {template.desiredDpsCount}D
                    {template.desiredLootbuddyCount > 0 ? ` ${template.desiredLootbuddyCount}LB` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted">{template.contentDisplay.summary}</p>
                  {template.notes ? <p className="mt-1 text-xs text-muted">{template.notes}</p> : null}
                  {template.isActive && !template.usable ? (
                    <p className="mt-1 text-xs text-warning">Needs attention: {template.unusableReason}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
