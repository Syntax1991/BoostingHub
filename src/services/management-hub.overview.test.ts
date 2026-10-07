import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import type { AccountRole } from "@/models/enums";
import { WOW_CLASSES } from "@/models/enums";

const getStatsMock = vi.fn();
const getSystemPageMock = vi.fn();
const getAnalyticsReportMock = vi.fn();

vi.mock("@/services/community-stats.service", async () => {
  const actual = await vi.importActual<typeof import("@/services/community-stats.service")>(
    "@/services/community-stats.service",
  );
  return {
    ...actual,
    communityStatsService: {
      getStats: (...args: unknown[]) => getStatsMock(...args),
    },
  };
});

vi.mock("@/services/system-health.service", () => ({
  systemHealthService: {
    getPage: (...args: unknown[]) => getSystemPageMock(...args),
  },
}));

vi.mock("@/services/operational-analytics.service", () => ({
  operationalAnalyticsService: {
    getReport: (...args: unknown[]) => getAnalyticsReportMock(...args),
  },
}));

import { managementHubService } from "@/services/management-hub.service";

const ids = {
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-ov0000000001",
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-ov0000000002",
  owner: "aaaaaaaa-aaaa-4aaa-8aaa-ov0000000003",
};

const SAMPLE_STATS = {
  activeBoosters: 57,
  activeCharacters: 201,
  roles: {
    TANK: { characters: 39, boosters: 14 },
    HEALER: { characters: 42, boosters: 15 },
    MELEE_DPS: { characters: 37, boosters: 24 },
    RANGED_DPS: { characters: 94, boosters: 40 },
  },
  classes: Object.fromEntries(WOW_CLASSES.map((wowClass) => [wowClass, 0])) as Record<
    (typeof WOW_CLASSES)[number],
    number
  >,
  multiRole: { characters: 10, boosters: 4 },
};

function asUser(id: string, name: string, accountRole: AccountRole): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@ov.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function createUser(id: string, name: string, accountRole: AccountRole) {
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name,
    email: `${id}@ov.boostting.local`,
    emailVerified: true,
    accountRole: accountRole === "OWNER" ? "ADMIN" : accountRole,
    accountStatus: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
}

async function cleanup() {
  for (const id of Object.values(ids)) {
    await orm.User.where({ id }).delete().catch(() => {});
  }
}

beforeAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await cleanup();
  getStatsMock.mockReset();
  getSystemPageMock.mockReset();
  getAnalyticsReportMock.mockReset();
  getStatsMock.mockResolvedValue(SAMPLE_STATS);
  getSystemPageMock.mockResolvedValue({
    providers: [
      { provider: "BLIZZARD", state: "HEALTHY" },
      { provider: "WARCRAFT_LOGS", state: "HEALTHY" },
      { provider: "DISCORD", state: "HEALTHY" },
      { provider: "RAIDER_IO", state: "UNKNOWN" },
      { provider: "SYSTEM", state: "HEALTHY" },
      { provider: "BACKUP", state: "DEGRADED" },
    ],
    events: [],
    filters: { provider: null, status: null, operation: null, limit: 25, offset: 0 },
  });
  getAnalyticsReportMock.mockResolvedValue({
    range: { from: "2026-01-01", to: "2026-01-31", days: 30 },
    totalRuns: 12,
    cancellations: 2,
    reschedules: 3,
    noShows: 4,
    activeSignups: 40,
    selectedSignups: 20,
    runsWithExternalBoosters: 1,
  });
  await createUser(ids.lead, "OV Lead", "RAID_LEAD");
  await createUser(ids.admin, "OV Admin", "ADMIN");
  await createUser(ids.owner, "OV Owner", "OWNER");
});

afterAll(async () => {
  await cleanup();
});

describe("managementHubService balanced Overview cards", () => {
  it("ADMIN receives five cards with Users consolidating boosting-access state", async () => {
    const overview = await managementHubService.getOverview(asUser(ids.admin, "OV Admin", "ADMIN"));
    expect(overview.cards).toHaveLength(5);
    expect(overview.cards.map((card) => card.id)).toEqual([
      "runs",
      "users",
      "characters",
      "system",
      "analytics",
    ]);
    const users = overview.cards.find((card) => card.id === "users")!;
    expect(users.href).toBe("/manage/users");
    expect(users.metrics.map((m) => m.label)).toEqual(
      expect.arrayContaining(["Total", "Raid leads", "Admins", "Boosters", "Pending access"]),
    );
    expect(overview.cards.some((card) => card.id === ("boosting-roles" as never))).toBe(false);

    const system = overview.cards.find((card) => card.id === "system")!;
    expect(system.href).toBe("/manage/system");
    expect(system.cta).toBe("System Health");
    expect(Object.fromEntries(system.metrics.map((m) => [m.label, m.value]))).toEqual({
      Healthy: 4,
      Degraded: 1,
      Down: 0,
    });
    expect(getSystemPageMock).toHaveBeenCalledTimes(1);

    const analytics = overview.cards.find((card) => card.id === "analytics")!;
    expect(analytics.href).toBe("/manage/analytics");
    expect(analytics.cta).toBe("View Analytics");
    expect(Object.fromEntries(analytics.metrics.map((m) => [m.label, m.value]))).toEqual({
      Runs: 12,
      Cancelled: 2,
      Rescheduled: 3,
      "No-shows": 4,
    });
    expect(JSON.stringify(analytics.metrics)).not.toMatch(/payout|settlement|gold|revenue/i);
    expect(getAnalyticsReportMock).toHaveBeenCalledTimes(1);
    expect(getAnalyticsReportMock).toHaveBeenCalledWith(expect.objectContaining({ id: ids.admin }));

    const runs = overview.cards.find((card) => card.id === "runs")!;
    expect(runs.metrics.map((m) => m.label)).toEqual([
      "Roster work",
      "Needs attendance",
      "Ready to complete",
    ]);
    expect(runs.metrics.some((m) => m.label === "Needs settlement")).toBe(false);

    expect(overview.communityStats).toEqual(SAMPLE_STATS);
    expect(getStatsMock).toHaveBeenCalledTimes(1);
  });

  it("OWNER receives the same Admin-level overview cards", async () => {
    const overview = await managementHubService.getOverview(asUser(ids.owner, "OV Owner", "OWNER"));
    expect(overview.cards.map((card) => card.id)).toEqual([
      "runs",
      "users",
      "characters",
      "system",
      "analytics",
    ]);
    expect(getSystemPageMock).toHaveBeenCalledTimes(1);
    expect(getAnalyticsReportMock).toHaveBeenCalledTimes(1);
  });

  it("RAID_LEAD does not receive System/Analytics cards and does not call Admin-only services", async () => {
    const overview = await managementHubService.getOverview(asUser(ids.lead, "OV Lead", "RAID_LEAD"));
    expect(overview.cards.some((card) => card.id === "system")).toBe(false);
    expect(overview.cards.some((card) => card.id === "analytics")).toBe(false);
    expect(overview.cards.some((card) => card.id === "runs")).toBe(true);
    expect(overview.communityStats).toBeNull();
    expect(getSystemPageMock).not.toHaveBeenCalled();
    expect(getAnalyticsReportMock).not.toHaveBeenCalled();
    expect(getStatsMock).not.toHaveBeenCalled();
  });
});
