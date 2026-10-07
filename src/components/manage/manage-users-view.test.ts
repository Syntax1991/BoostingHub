import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ManageUsersView } from "@/components/manage/manage-users-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => createElement("a", { href, className }, children),
}));

function samplePage() {
  return {
    filters: {
      view: "users" as const,
      query: null,
      role: null,
      boostingRole: null,
      accountStatus: null,
      pendingAccess: false,
      sort: "name" as const,
      difficulty: null,
      requestedRole: null,
    },
    users: [
      {
        id: "user-1",
        name: "Raid Lead User",
        image: null,
        discordUserId: "d1",
        discordUsername: "raidlead",
        accountRole: "RAID_LEAD" as const,
        accountStatus: "ACTIVE" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        characterCount: 2,
        isBooster: true,
        isLootbuddy: false,
        characterRoles: ["TANK", "HEALER"] as const,
        pendingAccessCount: 0,
      },
      {
        id: "user-2",
        name: "Plain User",
        image: null,
        discordUserId: null,
        discordUsername: null,
        accountRole: "USER" as const,
        accountStatus: "ACTIVE" as const,
        createdAt: "2026-01-02T00:00:00.000Z",
        characterCount: 0,
        isBooster: false,
        isLootbuddy: false,
        characterRoles: [] as const,
        pendingAccessCount: 1,
      },
      {
        id: "user-owner",
        name: "Platform Owner",
        image: null,
        discordUserId: "d-owner",
        discordUsername: "owner",
        accountRole: "OWNER" as const,
        accountStatus: "ACTIVE" as const,
        createdAt: "2026-01-03T00:00:00.000Z",
        characterCount: 1,
        isBooster: true,
        isLootbuddy: true,
        characterRoles: ["RANGED_DPS"] as const,
        pendingAccessCount: 0,
      },
    ],
    pendingAccessCount: 1,
    pendingGroups: [],
    boostingCounts: { boosters: 2, lootbuddies: 1 },
  };
}

describe("ManageUsersView directory UX", () => {
  it("keeps directory columns without a Boosting Roles column", () => {
    const html = renderToStaticMarkup(
      createElement(ManageUsersView, { data: samplePage() as never }),
    );

    expect(html).toContain("Platform Role");
    expect(html).toContain("Boosting Access");
    expect(html).toContain("Account Status");
    expect(html).toContain("Characters");
    expect(html).toContain("Pending");
    expect(html).toContain("Actions");
    expect(html).toContain("Booster");
    expect(html).toContain("Access");
    expect(html).toContain("Manage");
    expect(html).toContain('href="/manage/users/user-1"');
    expect(html).toContain('href="/manage/users/user-2"');
    expect(html).toContain('href="/manage/users/user-owner"');

    // Directory table/mobile must not surface Character roles as a column.
    expect(html).not.toMatch(/<th[^>]*>Boosting Roles<\/th>/);
    expect(html).not.toMatch(/<dt[^>]*>Boosting Roles<\/dt>/);

    expect(html).not.toContain("Change role");
    expect(html).not.toContain(">Grant<");
    expect(html).not.toContain(">Revoke<");
    expect(html).not.toContain("1 pending request");
  });

  it("keeps Pending count and empty boosting access as em dash", () => {
    const html = renderToStaticMarkup(
      createElement(ManageUsersView, { data: samplePage() as never }),
    );
    expect(html).toContain("Plain User");
    expect(html).toMatch(/Pending[\s\S]*?>1</);
  });

  it("still passes Character roles into Access dialog context", () => {
    const html = renderToStaticMarkup(
      createElement(ManageUsersView, { data: samplePage() as never }),
    );
    // Access modal retains read-only role context (not a directory column).
    expect(html).toContain("Manage Access");
    expect(html).toContain("Tank");
    expect(html).toContain("Healer");
  });
});
