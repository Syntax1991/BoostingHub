import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { parseRunDetailTab, runDetailPath, runDetailTabForManageAction } from "@/lib/run-routes";
import { rosterRepository } from "@/repositories/roster.repository";
import { rosterService } from "@/services/roster.service";
import { runDetailService } from "@/services/run-detail.service";

const ids = {
  kael: "11111111-1111-4111-8111-111111111111",
  thorne: "33333333-3333-4333-8333-333333333333",
  aelira: "44444444-4444-4444-8444-444444444444",
  heroicOpen: "r1111111-1111-4111-8111-111111111111",
  weekend: "r7777777-7777-4777-8777-777777777777",
  normal: "r4444444-4444-4444-8444-444444444444",
  published: "r5555555-5555-4555-8555-555555555555",
  publishedKael: "s5555555-5555-4555-8555-555555555551",
};

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@dev.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function expectDomainCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected domain error ${code}`);
  } catch (error) {
    expect(isDomainError(error) && error.code).toBe(code);
  }
}

const kael = asUser(ids.kael, "Kael Stormhowl");
const thorne = asUser(ids.thorne, "Thorne Ironvein", "RAID_LEAD");
const aelira = asUser(ids.aelira, "Aelira Nightwatch", "ADMIN");

describe("canonical run routes", () => {
  it("builds /runs/[runId] as the entity URL and maps manage actions to tabs", () => {
    expect(runDetailPath(ids.weekend)).toBe(`/runs/${ids.weekend}`);
    expect(runDetailPath(ids.weekend, "roster")).toBe(`/runs/${ids.weekend}?tab=roster`);
    expect(parseRunDetailTab(["roster"])).toBe("roster");
    expect(parseRunDetailTab("unknown")).toBe("overview");
    expect(runDetailTabForManageAction("Continue Roster")).toBe("roster");
    expect(runDetailTabForManageAction("View")).toBe("overview");
    expect(runDetailTabForManageAction("Manage")).toBe("overview");
  });
});

describe("runDetailService", () => {
  it("loads a run and rejects a missing run", async () => {
    const view = await runDetailService.getRunDetail(kael, ids.weekend);
    expect(view.run.id).toBe(ids.weekend);
    expect(view.run.title).toBeTruthy();
    await expectDomainCode(runDetailService.getRunDetail(kael, "r0000000-0000-4000-8000-000000000000"), "NOT_FOUND");
  });

  it("gives a USER own signups and published roster without manager payload", async () => {
    const view = await runDetailService.getRunDetail(kael, ids.published);
    expect(view.permissions.canManageRun).toBe(false);
    expect(view.permissions.canViewManagerSignups).toBe(false);
    expect(view.manager).toBeNull();
    expect(view.editor).toBeNull();
    expect(view.capabilities.canEdit).toBe(false);
    expect(view.capabilities.canOpen).toBe(false);
    expect(view.viewerSignups.some((signup) => signup.id === ids.publishedKael)).toBe(true);
    expect(view.publishedRoster?.members.some((member) => member.signupId === ids.publishedKael)).toBe(true);
    expect(view.publishedRoster?.members.every((member) => member.participationType)).toBeTruthy();
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("draftSelected");
    expect(serialized).not.toContain("needsPublishSeed");
    expect(serialized).not.toContain("acknowledge");
  });

  it("does not create a roster row when a USER opens an unpublished run", async () => {
    const before = await rosterRepository.findByRunId(ids.heroicOpen);
    const view = await runDetailService.getRunDetail(kael, ids.heroicOpen);
    const after = await rosterRepository.findByRunId(ids.heroicOpen);
    expect(view.publishedRoster).toBeNull();
    expect(view.manager).toBeNull();
    expect(after?.id ?? null).toBe(before?.id ?? null);
    expect(after?.version ?? null).toBe(before?.version ?? null);
  });

  it("lets a raid lead manage an assigned run and not another lead's run", async () => {
    const own = await runDetailService.getRunDetail(thorne, ids.weekend);
    expect(own.permissions.canManageRun).toBe(true);
    expect(own.manager?.run.id).toBe(ids.weekend);
    expect(own.permissions.canViewManagerSignups).toBe(true);

    const other = await runDetailService.getRunDetail(thorne, ids.normal);
    expect(other.permissions.canManageRun).toBe(false);
    expect(other.manager).toBeNull();
    const serialized = JSON.stringify(other);
    expect(serialized).not.toContain("draftSelected");
  });

  it("lets an ADMIN manage any run", async () => {
    const view = await runDetailService.getRunDetail(aelira, ids.weekend);
    expect(view.permissions.canManageRun).toBe(true);
    expect(view.manager?.run.id).toBe(ids.weekend);
  });

  it("hides a private DRAFT from a USER", async () => {
    await expectDomainCode(
      runDetailService.getRunDetail(kael, "r6666666-6666-4666-8666-666666666666"),
      "NOT_FOUND",
    );
  });

  it("lets the assigned raid lead open a DRAFT", async () => {
    const view = await runDetailService.getRunDetail(thorne, "r6666666-6666-4666-8666-666666666666");
    expect(view.permissions.canManageRun).toBe(true);
    expect(view.capabilities.canOpen).toBe(true);
    expect(view.capabilities.canEdit).toBe(true);
    expect(view.run.status).toBe("DRAFT");
  });

  it("keeps USER roster mutations rejected", async () => {
    await expectDomainCode(
      rosterService.setDraftSelection(kael, {
        runId: ids.weekend,
        signupId: ids.publishedKael,
        selected: true,
        version: 1,
      }),
      "RUN_NOT_MANAGEABLE",
    );
  });
});
