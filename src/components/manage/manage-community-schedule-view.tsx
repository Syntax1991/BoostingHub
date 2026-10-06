import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatDate, formatTime } from "@/lib/datetime";
import { communityWeekdayShortLabel } from "@/lib/community-schedule";
import { CommunityScheduleAddTimesDialog } from "@/components/manage/community-schedule-add-times-dialog";
import { CommunityScheduleOccurrenceActions } from "@/components/manage/community-schedule-occurrence-actions";
import { CommunitySchedulePlanDialog } from "@/components/manage/community-schedule-plan-dialog";
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

function RunSetupsSection({ page }: { page: CommunitySchedulePage }) {
  if (page.runSetups.length === 0) {
    return (
      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Run Setups / Weekly Plan</h2>
          <p className="mt-0.5 text-xs text-muted">
            Groups of weekly times sharing the same Run Setup and raid lead.
          </p>
        </div>
        <EmptyState
          title="No run setups yet."
          description="Create a schedule to group weekly times under a Run Setup."
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Run Setups / Weekly Plan</h2>
        <p className="mt-0.5 text-xs text-muted">
          Groups of weekly times sharing the same Run Setup and raid lead.
        </p>
      </div>
      <ul className="divide-y divide-border">
        {page.runSetups.map((group) => (
          <li key={group.key} className="px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {group.runSetupName} · {group.raidLeadName}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Auto-create: {group.autoCreateSummary}
                  {group.runTemplateId ? "" : " · No Run Setup linked"}
                </p>
              </div>
              {page.canEdit && group.runTemplateId ? (
                <div className="flex flex-wrap items-center gap-2">
                  <CommunityScheduleAddTimesDialog
                    runTemplateId={group.runTemplateId}
                    raidLeadId={group.raidLeadId}
                    runSetupName={group.runSetupName}
                  />
                  <Link
                    href="/manage/templates"
                    className="inline-flex h-8 items-center rounded-md border border-border bg-surface-raised px-2 text-xs font-medium hover:bg-[#222a3b]"
                  >
                    Edit Run Setup
                  </Link>
                </div>
              ) : null}
            </div>
            <ul className="mt-2 space-y-1.5">
              {group.slots.map((slot) => (
                <li
                  key={slot.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <span className={!slot.isActive ? "opacity-70" : undefined}>
                      {communityWeekdayShortLabel(slot.weekday)} {slot.localStartTime}
                      {!slot.isActive ? " · Inactive" : ""}
                    </span>
                    <span className="ml-2 text-xs text-muted">
                      Auto {slot.autoCreateRun ? "✓" : "✗"}
                    </span>
                    {slot.notes ? <p className="mt-0.5 text-xs text-muted">{slot.notes}</p> : null}
                  </div>
                  {page.canEdit ? (
                    <CommunityScheduleSlotActions slotId={slot.id} isActive={slot.isActive} />
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ManageCommunityScheduleView({ page }: { page: CommunitySchedulePage }) {
  return (
    <div>
      <PageHeader
        title="Operational Schedule"
        description="Recurring community run times with optional DRAFT run materialization per raid-ID window. Does not open Runs or post to Discord Schedule automatically."
        actions={
          page.canEdit ? (
            <CommunitySchedulePlanDialog
              raidLeads={page.eligibleRaidLeads}
              templates={page.templates}
              raids={page.raids}
              defaultRaidLeadId={page.eligibleRaidLeads[0]?.id}
            />
          ) : null
        }
      />

      <div className="grid gap-4">
        <RunSetupsSection page={page} />
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
    </div>
  );
}
