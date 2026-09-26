import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  canAccessManagement,
  canManageRun,
  canManageUsers,
  canReviewBoosterAccess,
  getManagementNavItems,
  hasAdminAccess,
  hasOwnerAccess,
  hasRaidLeadAccess,
  isEligibleRaidLead,
  type AuthenticatedUser,
} from "@/auth/authorization";
import { ROLE_LABELS } from "@/lib/labels";
import { ACCOUNT_ROLES, MANAGEABLE_ACCOUNT_ROLES, type AccountRole } from "@/models/enums";
import { mapUserRole } from "@/lib/persistence";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const { AccountRoleBadge } = await import("@/components/ui/badges");
const { AccountRoleAction } = await import("@/components/manage/account-role-action");

function actor(id: string, accountRole: AccountRole): AuthenticatedUser {
  return {
    id,
    name: id,
    email: null,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

describe("account role hierarchy — OWNER > ADMIN > RAID_LEAD > USER", () => {
  it.each([
    ["OWNER", true, true, true],
    ["ADMIN", false, true, true],
    ["RAID_LEAD", false, false, true],
    ["USER", false, false, false],
  ] as const)("%s: owner=%s admin=%s raidLead=%s", (role, owner, admin, raidLead) => {
    expect(hasOwnerAccess(role)).toBe(owner);
    expect(hasAdminAccess(role)).toBe(admin);
    expect(hasRaidLeadAccess(role)).toBe(raidLead);
  });

  it("OWNER inherits every Admin capability", () => {
    expect(canManageUsers("OWNER")).toBe(true);
    expect(canReviewBoosterAccess("OWNER")).toBe(true);
    expect(canAccessManagement("OWNER")).toBe(true);
    expect(getManagementNavItems("OWNER")).toEqual(getManagementNavItems("ADMIN"));
    expect(getManagementNavItems("OWNER").map((item) => item.module)).toEqual([
      "overview",
      "runs",
      "templates",
      "booster-access",
      "users",
      "characters",
    ]);
    // Any Run, not only assigned ones — like ADMIN.
    expect(canManageRun(actor("owner", "OWNER"), { raidLeadId: "someone-else" })).toBe(true);
    expect(isEligibleRaidLead({ accountRole: "OWNER", accountStatus: "ACTIVE" })).toBe(true);
    expect(isEligibleRaidLead({ accountRole: "OWNER", accountStatus: "DISABLED" })).toBe(false);
  });

  it("existing USER / RAID_LEAD / ADMIN behavior is unchanged", () => {
    expect(canManageUsers("ADMIN")).toBe(true);
    expect(canManageUsers("RAID_LEAD")).toBe(false);
    expect(canReviewBoosterAccess("RAID_LEAD")).toBe(false);
    expect(canAccessManagement("USER")).toBe(false);
    expect(getManagementNavItems("USER")).toEqual([]);
    expect(getManagementNavItems("RAID_LEAD").map((item) => item.module)).toEqual(["overview", "runs"]);
    expect(canManageRun(actor("lead", "RAID_LEAD"), { raidLeadId: "lead" })).toBe(true);
    expect(canManageRun(actor("lead", "RAID_LEAD"), { raidLeadId: "other" })).toBe(false);
    expect(canManageRun(actor("admin", "ADMIN"), { raidLeadId: "other" })).toBe(true);
    expect(isEligibleRaidLead({ accountRole: "USER", accountStatus: "ACTIVE" })).toBe(false);
  });

  it("OWNER is a persisted role that maps back from the database (never silently downgraded to USER)", () => {
    expect(ACCOUNT_ROLES).toContain("OWNER");
    expect(mapUserRole("OWNER")).toBe("OWNER");
  });
});

describe("OWNER presentation and the generic role picker", () => {
  it("OWNER is labelled and badged", () => {
    expect(ROLE_LABELS.OWNER).toBe("Platform Owner");
    const html = renderToStaticMarkup(createElement(AccountRoleBadge, { role: "OWNER" }));
    expect(html).toContain("Platform Owner");
  });

  it("OWNER is excluded from the generic assignable role options", () => {
    expect(MANAGEABLE_ACCOUNT_ROLES).toEqual(["USER", "RAID_LEAD", "ADMIN"]);
    expect(MANAGEABLE_ACCOUNT_ROLES as readonly string[]).not.toContain("OWNER");
  });

  it("a protected OWNER target shows no role-change control; other targets keep the normal Change role button", () => {
    const ownerHtml = renderToStaticMarkup(
      createElement(AccountRoleAction, { userId: "u-owner", userName: "Owner", accountRole: "OWNER" }),
    );
    expect(ownerHtml).toContain("Platform Owner · Protected");
    expect(ownerHtml).not.toContain("Change role");
    expect(ownerHtml).not.toContain("<button");

    for (const role of MANAGEABLE_ACCOUNT_ROLES) {
      const html = renderToStaticMarkup(
        createElement(AccountRoleAction, { userId: `u-${role}`, userName: role, accountRole: role }),
      );
      expect(html).toContain("Change role");
      expect(html).not.toContain("Protected");
    }
  });
});
