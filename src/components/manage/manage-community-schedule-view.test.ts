import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ManageCommunityScheduleView } from "@/components/manage/manage-community-schedule-view";
import type { CommunitySchedulePage } from "@/services/community-schedule.service";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/controllers/community-schedule.actions", () => ({
  updateCommunityScheduleRunSetupAction: vi.fn(),
  createCommunitySchedulePlanAction: vi.fn(),
  createCommunityScheduleRunSetupAction: vi.fn(),
  duplicateCommunityScheduleRunSetupAction: vi.fn(),
  addCommunityScheduleTimesAction: vi.fn(),
  materializeCommunityScheduleOccurrenceAction: vi.fn(),
  createCommunityScheduleSlotAction: vi.fn(),
  updateCommunityScheduleSlotAction: vi.fn(),
  deactivateCommunityScheduleSlotAction: vi.fn(),
  reactivateCommunityScheduleSlotAction: vi.fn(),
  deleteCommunityScheduleSlotAction: vi.fn(),
  deleteCommunityScheduleRunSetupAction: vi.fn(),
}));

function samplePage(canEdit: boolean): CommunitySchedulePage {
  const slot = {
    id: "slot-1",
    weekday: "FRIDAY" as const,
    localStartTime: "19:45",
    label: "Default HC",
    notes: null,
    raidLeadId: "lead-1",
    raidLeadName: "Synblast",
    raidLeadDiscordUserId: null,
    raidLeadEligible: true,
    runTemplateId: "template-1",
    autoCreateRun: true,
    runMode: "INHOUSE" as const,
    runTemplateName: "Default HC",
    compositionOverrideEnabled: false,
    desiredTankCountOverride: null,
    desiredHealerCountOverride: null,
    desiredDpsCountOverride: null,
    desiredLootbuddyCountOverride: null,
    isActive: true,
    createdById: "admin-1",
    updatedById: "admin-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const setupSlotExtras = {
    compositionOverrideEnabled: false,
    effectiveComposition: {
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      desiredLootbuddyCount: 0,
    },
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
    runSetupInventory: [
      {
        id: "template-1",
        name: "Default HC",
        productLabel: "The Venomous Abyss",
        titleCoverage: "8/8",
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        desiredLootbuddyCount: 0,
        notes: null,
        isActive: true,
        usable: true,
        unusableReason: null,
        slotCount: 3,
        contentPreset: "VENOMOUS_ABYSS",
        venomousPlannedBossCount: 8,
        canEdit,
        canDelete: canEdit,
      },
      {
        id: "template-zero",
        name: "Zero Slot Setup",
        productLabel: "Season 2 Bundle",
        titleCoverage: "9/9",
        difficulty: "HEROIC",
        lootType: "VIP",
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        desiredLootbuddyCount: 0,
        notes: null,
        isActive: true,
        usable: true,
        unusableReason: null,
        slotCount: 0,
        contentPreset: "MIDNIGHT_S2_BUNDLE",
        venomousPlannedBossCount: 8,
        canEdit,
        canDelete: canEdit,
      },
    ],
    runSetups: [
      {
        key: "template-1:lead-1",
        runTemplateId: "template-1",
        runSetupName: "HC Unsaved · The Venomous Abyss",
        raidLeadId: "lead-1",
        raidLeadName: "Synblast",
        autoCreateSummary: "MIXED" as const,
        canEdit,
        slotCount: 3,
        canDelete: canEdit,
        slots: [
          {
            id: "slot-1",
            weekday: "FRIDAY" as const,
            localStartTime: "19:45",
            isActive: true,
            autoCreateRun: true,
            runMode: "INHOUSE" as const,
            label: "Default HC",
            notes: null,
            canDelete: canEdit,
            ...setupSlotExtras,
          },
          {
            id: "slot-2",
            weekday: "SATURDAY" as const,
            localStartTime: "20:00",
            isActive: true,
            autoCreateRun: false,
            runMode: "TEAM_RUN" as const,
            label: "Default HC",
            notes: null,
            canDelete: canEdit,
            ...setupSlotExtras,
          },
          {
            id: "slot-inactive",
            weekday: "SUNDAY" as const,
            localStartTime: "18:00",
            isActive: false,
            autoCreateRun: false,
            runMode: "INHOUSE" as const,
            label: "Default HC",
            notes: null,
            canDelete: canEdit,
            ...setupSlotExtras,
          },
        ],
      },
    ],
    templates: [
      {
        id: "template-1",
        label: "Default HC · HC Unsaved 8/8 · The Venomous Abyss",
        usable: true,
        unusableReason: null,
        name: "Default HC",
        contentPreset: "VENOMOUS_ABYSS" as const,
        venomousPlannedBossCount: 8,
        productLabel: "The Venomous Abyss",
        titleCoverage: "8/8",
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        desiredLootbuddyCount: 0,
        notes: null,
      },
      {
        id: "template-zero",
        label: "Zero Slot Setup · HC VIP 9/9 · Season 2 Bundle",
        usable: true,
        unusableReason: null,
        name: "Zero Slot Setup",
        contentPreset: "MIDNIGHT_S2_BUNDLE" as const,
        venomousPlannedBossCount: 8,
        productLabel: "Season 2 Bundle",
        titleCoverage: "9/9",
        difficulty: "HEROIC",
        lootType: "VIP",
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        desiredLootbuddyCount: 0,
        notes: null,
      },
    ],
    contentPresets: [
      { key: "VENOMOUS_ABYSS", displayName: "The Venomous Abyss" },
      { key: "MIDNIGHT_S2_BUNDLE", displayName: "Season 2 Bundle" },
    ],
    venomousBossMax: 8,
    share: { text: "share", warnings: [] },
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
  it("renders Run Setup inventory, Weekly Plan, Create Run Setup, and windows", () => {
    const html = renderToStaticMarkup(
      createElement(ManageCommunityScheduleView, { page: samplePage(true) }),
    );
    expect(html).toContain("Create Run Setup");
    expect(html).toContain("Create Schedule");
    expect(html).toContain("Share Schedule");
    expect(html).toContain("Run Setups");
    expect(html).toContain("Weekly Plan");
    expect(html).toContain("Zero Slot Setup");
    expect(html).toContain("Duplicate");
    expect(html).toContain("Inhouse");
    expect(html).toContain("Team Run");
    expect(html).toContain("Auto-create: MIXED");
    expect(html).toContain("Add times");
    expect(html).toContain("Delete");
    expect(html).toContain("Deactivate");
    expect(html).toContain("Reactivate");
    expect(html).toContain("Current Raid ID");
    expect(html).toContain("Next Raid ID");
    expect(html).toContain("Auto-create waiting");
    expect(html).toContain("Create Run");
  });

  it("hides ADMIN edit controls for RAID_LEAD read-only page", () => {
    const html = renderToStaticMarkup(
      createElement(ManageCommunityScheduleView, { page: samplePage(false) }),
    );
    expect(html).toContain("Current Raid ID");
    expect(html).toContain("Run Setups");
    expect(html).toContain("Weekly Plan");
    expect(html).not.toContain("Create Schedule");
    expect(html).not.toContain("Create Run Setup");
    expect(html).not.toContain("Add times");
    expect(html).not.toContain("Duplicate");
    expect(html).not.toContain("Deactivate");
  });

  it("shows empty schedule state when no active slots", () => {
    const page = samplePage(true);
    page.current.days = [];
    page.next.days = [];
    page.slots = [];
    page.runSetups = [];
    page.runSetupInventory = [];
    const html = renderToStaticMarkup(createElement(ManageCommunityScheduleView, { page }));
    expect(html).toContain("No Run Setups yet.");
    expect(html).toContain("No weekly times yet.");
  });
});
