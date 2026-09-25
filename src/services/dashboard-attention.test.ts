import { describe, expect, it } from "vitest";
import {
  projectDashboardOperations,
  projectPersonalDashboardAttention,
} from "@/services/dashboard-attention";
import { getRunLifecycleCapabilities } from "@/services/run-state";
import { projectRunOperationalHandoff } from "@/services/run-operational-handoff";
import type { MyRunsProjection } from "@/services/dashboard-attention";

function baseItem(overrides: Partial<MyRunsProjection["selected"][number]> = {}): MyRunsProjection["selected"][number] {
  return {
    id: "signup-1",
    runId: "run-a",
    runTitle: "Friday Heroic",
    productLabel: "Venomous Abyss",
    contentSummary: "8/8",
    difficulty: "HEROIC",
    scheduledStartAt: "2026-10-10T20:00:00.000Z",
    runStatus: "PUBLISHED",
    characterId: "char-1",
    characterName: "Synlight",
    characterRealm: "Thrall",
    offeredRoles: ["HEALER", "DPS"],
    publishedRole: "HEALER",
    participationType: "BOOSTER",
    isBackup: false,
    status: "SELECTED",
    lootbuddyClass: null,
    lootbuddyMode: null,
    lootbuddyVerification: null,
    canWithdraw: true,
    canWithdrawWithReason: false,
    scheduleConflicts: [],
    ...overrides,
  };
}

function emptyMyRuns(): MyRunsProjection {
  return { pending: [], selected: [], notSelected: [], withdrawn: [] };
}

describe("projectPersonalDashboardAttention", () => {
  it("projects next SELECTED Booster with published role, not offered roles", () => {
    const personal = projectPersonalDashboardAttention({
      ...emptyMyRuns(),
      selected: [baseItem()],
    });
    expect(personal.nextSelectedRun?.runId).toBe("run-a");
    expect(personal.nextSelectedRun?.commitments).toHaveLength(1);
    expect(personal.nextSelectedRun?.commitments[0]?.publishedRole).toBe("HEALER");
    expect(personal.nextSelectedRun?.commitments[0]?.characterName).toBe("Synlight");
    expect(personal.pendingCount).toBe(0);
    expect(personal.conflicts).toHaveLength(0);
  });

  it("PENDING-only yields no next selected and pendingCount 1", () => {
    const personal = projectPersonalDashboardAttention({
      ...emptyMyRuns(),
      pending: [baseItem({ id: "p1", status: "PENDING", publishedRole: null })],
    });
    expect(personal.nextSelectedRun).toBeNull();
    expect(personal.pendingCount).toBe(1);
  });

  it("surfaces SELECTED schedule conflicts", () => {
    const personal = projectPersonalDashboardAttention({
      ...emptyMyRuns(),
      selected: [
        baseItem({
          scheduleConflicts: [
            {
              source: "RUN_RESERVATION",
              conflictingRunId: "run-other",
              conflictingRunTitle: "Other Run",
              conflictingScheduledStartAt: "2026-10-10T19:00:00.000Z",
              message: "Another BoostingHub Run: Other Run at Fri 10/10/2026 21:00",
            },
          ],
        }),
      ],
    });
    expect(personal.conflicts).toHaveLength(1);
    expect(personal.conflicts[0]?.messages[0]).toContain("Other Run");
    expect(personal.nextSelectedRun?.hasScheduleConflict).toBe(true);
  });

  it("SELECTED without conflict still shows next run", () => {
    const personal = projectPersonalDashboardAttention({
      ...emptyMyRuns(),
      selected: [baseItem()],
    });
    expect(personal.conflicts).toHaveLength(0);
    expect(personal.nextSelectedRun).not.toBeNull();
  });

  it("picks earliest scheduled SELECTED Run", () => {
    const personal = projectPersonalDashboardAttention({
      ...emptyMyRuns(),
      selected: [
        baseItem({
          id: "later",
          runId: "run-b",
          runTitle: "Late",
          scheduledStartAt: "2026-10-10T22:00:00.000Z",
        }),
        baseItem({
          id: "earlier",
          runId: "run-a",
          runTitle: "Early",
          scheduledStartAt: "2026-10-10T20:00:00.000Z",
        }),
      ],
    });
    expect(personal.nextSelectedRun?.runId).toBe("run-a");
  });

  it("groups multiple SELECTED commitments on the same Run", () => {
    const personal = projectPersonalDashboardAttention({
      ...emptyMyRuns(),
      selected: [
        baseItem({ id: "booster", participationType: "BOOSTER", publishedRole: "HEALER" }),
        baseItem({
          id: "loot",
          participationType: "LOOTBUDDY",
          characterId: null,
          characterName: null,
          publishedRole: null,
          lootbuddyClass: "MAGE",
          lootbuddyMode: "LOOT_ONLY",
          scheduleConflicts: [],
        }),
      ],
    });
    expect(personal.nextSelectedRun?.runId).toBe("run-a");
    expect(personal.nextSelectedRun?.commitments).toHaveLength(2);
  });

  it("allows characterless Lootbuddy without conflict evaluation", () => {
    const personal = projectPersonalDashboardAttention({
      ...emptyMyRuns(),
      selected: [
        baseItem({
          participationType: "LOOTBUDDY",
          characterId: null,
          characterName: null,
          publishedRole: null,
          lootbuddyClass: "MAGE",
          lootbuddyMode: "LOOT_ONLY",
          scheduleConflicts: [],
        }),
      ],
    });
    expect(personal.nextSelectedRun?.commitments[0]?.participationType).toBe("LOOTBUDDY");
    expect(personal.conflicts).toHaveLength(0);
  });

  it("excludes COMPLETED / CANCELLED from next selected and pending", () => {
    const personal = projectPersonalDashboardAttention({
      ...emptyMyRuns(),
      selected: [baseItem({ runStatus: "COMPLETED" })],
      pending: [baseItem({ id: "p", status: "PENDING", runStatus: "CANCELLED", publishedRole: null })],
    });
    expect(personal.nextSelectedRun).toBeNull();
    expect(personal.pendingCount).toBe(0);
  });
});

