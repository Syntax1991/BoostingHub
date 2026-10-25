import { describe, expect, it } from "vitest";
import { createSchedulePlanSchema } from "@/validators/community-schedule";
import {
  buildCreateSchedulePlanFromCreateRun,
  defaultRecurringSetupName,
  type CreateRunRecurringFormState,
} from "@/lib/create-run-recurring";
import { DEFAULT_SCHEDULE_START } from "@/components/manage/community-schedule-start-fields";

function baseState(overrides: Partial<CreateRunRecurringFormState> = {}): CreateRunRecurringFormState {
  return {
    templateId: "",
    setupName: "Manaforge HC weekly",
    product: { productId: "11111111-1111-4111-8111-111111111111", contentBossCounts: {} },
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    raidLeadId: "22222222-2222-4222-8222-222222222222",
    notes: "from create run",
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
    desiredLootbuddyCount: 0,
    discordRolePing: false,
    weekday: "TUESDAY",
    localStartTime: "19:00",
    start: DEFAULT_SCHEDULE_START,
    autoCreateRun: false,
    ...overrides,
  };
}

describe("buildCreateSchedulePlanFromCreateRun", () => {
  it("builds a setup-source Schedule plan that creates a new Run Setup (no template)", () => {
    const result = buildCreateSchedulePlanFromCreateRun(baseState());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.scheduleSource).toBe("setup");
    expect(result.payload.slots).toEqual([
      { weekday: "TUESDAY", localStartTime: "19:00", runMode: "INHOUSE" },
    ]);
    expect(result.payload.autoCreateRun).toBe(false);
    expect(result.payload.raidLeadId).toBe("22222222-2222-4222-8222-222222222222");
    expect(result.payload.discordRolePing).toBe(false);
    expect(result.payload.runSetup).toMatchObject({
      mode: "create",
      name: "Manaforge HC weekly",
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    });
    expect(result.payload.compositionOverrideEnabled).toBe(false);
    // Payload must satisfy the authoritative Schedule validator.
    expect(() => createSchedulePlanSchema.parse(result.payload)).not.toThrow();
  });

  it("reuses an existing template as Run Setup without inventing product fields", () => {
    const result = buildCreateSchedulePlanFromCreateRun(
      baseState({ templateId: "33333333-3333-4333-8333-333333333333", setupName: "" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.runSetup).toEqual({
      mode: "existing",
      templateId: "33333333-3333-4333-8333-333333333333",
    });
    expect(() => createSchedulePlanSchema.parse(result.payload)).not.toThrow();
  });

  it("does not include one-time absolute datetimes or multi-run rows", () => {
    const result = buildCreateSchedulePlanFromCreateRun(baseState());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const json = JSON.stringify(result.payload);
    expect(json).not.toMatch(/scheduledStartAt|datetime-local|2026-/);
    expect(result.payload.slots).toHaveLength(1);
  });

  it("rejects missing setup name when inventing a Run Setup", () => {
    const result = buildCreateSchedulePlanFromCreateRun(baseState({ setupName: "  " }));
    expect(result).toEqual({ ok: false, message: "Enter a name for the Run Setup." });
  });

  it("rejects invalid weekly time", () => {
    const result = buildCreateSchedulePlanFromCreateRun(baseState({ localStartTime: "7pm" }));
    expect(result.ok).toBe(false);
  });

  it("maps FROM_DATE start through existing Schedule start payload", () => {
    const result = buildCreateSchedulePlanFromCreateRun(
      baseState({ start: { mode: "FROM_DATE", date: "2026-10-01" } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.start).toEqual({ mode: "FROM_DATE", date: "2026-10-01" });
  });

  it("defaults autoCreateRun off so Schedule create does not duplicate concrete Runs", () => {
    const result = buildCreateSchedulePlanFromCreateRun(baseState());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.autoCreateRun).toBe(false);
  });

  it("passes through explicit Discord role ping opt-in when checked", () => {
    const result = buildCreateSchedulePlanFromCreateRun(baseState({ discordRolePing: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.discordRolePing).toBe(true);
  });
});

describe("defaultRecurringSetupName", () => {
  it("builds a short Run Setup label from product + difficulty + loot", () => {
    expect(
      defaultRecurringSetupName({
        productName: "Manaforge Omega",
        difficulty: "HEROIC",
        lootType: "UNSAVED",
      }),
    ).toContain("Manaforge Omega");
  });
});

describe("one-time vs recurring state isolation", () => {
  it("recurring payload ignores fields that only exist on one-time mass-create rows", () => {
    // Simulate leftover one-time form values that must never enter Schedule create.
    const leaked = {
      rows: [{ scheduledLocal: "2026-09-10T21:00", overrides: { difficulty: "MYTHIC" as const } }],
      maxRuns: 25,
    };
    const result = buildCreateSchedulePlanFromCreateRun(baseState({ difficulty: "HEROIC" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.runSetup).toMatchObject({ mode: "create", difficulty: "HEROIC" });
    expect(JSON.stringify(result.payload)).not.toContain("MYTHIC");
    expect(leaked.rows[0]!.overrides.difficulty).toBe("MYTHIC"); // still local only
  });
});
