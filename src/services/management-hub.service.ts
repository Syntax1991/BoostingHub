import type { AuthenticatedUser } from "@/auth/authorization";
import { characterOperationsService } from "@/services/character-operations.service";
import { parseCharacterOperationsFilters } from "@/validators/character-operations";
import {
  canManageCharacterOperations,
  canManageUsers,
  canReviewBoosterAccess,
  getManagementNavItems,
  hasRaidLeadAccess,
} from "@/auth/authorization";
import { boosterAccessRepository } from "@/repositories/booster-access.repository";
import { boosterQualificationRepository } from "@/repositories/booster-qualification.repository";
import { userRepository } from "@/repositories/user.repository";
import { listManagedRunOperationalHandoffs } from "@/services/managed-run-operational.service";

export type ManagementOverviewCard = {
  id: "runs" | "booster-access" | "users" | "characters";
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
      const projected = await listManagedRunOperationalHandoffs(user);
      let needsAttendance = 0;
      let readyToComplete = 0;
      let needsSettlement = 0;
      for (const row of projected) {
        if (row.handoff.attention === "NEEDS_ATTENDANCE") needsAttendance += 1;
        if (row.handoff.attention === "READY_TO_COMPLETE") readyToComplete += 1;
        if (row.handoff.attention === "NEEDS_SETTLEMENT") needsSettlement += 1;
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
      const total = roleCounts.USER + roleCounts.RAID_LEAD + roleCounts.ADMIN + roleCounts.OWNER;
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
          // Admin-level accounts: Admins plus the Platform Owner.
          { label: "Admins", value: roleCounts.ADMIN + roleCounts.OWNER },
        ],
      });
    }

    if (canManageCharacterOperations(user.accountRole)) {
      const { summary } = await characterOperationsService.getListPage(user, parseCharacterOperationsFilters({}));
      cards.push({
        id: "characters",
        title: "Characters",
        description: "All characters, Blizzard sync health, lockouts, and admin sync controls.",
        href: "/manage/characters",
        cta: "Manage Characters",
        metrics: [
          { label: "Active", value: summary.active },
          { label: "Sync errors", value: summary.errors },
          { label: "Stale", value: summary.stale },
          { label: "No connection", value: summary.noConnection },
        ],
      });
    }

    return { nav, cards };
  },
};
