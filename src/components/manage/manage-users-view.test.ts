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
        pendingAccessCount: 0,
      },
    ],
    pendingAccessCount: 1,
    pendingGroups: [],
    boostingCounts: { boosters: 2, lootbuddies: 1 },
  };
}

describe("ManageUsersView inline access controls", () => {
  it("exposes platform role and boosting access controls while keeping Manage", () => {
    const html = renderToStaticMarkup(
      createElement(ManageUsersView, { data: samplePage() as never }),
    );

    expect(html).toContain("Change role");
    expect(html).toContain("Grant");
    expect(html).toContain("Revoke");
    expect(html).toContain("1 pending request");
    expect(html).toContain("Platform Owner · Protected");
    expect(html).toContain('href="/manage/users/user-1"');
    expect(html).toContain('href="/manage/users/user-2"');
    expect(html).toContain('href="/manage/users/user-owner"');
    expect(html).toContain("Manage");
  });

  it("does not offer a role-change button for protected OWNER", () => {
    const html = renderToStaticMarkup(
      createElement(ManageUsersView, { data: samplePage() as never }),
    );
    // OWNER label is protected; Change role still appears for other rows.
    expect(html).toContain("Platform Owner · Protected");
    const ownerSlice = html.slice(html.indexOf("Platform Owner · Protected") - 200);
    expect(ownerSlice.slice(0, 400)).not.toMatch(/Change role[\s\S]{0,80}Platform Owner · Protected/);
  });
});
