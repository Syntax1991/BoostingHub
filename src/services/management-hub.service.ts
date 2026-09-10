import type { AuthenticatedUser } from "@/auth/authorization";
import {
  canManageUsers,
  canReviewBoosterAccess,
  getManagementNavItems,
} from "@/auth/authorization";
import { boosterAccessRepository } from "@/repositories/booster-access.repository";
import { runRepository } from "@/repositories/run.repository";
import { userRepository } from "@/repositories/user.repository";

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

    const runCounts = await runRepository.countByStatuses();
    const upcoming =
      (runCounts.OPEN ?? 0) + (runCounts.ROSTERING ?? 0) + (runCounts.PUBLISHED ?? 0);
    const rosterWork = (runCounts.OPEN ?? 0) + (runCounts.ROSTERING ?? 0);
    const active =
      (runCounts.OPEN ?? 0) +
      (runCounts.ROSTERING ?? 0) +
      (runCounts.PUBLISHED ?? 0) +
      (runCounts.IN_PROGRESS ?? 0);

    cards.push({
      id: "runs",
      title: "Runs",
      description: "Create drafts, open signups, and manage assigned operations.",
      href: "/manage/runs",
      cta: "Manage Runs",
      metrics: [
        { label: "Upcoming / open", value: upcoming },
        { label: "Roster work", value: rosterWork },
        { label: "Active", value: active },
      ],
    });

    if (canReviewBoosterAccess(user.accountRole)) {
      const accessCounts = await boosterAccessRepository.countByStatus();
      cards.push({
        id: "booster-access",
        title: "Booster Access",
        description: "Review historical requests and grant qualifications after Discord review.",
        href: "/manage/booster-access",
        cta: "Manage Booster Access",
        metrics: [
          { label: "Pending reviews", value: accessCounts.PENDING },
          { label: "Approved", value: accessCounts.APPROVED },
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
