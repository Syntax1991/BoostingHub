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
    label: "HC VIP",
    notes: null,
    raidLeadId: "lead-1",
    raidLeadName: "Synblast",
    raidLeadEligible: true,
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
  };
  return {
    canEdit,
    timeZone: "Europe/Berlin",
    current: {
      window: "CURRENT",
      windowStart: "2026-01-14T05:00:00.000Z",
      windowEnd: "2026-01-21T05:00:00.000Z",
      days: [
        {
          localDate: "2026-01-16",
          weekday: "FRIDAY",
          slots: [{ slot, occurrence }],
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
            },
          ],
        },
      ],
    },
    slots: [
      slot,
      {
        ...slot,
        id: "slot-inactive",
        isActive: false,
        label: "Old Slot",
      },
    ],
    eligibleRaidLeads: [{ id: "lead-1", name: "Synblast" }],
  };
}

describe("ManageCommunityScheduleView", () => {
  it("renders Current and Next Raid ID sections with chronological slots", () => {
    const html = renderToStaticMarkup(
      createElement(ManageCommunityScheduleView, { page: samplePage(true) }),
    );
    expect(html).toContain("Current Raid ID");
    expect(html).toContain("Next Raid ID");
    expect(html).toContain("19:45 · HC VIP · Synblast");
    expect(html).toContain("Add Schedule Slot");
    expect(html).toContain("Inactive slots");
    expect(html).toContain("Old Slot");
  });

  it("hides ADMIN edit controls for RAID_LEAD read-only page", () => {
    const html = renderToStaticMarkup(
      createElement(ManageCommunityScheduleView, { page: samplePage(false) }),
    );
    expect(html).toContain("Current Raid ID");
    expect(html).toContain("19:45 · HC VIP · Synblast");
    expect(html).not.toContain("Add Schedule Slot");
    expect(html).not.toContain("Inactive slots");
    expect(html).not.toContain("Deactivate");
  });

  it("shows empty schedule state when no active slots", () => {
    const page = samplePage(true);
    page.current.days = [];
    page.next.days = [];
    page.slots = [];
    const html = renderToStaticMarkup(createElement(ManageCommunityScheduleView, { page }));
    expect(html).toContain("No active schedule slots in this window.");
  });
});
