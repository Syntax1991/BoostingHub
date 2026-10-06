import type { AuthenticatedUser } from "@/auth/authorization";
import { hasAdminAccess } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import {
  operationalAnalyticsRepository,
  resolveAnalyticsRange,
} from "@/repositories/operational-analytics.repository";
import {
  aggregateOperationalAnalytics,
  type OperationalAnalyticsReport,
} from "@/services/operational-analytics";

/**
 * ADMIN / OWNER operational analytics. No financial metrics.
 */
export const operationalAnalyticsService = {
  async getReport(
    user: AuthenticatedUser,
    input: { from?: string | null; to?: string | null } = {},
  ): Promise<OperationalAnalyticsReport> {
    if (!hasAdminAccess(user.accountRole)) {
      throw new DomainError("NOT_AUTHORIZED", "Admin permission is required for analytics.", 403);
    }
    const range = resolveAnalyticsRange(input);
    const rows = await operationalAnalyticsRepository.listRunsInRange(range.from, range.to);
    return aggregateOperationalAnalytics(rows, range);
  },
};
