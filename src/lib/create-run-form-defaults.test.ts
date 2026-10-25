import { describe, expect, it } from "vitest";
import {
  CREATE_RUN_OPT_IN_DEFAULTS,
  createRunOptInInitialState,
  withDiscordRolePingOptIn,
  withRecurringOptIn,
} from "@/lib/create-run-form-defaults";
import { buildCreateSchedulePlanFromCreateRun } from "@/lib/create-run-recurring";
import { DEFAULT_SCHEDULE_START } from "@/components/manage/community-schedule-start-fields";

describe("Create Run opt-in defaults", () => {
  it("defaults recurring and Discord role ping to false (one-time quiet draft path)", () => {
    expect(CREATE_RUN_OPT_IN_DEFAULTS.asRecurring).toBe(false);
    expect(CREATE_RUN_OPT_IN_DEFAULTS.discordRolePing).toBe(false);

    const initial = createRunOptInInitialState();
    expect(initial.asRecurring).toBe(false);
    expect(initial.discordRolePing).toBe(false);
  });

  it("honors an explicit form discordRolePing default without enabling recurring", () => {
    const initial = createRunOptInInitialState(true);
    expect(initial.discordRolePing).toBe(true);
    expect(initial.asRecurring).toBe(false);
  });

  it("enabling recurring does not enable Discord role ping", () => {
    const next = withRecurringOptIn(createRunOptInInitialState(), true);
    expect(next.asRecurring).toBe(true);
    expect(next.discordRolePing).toBe(false);
  });

  it("enabling Discord role ping does not enable recurring", () => {
    const next = withDiscordRolePingOptIn(createRunOptInInitialState(), true);
    expect(next.discordRolePing).toBe(true);
    expect(next.asRecurring).toBe(false);
  });

  it("both can be enabled independently", () => {
    const next = withDiscordRolePingOptIn(withRecurringOptIn(createRunOptInInitialState(), true), true);
    expect(next).toEqual({ asRecurring: true, discordRolePing: true });
  });

  it("recurring Schedule payload requires explicit discordRolePing opt-in (false stays false)", () => {
    const result = buildCreateSchedulePlanFromCreateRun({
      templateId: "",
      setupName: "Weekly HC",
      product: { productId: "11111111-1111-4111-8111-111111111111", contentBossCounts: {} },
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      raidLeadId: "22222222-2222-4222-8222-222222222222",
      notes: "",
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      desiredLootbuddyCount: 0,
      discordRolePing: false,
      weekday: "FRIDAY",
      localStartTime: "19:45",
      start: DEFAULT_SCHEDULE_START,
      autoCreateRun: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.discordRolePing).toBe(false);
  });
});
