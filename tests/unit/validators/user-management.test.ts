import { describe, expect, it } from "vitest";
import { parseAdminUserFilters } from "@/validators/user-management";

describe("parseAdminUserFilters", () => {
  it("defaults to the All Users view", () => {
    expect(parseAdminUserFilters({}).view).toBe("users");
  });

  it("maps boosting-access and legacy aliases to the pending view", () => {
    expect(parseAdminUserFilters({ view: "boosting-access" }).view).toBe("boosting-access");
    expect(parseAdminUserFilters({ view: "legacy" }).view).toBe("boosting-access");
  });

  it("parses consolidated All Users filters", () => {
    const filters = parseAdminUserFilters({
      query: "  Aelira  ",
      role: "RAID_LEAD",
      boostingRole: "BOOSTER",
      accountStatus: "DISABLED",
      pendingAccess: "1",
      sort: "joined_desc",
    });
    expect(filters).toMatchObject({
      view: "users",
      query: "Aelira",
      role: "RAID_LEAD",
      boostingRole: "BOOSTER",
      accountStatus: "DISABLED",
      pendingAccess: true,
      sort: "joined_desc",
    });
  });

  it("parses pending-access request filters", () => {
    const filters = parseAdminUserFilters({
      view: "boosting-access",
      difficulty: "HEROIC",
      requestedRole: "HEALER",
      query: "paladin",
    });
    expect(filters).toMatchObject({
      view: "boosting-access",
      difficulty: "HEROIC",
      requestedRole: "HEALER",
      query: "paladin",
    });
  });
});
