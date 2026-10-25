/**
 * Pure helpers: Create Run form → authoritative createSchedulePlan payload.
 * No React / no DB — unit-testable.
 */
import type { CommunityWeekday, RaidDifficulty, RunLootType } from "@/models/enums";
import type { ProductSelection } from "@/lib/product-selection";
import type { ScheduleStartState } from "@/components/manage/community-schedule-start-fields";
import { scheduleStartPayload } from "@/components/manage/community-schedule-start-fields";
import type { CreateSchedulePlanInput } from "@/validators/community-schedule";
import { DIFFICULTY_ABBREVIATIONS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";

export type CreateRunRecurringFormState = {
  /** Existing Run Setup template id from Create Run "Use a template", or "". */
  templateId: string;
  /** Required when creating a new Run Setup (no template). */
  setupName: string;
  product: ProductSelection;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  raidLeadId: string;
  notes: string;
  desiredTankCount: number;
  desiredHealerCount: number;
  desiredDpsCount: number;
  desiredLootbuddyCount: number;
  discordRolePing: boolean;
  weekday: CommunityWeekday;
  localStartTime: string;
  start: ScheduleStartState;
  /** Existing Schedule auto-create flag — false = planning only (default). */
  autoCreateRun: boolean;
};

export type CreateRunRecurringBuildResult =
  | { ok: true; payload: CreateSchedulePlanInput }
  | { ok: false; message: string };

/** Default Run Setup name when Create Run invents a new setup for the Schedule. */
export function defaultRecurringSetupName(input: {
  productName: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
}): string {
  const product = input.productName.trim() || "Run";
  return `${product} ${DIFFICULTY_ABBREVIATIONS[input.difficulty]} ${RUN_LOOT_TYPE_LABELS[input.lootType]}`.slice(
    0,
    80,
  );
}

/**
 * Maps Create Run shared defaults + recurring WHEN fields into createSchedulePlan.
 * One-time row datetimes / multi-run overrides are intentionally ignored.
 */
export function buildCreateSchedulePlanFromCreateRun(
  state: CreateRunRecurringFormState,
): CreateRunRecurringBuildResult {
  if (!state.raidLeadId) {
    return { ok: false, message: "Choose an eligible raid lead." };
  }
  if (!state.product.productId) {
    return { ok: false, message: "Choose a product." };
  }
  if (!/^\d{2}:\d{2}$/.test(state.localStartTime.trim())) {
    return { ok: false, message: "Use HH:mm (24-hour) for the weekly time." };
  }
  if (state.start.mode === "FROM_DATE" && !/^\d{4}-\d{2}-\d{2}$/.test(state.start.date)) {
    return { ok: false, message: "Choose a start date." };
  }

  const usingExistingSetup = Boolean(state.templateId);
  if (!usingExistingSetup) {
    const name = state.setupName.trim();
    if (!name) {
      return { ok: false, message: "Enter a name for the Run Setup." };
    }
  }

  const runSetup: CreateSchedulePlanInput["runSetup"] = usingExistingSetup
    ? { mode: "existing", templateId: state.templateId }
    : {
        mode: "create",
        name: state.setupName.trim(),
        productId: state.product.productId,
        contentBossCounts: state.product.contentBossCounts,
        difficulty: state.difficulty,
        lootType: state.lootType,
        desiredTankCount: state.desiredTankCount,
        desiredHealerCount: state.desiredHealerCount,
        desiredDpsCount: state.desiredDpsCount,
        desiredLootbuddyCount: state.desiredLootbuddyCount,
        notes: state.notes.trim() || null,
      };

  const payload: CreateSchedulePlanInput = {
    scheduleSource: "setup",
    raidLeadId: state.raidLeadId,
    runSetup,
    slots: [
      {
        weekday: state.weekday,
        localStartTime: state.localStartTime.trim(),
        runMode: "INHOUSE",
      },
    ],
    autoCreateRun: state.autoCreateRun,
    discordRolePing: state.discordRolePing,
    start: scheduleStartPayload(state.start),
    notes: state.notes.trim() || null,
    // Composition lives on the new Run Setup; slot inherits (no override).
    compositionOverrideEnabled: false,
  };

  return { ok: true, payload };
}
