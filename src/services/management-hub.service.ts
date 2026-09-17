import type { AuthenticatedUser } from "@/auth/authorization";
import {
  canManageRun,
  canManageUsers,
  canReviewBoosterAccess,
  getManagementNavItems,
  hasAdminAccess,
  hasRaidLeadAccess,
} from "@/auth/authorization";
import { boosterAccessRepository } from "@/repositories/booster-access.repository";
import { boosterQualificationRepository } from "@/repositories/booster-qualification.repository";
import { attendanceRepository } from "@/repositories/attendance.repository";
import { payoutRepository } from "@/repositories/payout.repository";
import { runRepository } from "@/repositories/run.repository";
import { userRepository } from "@/repositories/user.repository";
import {
  projectRunOperationalHandoff,
  type RunSettlementStage,
} from "@/services/run-operational-handoff";
import { getRunLifecycleCapabilities } from "@/services/run-state";

export type ManagementOverviewCard = {
  id: "runs" | "booster-access" | "users";
  title: string;
  description: string;
  href: string;
  cta: string;
  metrics: Array<{ label: string; value: number | string }>;
};

/**
 * Compact management hub metrics. Aggregates via repositories — Views never count rows.
 */
export const managementHubService = {
  async getOverview(user: AuthenticatedUser): Promise<{
    nav: ReturnType<typeof getManagementNavItems>;
    cards: ManagementOverviewCard[];
  }> {
    const nav = getManagementNavItems(user.accountRole);
    const cards: ManagementOverviewCard[] = [];

    if (hasRaidLeadAccess(user.accountRole)) {
      const runs = await runRepository.listManaged();
      const managed = runs.filter(
        (run) => canManageRun(user, run) && !run.archivedAt,
      );
      const runIds = managed.map((run) => run.id);
      const [attendanceByRunId, settlementByRunId] = await Promise.all([
        attendanceRepository.summarizeByRunIds(runIds),
        payoutRepository.listStatusByRunIds(runIds),
      ]);
      const canMarkPaid = hasAdminAccess(user.accountRole);
      let needsAttendance = 0;
      let readyToComplete = 0;
      let needsSettlement = 0;

      for (const run of managed) {
        const capabilities = getRunLifecycleCapabilities({
          status: run.status,
          signupsOpen: run.signupsOpen,
          hasSignupHistory: run.signups.length > 0,
          actorIsAdmin: canMarkPaid,
          archivedAt: run.archivedAt,
        });
        const attendance = attendanceByRunId.get(run.id) ?? { total: 0, unmarkedCount: 0 };
        const settlementStage: RunSettlementStage = settlementByRunId.get(run.id) ?? "NONE";
        const handoff = projectRunOperationalHandoff({
          status: run.status,
          hasRoster: Boolean(run.roster),
          publishedAt: run.roster?.publishedAt ?? null,
          draftSelectedCount: run.roster?.draftSelectedCount ?? 0,
          capabilities,
          attendance,
          settlementStage,
          canMarkPaid,
        });
        if (handoff.attention === "NEEDS_ATTENDANCE") needsAttendance += 1;
        if (handoff.attention === "READY_TO_COMPLETE") readyToComplete += 1;
        if (handoff.attention === "NEEDS_SETTLEMENT") needsSettlement += 1;
      }

      cards.push({
        id: "runs",
        title: "Runs",
        description: "Create drafts, open signups, and manage assigned operations.",
        href: "/manage/runs",
        cta: "Manage Runs",
        metrics: [
          { label: "Needs attendance", value: needsAttendance },
          { label: "Ready to complete", value: readyToComplete },
          { label: "Needs settlement", value: needsSettlement },
        ],
      });
    }

    if (canReviewBoosterAccess(user.accountRole)) {
      const [accessCounts, approvedQualificationCount] = await Promise.all([
        boosterAccessRepository.countByStatus(),
        boosterQualificationRepository.countApproved(),
      ]);
      cards.push({
        id: "booster-access",
        title: "Booster Access",
        description: "Review historical requests and grant qualifications after Discord review.",
        href: "/manage/booster-access",
        cta: "Manage Booster Access",
        metrics: [
          { label: "Legacy pending", value: accessCounts.PENDING },
          { label: "Approved qualifications", value: approvedQualificationCount },
        ],
      });
    }

    if (canManageUsers(user.accountRole)) {
      const roleCounts = await userRepository.countByRole();
      const total = roleCounts.USER + roleCounts.RAID_LEAD + roleCounts.ADMIN;
      cards.push({
        id: "users",
        title: "Users",
        description: "Browse accounts, inspect characters, and assign platform roles.",
        href: "/manage/users",
        cta: "Manage Users",
        metrics: [
          { label: "Total", value: total },
          { label: "Users", value: roleCounts.USER },
          { label: "Raid leads", value: roleCounts.RAID_LEAD },
          { label: "Admins", value: roleCounts.ADMIN },
        ],
      });
    }

    return { nav, cards };
  },
};