describe("projectDashboardOperations", () => {
  function handoffRow(status: "IN_PROGRESS" | "COMPLETED", extras: {
    unmarkedCount?: number;
    settlementStage?: "NONE" | "DRAFT" | "FINALIZED" | "PAID";
    canMarkPaid?: boolean;
  }) {
    const realCaps = getRunLifecycleCapabilities({
      status,
      signupsOpen: false,
      actorIsAdmin: Boolean(extras.canMarkPaid),
      archivedAt: null,
    });
    const realHandoff = projectRunOperationalHandoff({
      status,
      hasRoster: true,
      publishedAt: "2026-01-01T00:00:00.000Z",
      draftSelectedCount: 2,
      capabilities: realCaps,
      attendance: { total: 2, unmarkedCount: extras.unmarkedCount ?? 0 },
      settlementStage: extras.settlementStage ?? "NONE",
      canMarkPaid: Boolean(extras.canMarkPaid),
    });
    return {
      run: {
        id: "run-1",
        title: "Ops Run",
        scheduledStartAt: "2026-10-10T20:00:00.000Z",
        difficulty: "HEROIC" as const,
        contentDisplay: { productLabel: "Venomous" },
      },
      handoff: realHandoff,
    };
  }

  it("projects NEEDS_ATTENDANCE for IN_PROGRESS with unmarked", () => {
    const { operations } = projectDashboardOperations({
      rows: [handoffRow("IN_PROGRESS", { unmarkedCount: 2 })],
      includeRosterWork: true,
      adminOnlyMarkPaid: false,
    });
    expect(operations[0]?.nextAction.kind).toBe("ATTENDANCE");
    expect(operations[0]?.unmarkedCount).toBe(2);
  });

  it("projects COMPLETE when unmarked is zero", () => {
    const { operations } = projectDashboardOperations({
      rows: [handoffRow("IN_PROGRESS", { unmarkedCount: 0 })],
      includeRosterWork: true,
      adminOnlyMarkPaid: false,
    });
    expect(operations[0]?.nextAction.kind).toBe("COMPLETE");
  });

  it("projects REVIEW_PAYOUT for DRAFT settlement", () => {
    const { operations } = projectDashboardOperations({
      rows: [handoffRow("COMPLETED", { settlementStage: "DRAFT" })],
      includeRosterWork: true,
      adminOnlyMarkPaid: false,
    });
    expect(operations[0]?.nextAction.kind).toBe("REVIEW_PAYOUT");
  });

  it("does not expose Mark Paid to RAID_LEAD", () => {
    const { operations, adminMarkPaid } = projectDashboardOperations({
      rows: [handoffRow("COMPLETED", { settlementStage: "FINALIZED", canMarkPaid: false })],
      includeRosterWork: true,
      adminOnlyMarkPaid: false,
    });
    expect(operations.every((row) => row.nextAction.kind !== "MARK_PAID")).toBe(true);
    expect(adminMarkPaid).toHaveLength(0);
  });

  it("surfaces Mark Paid for ADMIN FINALIZED", () => {
    const { adminMarkPaid } = projectDashboardOperations({
      rows: [handoffRow("COMPLETED", { settlementStage: "FINALIZED", canMarkPaid: true })],
      includeRosterWork: true,
      adminOnlyMarkPaid: true,
    });
    expect(adminMarkPaid[0]?.nextAction.kind).toBe("MARK_PAID");
  });

  it("excludes PAID from Mark Paid attention", () => {
    const { adminMarkPaid, operations } = projectDashboardOperations({
      rows: [handoffRow("COMPLETED", { settlementStage: "PAID", canMarkPaid: true })],
      includeRosterWork: true,
      adminOnlyMarkPaid: true,
    });
    expect(adminMarkPaid).toHaveLength(0);
    expect(operations).toHaveLength(0);
  });
});
