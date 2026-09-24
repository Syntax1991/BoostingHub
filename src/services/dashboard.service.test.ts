import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { activityRepository } from "@/repositories/activity.repository";
import { dashboardService } from "@/services/dashboard.service";

function asUser(accountRole: AuthenticatedUser["accountRole"]): AuthenticatedUser {
  return {
    id: `d3333333-3333-4333-8333-33333333330${accountRole === "USER" ? 1 : accountRole === "RAID_LEAD" ? 2 : 3}`,
    name: `Dashboard ${accountRole}`,
    email: `${accountRole.toLowerCase()}@dashboard.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

const EVENT = {
  id: "e1",
  type: "ROSTER_PUBLISHED",
  message: "Published a roster.",
  occurredAt: "2026-09-24T20:00:00.000Z",
  user: { name: "Lead" },
};

describe("dashboard Recent Activity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is hidden from regular users — the events are not even loaded", async () => {
    const listRecent = vi.spyOn(activityRepository, "listRecent").mockResolvedValue([EVENT] as never);

    const data = await dashboardService.getDashboard(asUser("USER"));

    expect(data.showRecentActivity).toBe(false);
    expect(data.recentActivity).toEqual([]);
    expect(listRecent).not.toHaveBeenCalled();
  });

  it.each(["RAID_LEAD", "ADMIN"] as const)("is shown to %s", async (role) => {
    vi.spyOn(activityRepository, "listRecent").mockResolvedValue([EVENT] as never);

    const data = await dashboardService.getDashboard(asUser(role));

    expect(data.showRecentActivity).toBe(true);
    expect(data.recentActivity.map((event) => event.message)).toEqual(["Published a roster."]);
  });
});
