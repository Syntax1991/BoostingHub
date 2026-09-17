import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardView } from "@/components/dashboard/dashboard-view";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const emptyDashboard = {
  personal: {
    conflicts: [],
    nextSelectedRun: null,
    pendingCount: 0,
  },
  operations: [],
  adminMarkPaid: [],
  showOperations: false,
  isAdmin: false,
  upcomingRuns: [],
  characters: {
    activeCount: 0,
    totalCount: 0,
    boosterEligibleCount: 0,
    lockoutAttentionCount: 0,
    lockoutAttention: [],
  },
  recentActivity: [],
};

describe("DashboardView", () => {
  it("renders calm empty personal state for a brand-new USER", () => {
    const html = renderToStaticMarkup(createElement(DashboardView, { data: emptyDashboard as never }));
    expect(html).toContain("No personal conflicts need attention.");
    expect(html).toContain("No selected upcoming run.");
    expect(html).toContain("Pending: 0");
    expect(html).not.toContain("Operations");
    expect(html).not.toContain("Admin attention");
    expect(html).not.toContain("My Upcoming Runs");
  });

  it("renders next selected published role and conflict attention", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardView, {
        data: {
          ...emptyDashboard,
          personal: {
            conflicts: [
              {
                signupId: "s1",
                runId: "run-1",
                runTitle: "Friday Heroic",
                scheduledStartAt: "2026-10-10T20:00:00.000Z",
                characterName: "Synlight",
                publishedRole: "HEALER",
                messages: ["Phoenix commitment overlaps"],
              },
            ],
            nextSelectedRun: {
              runId: "run-1",
              runTitle: "Friday Heroic",
              productLabel: "Venomous Abyss",
              contentSummary: "8/8",
              difficulty: "HEROIC",
              scheduledStartAt: "2026-10-10T20:00:00.000Z",
              runStatus: "PUBLISHED",
              hasScheduleConflict: true,
              commitments: [
                {
                  signupId: "s1",
                  participationType: "BOOSTER",
                  characterId: "c1",
                  characterName: "Synlight",
                  publishedRole: "HEALER",
                  isBackup: false,
                  lootbuddyClass: null,
                  lootbuddyMode: null,
                  scheduleConflicts: [
                    {
                      source: "MANUAL_AVAILABILITY",
                      blockId: "b1",
                      startsAt: "2026-10-10T19:00:00.000Z",
                      endsAt: "2026-10-10T23:00:00.000Z",
                      reason: "Phoenix",
                      message: "Phoenix commitment overlaps",
                    },
                  ],
                },
              ],
            },
            pendingCount: 2,
          },
        } as never,
      }),
    );
    expect(html).toContain("Synlight · Healer");
    expect(html).toContain("Schedule conflict");
    expect(html).toContain("Pending: 2");
    expect(html).toContain("/runs/run-1");
    expect(html).toContain("/my-runs");
    expect(html).not.toContain("HEALER + DPS");
  });

  it("renders RAID_LEAD operations and ADMIN Mark Paid", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardView, {
        data: {
          ...emptyDashboard,
          showOperations: true,
          isAdmin: true,
          operations: [
            {
              runId: "run-att",
              runTitle: "In Progress",
              scheduledStartAt: "2026-10-10T20:00:00.000Z",
              difficulty: "HEROIC",
              productLabel: "Venomous",
              attention: "NEEDS_ATTENDANCE",
              nextAction: { kind: "ATTENDANCE", label: "Mark Attendance", mode: "link", tab: "attendance" },
              unmarkedCount: 2,
              settlementStage: "NONE",
              priority: 20,
            },
          ],
          adminMarkPaid: [
            {
              runId: "run-pay",
              runTitle: "Finalized Payout",
              scheduledStartAt: "2026-10-09T20:00:00.000Z",
              difficulty: "HEROIC",
              productLabel: "Venomous",
              attention: "NEEDS_SETTLEMENT",
              nextAction: { kind: "MARK_PAID", label: "Mark Paid", mode: "link", tab: "payout" },
              unmarkedCount: 0,
              settlementStage: "FINALIZED",
              priority: 10,
            },
          ],
        } as never,
      }),
    );
    expect(html).toContain("Mark Attendance");
    expect(html).toContain("2 unmarked");
    expect(html).toContain("tab=attendance");
    expect(html).toContain("Mark paid · Finalized Payout");
    expect(html).toContain("tab=payout");
  });
});
