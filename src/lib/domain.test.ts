import { describe, expect, it } from "vitest";
import { canAccessManagement, canManageRun, canReviewBoosterAccess, hasAdminAccess, hasRaidLeadAccess } from "@/auth/authorization";
import { isDevAuthEnabled, isProductionRuntime } from "@/auth/dev-auth";
import { formatDate, formatRelative, formatTime, fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/datetime";
import { canTransitionRun, getRunLifecycleCapabilities, isSignupWindowOpen } from "@/services/run-state";
import { canTransitionSignup, canSelfWithdrawSignup } from "@/services/signup-state";
import { boosterAccessService } from "@/services/booster-access.service";
import { lockoutService } from "@/services/lockout.service";

describe("account authorization", () => {
  it("treats admin as a raid lead for management access", () => {
    expect(hasRaidLeadAccess("USER")).toBe(false);
    expect(hasRaidLeadAccess("RAID_LEAD")).toBe(true);
    expect(hasRaidLeadAccess("ADMIN")).toBe(true);
    expect(hasAdminAccess("RAID_LEAD")).toBe(false);
    expect(canReviewBoosterAccess("RAID_LEAD")).toBe(false);
    expect(canReviewBoosterAccess("ADMIN")).toBe(true);
    expect(canAccessManagement("ADMIN")).toBe(true);
  });

  it("lets a raid lead manage only assigned runs and lets admin manage any run", () => {
    const lead = {
      id: "lead-1",
      name: "Lead",
      email: null,
      image: null,
      discordUserId: null,
      discordUsername: null,
      accountRole: "RAID_LEAD" as const,
      accountStatus: "ACTIVE" as const,
    };
    const admin = { ...lead, id: "admin-1", accountRole: "ADMIN" as const };
    const user = { ...lead, id: "user-1", accountRole: "USER" as const };

    expect(canManageRun(lead, { raidLeadId: "lead-1" })).toBe(true);
    expect(canManageRun(lead, { raidLeadId: "other" })).toBe(false);
    expect(canManageRun(admin, { raidLeadId: "lead-1" })).toBe(true);
    expect(canManageRun(user, { raidLeadId: "user-1" })).toBe(false);
  });
});

describe("development authentication", () => {
  it("does not treat the test runtime as production", () => {
    expect(isProductionRuntime()).toBe(false);
  });

  it("requires an explicit DEV_AUTH_ENABLED flag", () => {
    const previous = process.env.DEV_AUTH_ENABLED;
    process.env.DEV_AUTH_ENABLED = "true";
    expect(isDevAuthEnabled()).toBe(true);
    process.env.DEV_AUTH_ENABLED = "false";
    expect(isDevAuthEnabled()).toBe(false);
    process.env.DEV_AUTH_ENABLED = previous;
  });
});

describe("run and signup state machines", () => {
  it("keeps run transitions independent of signup transitions", () => {
    expect(canTransitionRun("OPEN", "ROSTERING")).toBe(true);
    expect(canTransitionRun("OPEN", "COMPLETED")).toBe(false);
    expect(canTransitionSignup("PENDING", "SELECTED")).toBe(true);
    expect(canTransitionSignup("WITHDRAWN", "SELECTED")).toBe(false);
    expect(canSelfWithdrawSignup("SELECTED", "PUBLISHED")).toBe(false);
    expect(canSelfWithdrawSignup("PENDING", "OPEN")).toBe(true);
  });

  it("opens the signup window only for OPEN or ROSTERING runs with the flag set", () => {
    expect(isSignupWindowOpen("OPEN", true)).toBe(true);
    expect(isSignupWindowOpen("OPEN", false)).toBe(false);
    expect(isSignupWindowOpen("PUBLISHED", true)).toBe(false);
  });

  it("derives lifecycle capabilities from status and signup history", () => {
    const draft = getRunLifecycleCapabilities({
      status: "DRAFT",
      signupsOpen: false,
      hasSignupHistory: false,
      actorIsAdmin: false,
    });
    expect(draft.canOpen).toBe(true);
    expect(draft.canEditIdentity).toBe(true);
    expect(draft.canReassignRaidLead).toBe(false);
    expect(draft.canReopenSignups).toBe(false);

    const afterSignup = getRunLifecycleCapabilities({
      status: "OPEN",
      signupsOpen: true,
      hasSignupHistory: true,
      actorIsAdmin: true,
    });
    expect(afterSignup.canEditIdentity).toBe(false);
    expect(afterSignup.canEditPlanning).toBe(true);
    expect(afterSignup.canReassignRaidLead).toBe(true);
    expect(afterSignup.canCloseSignups).toBe(true);

    const published = getRunLifecycleCapabilities({
      status: "PUBLISHED",
      signupsOpen: false,
      hasSignupHistory: true,
      actorIsAdmin: true,
    });
    expect(published.canEdit).toBe(false);
    expect(published.canCancel).toBe(true);
    expect(published.canStart).toBe(true);
    expect(published.canComplete).toBe(false);
    expect(published.canManageAttendance).toBe(false);
    expect(published.canReassignRaidLead).toBe(false);
    expect(published.canReopenSignups).toBe(false);

    const inProgress = getRunLifecycleCapabilities({
      status: "IN_PROGRESS",
      signupsOpen: false,
      hasSignupHistory: true,
      actorIsAdmin: true,
    });
    expect(inProgress.canStart).toBe(false);
    expect(inProgress.canManageAttendance).toBe(true);
    expect(inProgress.canComplete).toBe(true);
    expect(inProgress.canCancel).toBe(false);
    expect(inProgress.canEdit).toBe(false);
  });
});

describe("booster access", () => {
  it("does not imply mythic approval from heroic approval", () => {
    const records = [
      {
        wowClass: "SHAMAN" as const,
        role: "HEALER" as const,
        difficulty: "HEROIC" as const,
        status: "APPROVED" as const,
      },
      {
        wowClass: "SHAMAN" as const,
        role: "HEALER" as const,
        difficulty: "NORMAL" as const,
        status: "PENDING" as const,
      },
    ];

    expect(boosterAccessService.isApprovedFor(records, "SHAMAN", "HEALER", "HEROIC")).toBe(true);
    expect(boosterAccessService.isApprovedFor(records, "SHAMAN", "HEALER", "MYTHIC")).toBe(false);
    expect(boosterAccessService.isApprovedFor(records, "SHAMAN", "HEALER", "NORMAL")).toBe(false);
  });
});

describe("datetime formatting", () => {
  it("formats zoned dates with numeric months so Node and browsers cannot disagree on Sept vs Sep", () => {
    const instant = "2026-09-10T19:00:00.000Z";
    expect(formatDate(instant)).toBe("Thu 10/09/2026");
    expect(formatTime(instant)).toBe("21:00");
  });

  it("round-trips Europe/Berlin datetime-local values through UTC", () => {
    const instant = "2026-09-10T19:00:00.000Z";
    expect(toDatetimeLocalValue(instant)).toBe("2026-09-10T21:00");
    expect(fromDatetimeLocalValue("2026-09-10T21:00")).toBe(instant);
  });

  it("formats relative times from an explicit now value", () => {
    expect(formatRelative("2026-09-08T12:00:00.000Z", new Date("2026-09-08T13:00:00.000Z"))).toBe(
      "1h ago",
    );
  });
});

describe("lockout summaries", () => {
  it("flags incomplete progress and complete lockouts as attention items", () => {
    const summary = lockoutService.summarize([
      {
        raid: { name: "Manaforge Omega" },
        difficulty: "HEROIC",
        resetIdentifier: "2026-W37",
        isComplete: false,
        bossesDefeated: 3,
      },
      {
        raid: { name: "Manaforge Omega" },
        difficulty: "MYTHIC",
        resetIdentifier: "2026-W37",
        isComplete: false,
        bossesDefeated: 0,
      },
    ]);

    expect(summary[0]?.attention).toBe(true);
    expect(summary[1]?.attention).toBe(false);
  });
});
