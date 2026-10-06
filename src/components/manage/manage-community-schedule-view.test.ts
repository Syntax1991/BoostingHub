import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ManageCommunityScheduleView } from "@/components/manage/manage-community-schedule-view";
import type { CommunitySchedulePage } from "@/services/community-schedule.service";

function samplePage(canEdit: boolean): CommunitySchedulePage {
  const slot = {
    id: "slot-1",
    weekday: "FRIDAY" as const,
    localStartTime: "19:45",
    label: "Default HC",
    notes: null,
    raidLeadId: "lead-1",
    raidLeadName: "Synblast",
    raidLeadEligible: true,
    runTemplateId: "template-1",
    autoCreateRun: true,
    runTemplateName: "Default HC",
    isActive: true,
    createdById: "admin-1",
    updatedById: "admin-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const occurrence = {
    scheduledStartAt: "2026-01-16T18:45:00.000Z",
    weekday: "FRIDAY" as const,
    localStartTime: "19:45",
    localDate: "2026-01-16",
    window: "CURRENT" as const,
    windowStartAt: "2026-01-14T05:00:00.000Z",
    windowEndAt: "2026-01-21T05:00:00.000Z",
  };
  const materialization = {
    state: "AUTO_WAITING" as const,
    templateLabel: "Default HC · HC UNS 8/8",
    autoCreateRun: true,
    canMaterialize: true,
  };
  return {
    canEdit,
    timeZone: "Europe/Berlin",
    templates: [
      {
        id: "template-1",
        raidLeadId: "lead-1",
        label: "Default HC · HC UNS 8/8",
        usable: true,
        unusableReason: null,
      },
    ],
    raids: [{ id: "raid-1", name: "Venomous Abyss", season: "Midnight", totalBossCount: 8 }],
    runSetups: [
      {
        key: "template-1:lead-1",
        runTemplateId: "template-1",
        runSetupName: "Default HC",
        raidLeadId: "lead-1",
        raidLeadName: "Synblast",
        autoCreateSummary: "MIXED",
        canEdit,
        slots: [
          {
            id: "slot-1",
            weekday: "FRIDAY",
            localStartTime: "19:45",
            isActive: true,
            autoCreateRun: true,
            label: "Default HC",
            notes: null,
          },
          {
            id: "slot-2",
            weekday: "SATURDAY",
            localStartTime: "20:00",
            isActive: true,
            autoCreateRun: false,
            label: "Default HC",
            notes: null,
          },
          {
            id: "slot-inactive",
            weekday: "SUNDAY",
            localStartTime: "18:00",
            isActive: false,
            autoCreateRun: false,
            label: "Default HC",
            notes: null,
          },
        ],
      },
    ],
    current: {
      window: "CURRENT",
      windowStart: "2026-01-14T05:00:00.000Z",
      windowEnd: "2026-01-21T05:00:00.000Z",
      days: [
        {
          localDate: "2026-01-16",
          weekday: "FRIDAY",
          slots: [{ slot, occurrence, materialization }],
        },
      ],
    },
    next: {
      window: "NEXT",
      windowStart: "2026-01-21T05:00:00.000Z",
      windowEnd: "2026-01-28T05:00:00.000Z",
      days: [
        {
          localDate: "2026-01-23",
          weekday: "FRIDAY",
          slots: [
            {
              slot,
              occurrence: { ...occurrence, localDate: "2026-01-23", window: "NEXT" },
              materialization: { ...materialization, state: "NO_RUN_YET" },
            },
          ],
        },
      ],
    },
    slots: [
      slot,
      {
        ...slot,
        id: "slot-2",
        weekday: "SATURDAY",
        localStartTime: "20:00",
        autoCreateRun: false,
      },
      {
        ...slot,
        id: "slot-inactive",
        weekday: "SUNDAY",
        localStartTime: "18:00",
        isActive: false,
        autoCreateRun: false,
      },
    ],
    eligibleRaidLeads: [{ id: "lead-1", name: "Synblast" }],
  };
}

describe("ManageCommunityScheduleView", () => {
  it("renders Run Setups grouping, Create Schedule, and Current/Next windows", () => {
    const html = renderToStaticMarkup(
      createElement(ManageCommunityScheduleView, { page: samplePage(true) }),
    );
    expect(html).toContain("Create Schedule");
    expect(html).toContain("Run Setups / Weekly Plan");
    expect(html).toContain("Default HC · Synblast");
    expect(html).toContain("Auto-create: MIXED");
    expect(html).toContain("Auto ✓");
    expect(html).toContain("Auto ✗");
    expect(html).toContain("Add times");
    expect(html).toContain("Edit Run Setup");
    expect(html).toContain("Inactive");
    expect(html).toContain("Current Raid ID");
    expect(html).toContain("Next Raid ID");
    expect(html).toContain("19:45 · Default HC · Synblast");
    expect(html).toContain("Auto-create waiting");
    expect(html).toContain("Run Setup:");
    expect(html).toContain("Create Run");
  });

  it("hides ADMIN edit controls for RAID_LEAD read-only page", () => {
    const html = renderToStaticMarkup(
      createElement(ManageCommunityScheduleView, { page: samplePage(false) }),
    );
    expect(html).toContain("Current Raid ID");
    expect(html).toContain("19:45 · Default HC · Synblast");
    expect(html).toContain("Run Setups / Weekly Plan");
    expect(html).not.toContain("Create Schedule");
    expect(html).not.toContain("Add times");
    expect(html).not.toContain("Deactivate");
  });

  it("shows empty schedule state when no active slots", () => {
    const page = samplePage(true);
    page.current.days = [];
    page.next.days = [];
    page.slots = [];
    page.runSetups = [];
    const html = renderToStaticMarkup(createElement(ManageCommunityScheduleView, { page }));
    expect(html).toContain("No active schedule slots in this window.");
    expect(html).toContain("No run setups yet.");
  });
});
