import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { DifficultyBadge } from "@/components/ui/badges";
import { RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import { RunTemplateFormDialog } from "@/components/templates/run-template-form-dialog";
import { TemplateRowActions } from "@/components/templates/template-row-actions";
import type { profileController } from "@/controllers/app.controller";

type MyTemplatesPage = Awaited<ReturnType<typeof profileController.getMyTemplatesPage>>;

export function MyTemplatesView({ data }: { data: MyTemplatesPage }) {
  return (
    <div>
      <PageHeader
        title="My Run Templates"
        description="Reusable planning presets for your runs. A template only stores planning defaults — raid, difficulty, loot type, planned bosses, composition, and notes. Schedule and status are always set per Run."
        actions={
          <RunTemplateFormDialog
            mode="create"
            raids={data.raids}
            raidLeads={data.raidLeads}
            canAssignRaidLead={data.canAssignRaidLead}
            defaultRaidLeadId={data.defaultRaidLeadId}
            triggerLabel="New template"
          />
        }
      />
      <Card>
        <CardHeader title="Templates" description={`${data.templates.length} template${data.templates.length === 1 ? "" : "s"}`} />
        {data.templates.length === 0 ? (
          <EmptyState title="No templates yet." description="Create one to speed up future run creation." />
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
                    {template.raidName} ({template.raidSeason}) · {template.plannedBossCount}/{template.totalBossCount} bosses ·{" "}
                    {template.desiredTankCount}T {template.desiredHealerCount}H {template.desiredDpsCount}D
                  </p>
                  {template.notes ? <p className="mt-1 text-xs text-muted">{template.notes}</p> : null}
                  {template.isActive && !template.usable ? (
                    <p className="mt-1 text-xs text-warning">Needs attention: {template.unusableReason}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <RunTemplateFormDialog
                    mode="edit"
                    initial={{
                      templateId: template.id,
                      name: template.name,
                      raidId: template.raidId,
                      difficulty: template.difficulty,
                      lootType: template.lootType,
                      plannedBossCount: template.plannedBossCount,
                      desiredTankCount: template.desiredTankCount,
                      desiredHealerCount: template.desiredHealerCount,
                      desiredDpsCount: template.desiredDpsCount,
                      notes: template.notes,
                      raidLeadId: template.raidLeadId,
                    }}
                    raids={data.raids}
                    raidLeads={data.raidLeads}
                    canAssignRaidLead={data.canAssignRaidLead}
                    defaultRaidLeadId={data.defaultRaidLeadId}
                    triggerLabel="Edit"
                    triggerClassName="inline-flex h-8 items-center rounded-md border border-border bg-surface-raised px-2 text-xs font-medium hover:bg-[#222a3b]"
                  />
                  <TemplateRowActions templateId={template.id} isActive={template.isActive} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
