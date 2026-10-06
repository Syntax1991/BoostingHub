import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatDate, formatTime } from "@/lib/datetime";
import { communityWeekdayShortLabel } from "@/lib/community-schedule";
import { CommunityScheduleOccurrenceActions } from "@/components/manage/community-schedule-occurrence-actions";
import { CommunityScheduleSlotFormDialog } from "@/components/manage/community-schedule-slot-form-dialog";
import { CommunityScheduleSlotActions } from "@/components/manage/community-schedule-slot-actions";
import type { CommunitySchedulePage } from "@/services/community-schedule.service";

function WindowSection({
  title,
  window,
  canEdit,
  raidLeads,
  templates,
}: {
  title: string;
  window: CommunitySchedulePage["current"];
  canEdit: boolean;
  raidLeads: CommunitySchedulePage["eligibleRaidLeads"];
  templates: CommunitySchedulePage["templates"];
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-muted">
          {formatDate(window.windowStart)} {formatTime(window.windowStart)} →{" "}
          {formatDate(window.windowEnd)} {formatTime(window.windowEnd)} Europe/Berlin
        </p>
      </div>
      {window.days.length === 0 ? (
        <EmptyState
          title="No active schedule slots in this window."
          description="Add recurring slots to show when the community normally offers Runs."
        />
      ) : (
        <ul className="divide-y divide-border">
          {window.days.map((day) => (
            <li key={day.localDate} className="px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                {communityWeekdayShortLabel(day.weekday)} · {day.localDate}
              </p>
              <ul className="mt-2 space-y-2">
                {day.slots.map(({ slot, occurrence, materialization }) => (
                  <li
                    key={slot.id}
                    className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {occurrence.localStartTime} · {slot.label} · {slot.raidLeadName}
                      </p>
                      {slot.notes ? <p className="mt-0.5 text-xs text-muted">{slot.notes}</p> : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-start justify-end gap-2">
                      <CommunityScheduleOccurrenceActions
                        scheduleSlotId={slot.id}
                        window={window.window}
                        materialization={materialization}
                      />
                      {canEdit ? (
                        <>
                          <CommunityScheduleSlotFormDialog
                            mode="edit"
                            raidLeads={raidLeads}
                            templates={templates}
                            initial={{
                              slotId: slot.id,
                              weekday: slot.weekday,
                              localStartTime: slot.localStartTime,
                              label: slot.label,
                              notes: slot.notes,
                              raidLeadId: slot.raidLeadId,
                              runTemplateId: slot.runTemplateId,
                              autoCreateRun: slot.autoCreateRun,
                            }}
                          />
                          <CommunityScheduleSlotActions slotId={slot.id} isActive={slot.isActive} />
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ManageCommunityScheduleView({ page }: { page: CommunitySchedulePage }) {
  const inactive = page.slots.filter((slot) => !slot.isActive);

  return (
    <div>
      <PageHeader
        title="Operational Schedule"
        description="Recurring community run times with optional DRAFT run materialization per raid-ID window. Does not open Runs or post to Discord Schedule automatically."
        actions={
          page.canEdit ? (
            <CommunityScheduleSlotFormDialog
              mode="create"
              raidLeads={page.eligibleRaidLeads}
              templates={page.templates}
              defaultRaidLeadId={page.eligibleRaidLeads[0]?.id}
            />
          ) : null
        }
      />

      <div className="grid gap-4">
        <WindowSection
          title="Current Raid ID"
          window={page.current}
          canEdit={page.canEdit}
          raidLeads={page.eligibleRaidLeads}
          templates={page.templates}
        />
        <WindowSection
          title="Next Raid ID"
          window={page.next}
          canEdit={page.canEdit}
          raidLeads={page.eligibleRaidLeads}
          templates={page.templates}
        />
      </div>

      {page.canEdit && inactive.length > 0 ? (
        <Card className="mt-4 overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Inactive slots</h2>
            <p className="mt-0.5 text-xs text-muted">
              Deactivated slots stay available for reactivation. They do not appear in Current/Next.
            </p>
          </div>
          <ul className="divide-y divide-border">
            {inactive.map((slot) => (
              <li
                key={slot.id}
                className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 opacity-80"
              >
                <div>
                  <p className="text-sm font-medium">
                    {communityWeekdayShortLabel(slot.weekday)} {slot.localStartTime} · {slot.label} ·{" "}
                    {slot.raidLeadName}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    Inactive
                    {slot.runTemplateName ? ` · Template: ${slot.runTemplateName}` : ""}
                    {slot.autoCreateRun ? " · Auto-create ON" : ""}
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <CommunityScheduleSlotFormDialog
                    mode="edit"
                    raidLeads={page.eligibleRaidLeads}
                    templates={page.templates}
                    initial={{
                      slotId: slot.id,
                      weekday: slot.weekday,
                      localStartTime: slot.localStartTime,
                      label: slot.label,
                      notes: slot.notes,
                      raidLeadId: slot.raidLeadId,
                      runTemplateId: slot.runTemplateId,
                      autoCreateRun: slot.autoCreateRun,
                    }}
                  />
                  <CommunityScheduleSlotActions slotId={slot.id} isActive={slot.isActive} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
