import type { AuthenticatedUser } from "@/auth/authorization";
import { characterOperationsService } from "@/services/character-operations.service";
import { parseCharacterOperationsFilters } from "@/validators/character-operations";
import {
  canManageCharacterOperations,
  canManageUsers,
  canManageBoostingRoles,
  getManagementNavItems,
  hasAdminAccess,
  hasRaidLeadAccess,
} from "@/auth/authorization";
import { boosterAccessRepository } from "@/repositories/booster-access.repository";
import { userRepository } from "@/repositories/user.repository";
import {
  communityStatsService,
  type CommunityStats,
} from "@/services/community-stats.service";
import { listManagedRunOperationalHandoffs } from "@/services/managed-run-operational.service";
import { operationalAnalyticsService } from "@/services/operational-analytics.service";
import { systemHealthService } from "@/services/system-health.service";

export type ManagementOverviewCard = {
  id: "runs" | "users" | "characters" | "system" | "analytics";
  title: string;
  description: string;
  href: string;
  cta: string;
  metrics: Array<{ label: string; value: number | string }>;
};

export type ManagementOverview = {
  nav: ReturnType<typeof getManagementNavItems>;
  cards: ManagementOverviewCard[];
  /**
   * Community / Booster Coverage. ADMIN / OWNER only.
   * RAID_LEAD keeps the Overview route but never receives this payload.
   */
  communityStats: CommunityStats | null;
};

function countSystemProviderStates(
  providers: Array<{ state: string }>,
): { healthy: number; degraded: number; down: number } {
  let healthy = 0;
  let degraded = 0;
  let down = 0;
  for (const provider of providers) {
    if (provider.state === "HEALTHY") healthy += 1;
    else if (provider.state === "DEGRADED") degraded += 1;
    else if (provider.state === "DOWN") down += 1;
  }
  return { healthy, degraded, down };
}

/**
 * Compact management hub metrics. Aggregates via repositories — Views never count rows.
 */
export const managementHubService = {
  async getOverview(user: AuthenticatedUser): Promise<ManagementOverview> {
    const nav = getManagementNavItems(user.accountRole);
    const isAdmin = hasAdminAccess(user.accountRole);
    const cards: ManagementOverviewCard[] = [];

    const runsPromise = hasRaidLeadAccess(user.accountRole)
      ? listManagedRunOperationalHandoffs(user)
      : Promise.resolve(null);

    const usersPromise = canManageUsers(user.accountRole)
      ? Promise.all([
          userRepository.countByRole(),
          canManageBoostingRoles(user.accountRole)
            ? Promise.all([
                boosterAccessRepository.countByStatus(),
                userRepository.countBoostingRoles(),
              ])
            : Promise.resolve(null),
        ])
      : Promise.resolve(null);

    const charactersPromise = canManageCharacterOperations(user.accountRole)
      ? characterOperationsService.getListPage(user, parseCharacterOperationsFilters({}))
      : Promise.resolve(null);

    // ADMIN / OWNER only — never fetch for RAID_LEAD.
    const systemPromise = isAdmin ? systemHealthService.getPage(user, {}) : Promise.resolve(null);
    const analyticsPromise = isAdmin
      ? operationalAnalyticsService.getReport(user)
      : Promise.resolve(null);
    const communityStatsPromise = isAdmin
      ? communityStatsService.getStats()
      : Promise.resolve(null);

    const [
      projected,
      usersBundle,
      characterPage,
      systemPage,
      analyticsReport,
      communityStats,
    ] = await Promise.all([
      runsPromise,
      usersPromise,
      charactersPromise,
      systemPromise,
      analyticsPromise,
      communityStatsPromise,
    ]);

    if (projected) {
      let rosterWork = 0;
      let needsAttendance = 0;
      let readyToComplete = 0;
      for (const row of projected) {
        const next = row.handoff.nextAction.kind;
        if (next === "BUILD_ROSTER" || next === "CONTINUE_ROSTER") rosterWork += 1;
        if (row.handoff.attention === "NEEDS_ATTENDANCE") needsAttendance += 1;
        if (row.handoff.attention === "READY_TO_COMPLETE") readyToComplete += 1;
      }

      cards.push({
        id: "runs",
        title: "Runs",
        description: "Create drafts, open signups, and manage assigned operations.",
        href: "/manage/runs",
        cta: "Manage Runs",
        metrics: [
          { label: "Roster work", value: rosterWork },
          { label: "Needs attendance", value: needsAttendance },
          { label: "Ready to complete", value: readyToComplete },
        ],
      });
    }

    if (usersBundle) {
      const [roleCounts, boostingBundle] = usersBundle;
      const total =
        roleCounts.USER + roleCounts.RAID_LEAD + roleCounts.ADMIN + roleCounts.OWNER;
      const metrics: Array<{ label: string; value: number | string }> = [
        { label: "Total", value: total },
        { label: "Raid leads", value: roleCounts.RAID_LEAD },
        // Admin-level accounts: Admins plus the Platform Owner.
        { label: "Admins", value: roleCounts.ADMIN + roleCounts.OWNER },
      ];
      if (boostingBundle) {
        const [accessCounts, boostingRoleCounts] = boostingBundle;
        metrics.push(
          { label: "Boosters", value: boostingRoleCounts.boosters },
          { label: "Pending access", value: accessCounts.PENDING },
        );
      }
      cards.push({
        id: "users",
        title: "Users",
        description:
          "Accounts, platform roles, Boosting Roles, and pending boosting-access review.",
        href: "/manage/users",
        cta: "Manage Users",
        metrics,
      });
    }

    if (characterPage) {
      const { summary } = characterPage;
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

    if (systemPage) {
      const counts = countSystemProviderStates(systemPage.providers);
      cards.push({
        id: "system",
        title: "System Health",
        description: "Monitor integrations, jobs, and backups.",
        href: "/manage/system",
        cta: "System Health",
        metrics: [
          { label: "Healthy", value: counts.healthy },
          { label: "Degraded", value: counts.degraded },
          { label: "Down", value: counts.down },
        ],
      });
    }

    if (analyticsReport) {
      cards.push({
        id: "analytics",
        title: "Analytics",
        description: "Review recent run activity and operational trends.",
        href: "/manage/analytics",
        cta: "View Analytics",
        metrics: [
          { label: "Runs", value: analyticsReport.totalRuns },
          { label: "Cancelled", value: analyticsReport.cancellations },
          { label: "Rescheduled", value: analyticsReport.reschedules },
          { label: "No-shows", value: analyticsReport.noShows },
        ],
      });
    }

    return { nav, cards, communityStats };
  },
};
