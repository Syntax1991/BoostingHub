import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatDate, formatTime } from "@/lib/datetime";
import { communityWeekdayShortLabel } from "@/lib/community-schedule";
import {
  COMMUNITY_SCHEDULE_RUN_MODE_LABELS,
  DIFFICULTY_ABBREVIATIONS,
  RUN_LOOT_TYPE_LABELS,
} from "@/lib/labels";
import { CommunityScheduleAddTimesDialog } from "@/components/manage/community-schedule-add-times-dialog";
import { CommunityScheduleDeleteSetupButton } from "@/components/manage/community-schedule-delete-setup-button";
import { CommunityScheduleDuplicateSetupButton } from "@/components/manage/community-schedule-duplicate-setup-button";
import { CommunityScheduleOccurrenceActions } from "@/components/manage/community-schedule-occurrence-actions";
import { ScheduleOccurrenceStaffing } from "@/components/manage/schedule-occurrence-staffing";
import { CommunitySchedulePlanDialog } from "@/components/manage/community-schedule-plan-dialog";
import { CommunityScheduleShareDialog } from "@/components/manage/community-schedule-share-dialog";
import { CommunityScheduleSlotFormDialog } from "@/components/manage/community-schedule-slot-form-dialog";
import { CommunityScheduleSlotActions } from "@/components/manage/community-schedule-slot-actions";
import { RunTemplateFormDialog } from "@/components/templates/run-template-form-dialog";
import {
  createCommunityScheduleRunSetupAction,
  updateCommunityScheduleRunSetupAction,
} from "@/controllers/community-schedule.actions";
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
                {day.slots.map(({ slot, occurrence, materialization, staffing }) => (
                  <li
                    key={slot.id}
                    className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {occurrence.localStartTime} · {slot.label} · {slot.raidLeadName}
                      </p>
                      {slot.notes ? <p className="mt-0.5 text-xs text-muted">{slot.notes}</p> : null}
                      <ScheduleOccurrenceStaffing staffing={staffing} />
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
                              runMode: slot.runMode,
                              compositionOverrideEnabled: slot.compositionOverrideEnabled,
                              desiredTankCountOverride: slot.desiredTankCountOverride,
                              desiredHealerCountOverride: slot.desiredHealerCountOverride,
                              desiredDpsCountOverride: slot.desiredDpsCountOverride,
                              desiredLootbuddyCountOverride: slot.desiredLootbuddyCountOverride,
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

function EditRunSetupButton({
  page,
  runTemplateId,
  triggerLabel = "Edit",
}: {
  page: CommunitySchedulePage;
  runTemplateId: string;
  triggerLabel?: string;
}) {
  const setup = page.templates.find((row) => row.id === runTemplateId);
  const inventory = page.runSetupInventory.find((row) => row.id === runTemplateId);
  if (!setup && !inventory) return null;
  const source = setup ?? inventory!;
  return (
    <RunTemplateFormDialog
      mode="edit"
      initial={{
        templateId: source.id,
        name: source.name,
        contentPreset: source.contentPreset,
        venomousPlannedBossCount: source.venomousPlannedBossCount,
        difficulty: source.difficulty,
        lootType: source.lootType,
        desiredTankCount: source.desiredTankCount,
        desiredHealerCount: source.desiredHealerCount,
        desiredDpsCount: source.desiredDpsCount,
        desiredLootbuddyCount: source.desiredLootbuddyCount,
        notes: source.notes,
      }}
      contentPresets={page.contentPresets}
      venomousBossMax={page.venomousBossMax}
      triggerLabel={triggerLabel}
      triggerClassName="inline-flex h-8 items-center rounded-md border border-border bg-surface-raised px-2 text-xs font-medium hover:bg-[#222a3b]"
      title="Edit Run Setup"
      description="Changes apply to future Runs only. Already materialized Runs stay unchanged. You remain on the Community Schedule."
      submitLabel="Save Run Setup"
      updateAction={updateCommunityScheduleRunSetupAction}
    />
  );
}

function RunSetupInventorySection({ page }: { page: CommunitySchedulePage }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Run Setups</h2>
        <p className="mt-0.5 text-xs text-muted">
          Reusable planning presets — including setups with no Schedule times yet.
        </p>
      </div>
      {page.runSetupInventory.length === 0 ? (
        <EmptyState
          title="No Run Setups yet."
          description="Create a Run Setup to reuse across weekly Schedule times."
        />
      ) : (
        <ul className="divide-y divide-border">
          {page.runSetupInventory.map((setup) => (
            <li key={setup.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {setup.name}
                  {!setup.isActive ? " · Inactive" : ""}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {setup.productLabel} · {DIFFICULTY_ABBREVIATIONS[setup.difficulty]} ·{" "}
                  {RUN_LOOT_TYPE_LABELS[setup.lootType]} · {setup.titleCoverage}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {setup.desiredTankCount}T · {setup.desiredHealerCount}H · {setup.desiredDpsCount}D ·{" "}
                  {setup.desiredLootbuddyCount}LB
                  {" · "}
                  {setup.slotCount} Schedule time{setup.slotCount === 1 ? "" : "s"}
                </p>
              </div>
              {page.canEdit ? (
                <div className="flex flex-wrap items-center gap-2">
                  <EditRunSetupButton page={page} runTemplateId={setup.id} />
                  <CommunityScheduleDuplicateSetupButton runTemplateId={setup.id} />
                  <CommunityScheduleDeleteSetupButton
                    runTemplateId={setup.id}
                    runSetupName={`${setup.name} · ${setup.productLabel}`}
                    raidLeadName="Global"
                    slotCount={setup.slotCount}
                    canDelete={setup.canDelete}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function WeeklyPlanSection({ page }: { page: CommunitySchedulePage }) {
  if (page.runSetups.length === 0) {
    return (
      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Weekly Plan</h2>
          <p className="mt-0.5 text-xs text-muted">
            Recurring Schedule times grouped by Run Setup and raid lead.
          </p>
        </div>
        <EmptyState
          title="No weekly times yet."
          description="Create a Schedule or add times to a Run Setup."
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Weekly Plan</h2>
        <p className="mt-0.5 text-xs text-muted">
          Recurring Schedule times grouped by Run Setup and raid lead.
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
                  <EditRunSetupButton
                    page={page}
                    runTemplateId={group.runTemplateId}
                    triggerLabel="Edit Run Setup"
                  />
                  <CommunityScheduleDeleteSetupButton
                    runTemplateId={group.runTemplateId}
                    runSetupName={group.runSetupName}
                    raidLeadName={group.raidLeadName}
                    slotCount={group.slotCount}
                    canDelete={group.canDelete}
                  />
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
                      {" · "}
                      {COMMUNITY_SCHEDULE_RUN_MODE_LABELS[slot.runMode]}
                      {!slot.isActive ? " · Inactive" : ""}
                    </span>
                    <span className="ml-2 text-xs text-muted">
                      Auto {slot.autoCreateRun ? "✓" : "✗"}
                    </span>
                    {slot.notes ? <p className="mt-0.5 text-xs text-muted">{slot.notes}</p> : null}
                  </div>
                  {page.canEdit ? (
                    <CommunityScheduleSlotActions
                      slotId={slot.id}
                      isActive={slot.isActive}
                      canDelete={slot.canDelete}
                      weekday={slot.weekday}
                      localStartTime={slot.localStartTime}
                      runMode={slot.runMode}
                      runSetupName={group.runSetupName}
                      raidLeadName={group.raidLeadName}
                    />
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
        title="Community Schedule"
        description="Reusable Run Setups and recurring community times with optional DRAFT run materialization. Does not open Runs or post to Discord Schedule automatically."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {page.canEdit ? (
              <RunTemplateFormDialog
                mode="create"
                contentPresets={page.contentPresets}
                venomousBossMax={page.venomousBossMax}
                triggerLabel="Create Run Setup"
                triggerClassName="inline-flex h-9 items-center rounded-md border border-border bg-surface-raised px-3 text-sm font-medium hover:bg-[#222a3b]"
                title="Create Run Setup"
                description="Create a global reusable planning preset with default composition. Attach Schedule times and Raid Leads later."
                submitLabel="Create Run Setup"
                createAction={createCommunityScheduleRunSetupAction}
              />
            ) : null}
            {page.canEdit ? (
              <CommunitySchedulePlanDialog
                raidLeads={page.eligibleRaidLeads}
                templates={page.templates}
                contentPresets={page.contentPresets}
                venomousBossMax={page.venomousBossMax}
                defaultRaidLeadId={page.eligibleRaidLeads[0]?.id}
              />
            ) : null}
            <CommunityScheduleShareDialog share={page.share} />
          </div>
        }
      />

      <div className="grid gap-4">
        <RunSetupInventorySection page={page} />
        <WeeklyPlanSection page={page} />
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
