import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CreateManyRunsForm } from "@/services/run.service";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/controllers/run.actions", () => ({
  createManyRunsAction: vi.fn(),
}));

vi.mock("@/controllers/community-schedule.actions", () => ({
  createCommunitySchedulePlanAction: vi.fn(),
}));

import { RunCreationForm } from "@/components/runs/run-creation-form";

function minimalForm(overrides: Partial<CreateManyRunsForm> = {}): CreateManyRunsForm {
  return {
    actorRole: "ADMIN",
    canAssignRaidLead: true,
    canCreateSchedule: true,
    defaultRaidLeadId: "lead-1",
    defaultRaidLeadName: "Lead",
    products: [
      {
        id: "prod-1",
        name: "Test Product",
        contents: [{ contentId: "c1", name: "Raid", maxBosses: 8, sortOrder: 0 }],
      },
    ],
    raidLeads: [{ id: "lead-1", name: "Lead", displayName: "Lead", accountRole: "ADMIN" }],
    templates: [],
    maxRuns: 25,
    defaults: {
      productId: "prod-1",
      contentBossCounts: { c1: 8 },
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      scheduledStartAt: "2026-10-26T19:00:00.000Z",
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      desiredLootbuddyCount: 0,
      discordRolePing: false,
    },
    ...overrides,
  } as CreateManyRunsForm;
}

describe("RunCreationForm opt-in defaults", () => {
  it("renders recurring and Discord ping unchecked; one-time Runs list is the default path", () => {
    const html = renderToStaticMarkup(createElement(RunCreationForm, { form: minimalForm() }));

    expect(html).toContain("Create as recurring schedule");
    expect(html).toContain("Ping Discord roles");
    expect(html).toContain("Runs (1/25)");
    expect(html).not.toContain("Weekly schedule");
    expect(html).toMatch(/Create 1 Draft|Create Draft/i);

    // Both checkboxes present and unchecked in the initial markup.
    const recurringInput = html.match(
      /aria-label="Create as recurring schedule"[^>]*>/,
    )?.[0];
    const pingInput = html.match(
      /aria-label="Ping Tank, Healer, and DPS Discord roles"[^>]*>/,
    )?.[0];
    expect(recurringInput).toBeTruthy();
    expect(pingInput).toBeTruthy();
    expect(recurringInput).not.toContain("checked");
    expect(pingInput).not.toContain("checked");
  });
});
