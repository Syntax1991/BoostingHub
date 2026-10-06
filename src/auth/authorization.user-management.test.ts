import { describe, expect, it } from "vitest";
import {
  canManageUsers,
  getManagementNavItems,
  isManagementNavActive,
} from "@/auth/authorization";

describe("management navigation and user-management gates", () => {
  it("exposes ADMIN manage modules including users and boosting roles", () => {
    const items = getManagementNavItems("ADMIN");
    expect(items.map((item) => item.module)).toEqual([
      "overview",
      "runs",
      "schedule",
      "templates",
      "boosting-roles",
      "users",
      "characters",
      "analytics",
      "system",
    ]);
    expect(items.map((item) => item.href)).toEqual([
      "/manage",
      "/manage/runs",
      "/manage/schedule",
      "/manage/templates",
      "/manage/boosting-roles",
      "/manage/users",
      "/manage/characters",
      "/manage/analytics",
      "/manage/system",
    ]);
  });

  it("limits RAID_LEAD to overview, runs, and schedule", () => {
    const items = getManagementNavItems("RAID_LEAD");
    expect(items.map((item) => item.module)).toEqual(["overview", "runs", "schedule"]);
    expect(items.some((item) => item.module === "users")).toBe(false);
    expect(items.some((item) => item.module === "boosting-roles")).toBe(false);
    expect(items.some((item) => item.module === "system")).toBe(false);
  });

  it("returns no manage nav for USER", () => {
    expect(getManagementNavItems("USER")).toEqual([]);
  });

  it("allows canManageUsers only for ADMIN", () => {
    expect(canManageUsers("ADMIN")).toBe(true);
    expect(canManageUsers("RAID_LEAD")).toBe(false);
    expect(canManageUsers("USER")).toBe(false);
  });

  it("activates overview only on exact /manage and users under its subtree", () => {
    expect(isManagementNavActive("/manage", "/manage")).toBe(true);
    expect(isManagementNavActive("/manage/users", "/manage")).toBe(false);
    expect(isManagementNavActive("/manage/runs", "/manage")).toBe(false);
    expect(isManagementNavActive("/manage/users", "/manage/users")).toBe(true);
    expect(isManagementNavActive("/manage/users/abc", "/manage/users")).toBe(true);
    expect(isManagementNavActive("/manage/runs", "/manage/users")).toBe(false);
  });
});
