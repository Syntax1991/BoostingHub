import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import type { AccountRole } from "@/models/enums";
import { CONCRETE_CHARACTER_ROLES } from "@/lib/character-roles";
import { WOW_CLASSES } from "@/models/enums";

const getStatsMock = vi.fn();

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

import { managementHubService } from "@/services/management-hub.service";

const ids = {
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-mh0000000001",
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-mh0000000002",
  owner: "aaaaaaaa-aaaa-4aaa-8aaa-mh0000000003",
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
    email: `${id}@mh.boostting.local`,
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
    email: `${id}@mh.boostting.local`,
    emailVerified: true,
    // OWNER is a singleton DB role; store ADMIN and pass OWNER on the actor.
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
  getStatsMock.mockResolvedValue(SAMPLE_STATS);
  await createUser(ids.lead, "MH Lead", "RAID_LEAD");
  await createUser(ids.admin, "MH Admin", "ADMIN");
  await createUser(ids.owner, "MH Owner", "OWNER");
});

afterAll(async () => {
  await cleanup();
});

describe("managementHubService Community Stats gate", () => {
  it("does not fetch or return Community Stats for RAID_LEAD", async () => {
    const overview = await managementHubService.getOverview(asUser(ids.lead, "MH Lead", "RAID_LEAD"));
    expect(getStatsMock).not.toHaveBeenCalled();
    expect(overview.communityStats).toBeNull();
    expect(overview.cards.some((card) => card.id === "runs")).toBe(true);
    expect(overview.cards.some((card) => card.id === "characters")).toBe(false);
  });

  it("fetches and returns Community Stats for ADMIN", async () => {
    const overview = await managementHubService.getOverview(asUser(ids.admin, "MH Admin", "ADMIN"));
    expect(getStatsMock).toHaveBeenCalledTimes(1);
    expect(overview.communityStats).toEqual(SAMPLE_STATS);
    expect(overview.cards.some((card) => card.id === "characters")).toBe(true);
    for (const role of CONCRETE_CHARACTER_ROLES) {
      expect(overview.communityStats?.roles[role]).toEqual(SAMPLE_STATS.roles[role]);
    }
    expect(overview.communityStats?.roles).not.toHaveProperty("DPS");
  });

  it("fetches and returns Community Stats for OWNER", async () => {
    const overview = await managementHubService.getOverview(asUser(ids.owner, "MH Owner", "OWNER"));
    expect(getStatsMock).toHaveBeenCalledTimes(1);
    expect(overview.communityStats).toEqual(SAMPLE_STATS);
  });
});
