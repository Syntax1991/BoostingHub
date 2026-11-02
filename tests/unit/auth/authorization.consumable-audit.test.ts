import { describe, expect, it } from "vitest";
import {
  assertCanViewRunConsumableAudit,
  canViewRunConsumableAudit,
  type AuthenticatedUser,
} from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";

function user(id: string, accountRole: AuthenticatedUser["accountRole"]): AuthenticatedUser {
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

const run = { raidLeadId: "lead-1" };

describe("canViewRunConsumableAudit", () => {
  it("allows ADMIN and OWNER on every run", () => {
    expect(canViewRunConsumableAudit(user("admin", "ADMIN"), run)).toBe(true);
    expect(canViewRunConsumableAudit(user("owner", "OWNER"), run)).toBe(true);
  });

  it("allows a RAID_LEAD only on runs they lead", () => {
    expect(canViewRunConsumableAudit(user("lead-1", "RAID_LEAD"), run)).toBe(true);
    expect(canViewRunConsumableAudit(user("lead-2", "RAID_LEAD"), run)).toBe(false);
  });

  it("denies a USER, even one recorded as the run's raid lead", () => {
    expect(canViewRunConsumableAudit(user("someone", "USER"), run)).toBe(false);
    expect(canViewRunConsumableAudit(user("lead-1", "USER"), run)).toBe(false);
  });

  it("assert throws the standard 403 NOT_AUTHORIZED", () => {
    try {
      assertCanViewRunConsumableAudit(user("someone", "USER"), run);
      throw new Error("expected throw");
    } catch (error) {
      expect(isDomainError(error) && [error.code, error.status]).toEqual(["NOT_AUTHORIZED", 403]);
    }
  });
});
