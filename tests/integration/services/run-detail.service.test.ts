import { describe, expect, it } from "vitest";
import { SEED_IDS } from "@/prisma/seed-ids";
import { rosterRepository } from "@/repositories/roster.repository";
import { rosterService } from "@/services/roster.service";
import { runDetailService } from "@/services/run-detail.service";
import { testActor } from "@tests/fixtures/actors";
import { expectDomainError } from "@tests/helpers/domain-error";

const ids = {
  kael: SEED_IDS.users.kael,
  thorne: SEED_IDS.users.thorne,
  heroicOpen: SEED_IDS.runs.heroicOpen,
  weekend: SEED_IDS.runs.heroicWeekend,
  normal: SEED_IDS.runs.normalOpen,
  published: SEED_IDS.runs.heroicPublished,
  mythicDraft: SEED_IDS.runs.mythicDraft,
  publishedKael: SEED_IDS.signups.publishedKael,
};

/** Seeded callers: a Booster, the Raid Lead of the weekend and draft Runs, and an admin. */
const kael = testActor(ids.kael, "USER");
const thorne = testActor(ids.thorne, "RAID_LEAD");
const aelira = testActor(SEED_IDS.users.aelira, "ADMIN");

describe("runDetailService", () => {
  it("loads a run and rejects a missing run", async () => {
    const view = await runDetailService.getRunDetail(kael, ids.weekend);
    expect(view.run.id).toBe(ids.weekend);
    expect(view.run.title).toBeTruthy();
    await expectDomainError(runDetailService.getRunDetail(kael, crypto.randomUUID()), "NOT_FOUND");
  });

  it("gives a USER own signups and published roster without manager payload", async () => {
    const view = await runDetailService.getRunDetail(kael, ids.published);
    expect(view.permissions.canManageRun).toBe(false);
    expect(view.permissions.canViewManagerSignups).toBe(false);
    expect(view.manager).toBeNull();
    expect(view.editor).toBeNull();
    expect(view.capabilities.canEdit).toBe(false);
    expect(view.capabilities.canOpen).toBe(false);
    expect(view.capabilities.canStart).toBe(false);
    expect(view.attendance.manager).toBeNull();
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
    expect(Object.keys(own.manager?.groups ?? {})).toEqual(["lootbuddies"]);
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
    await expectDomainError(
      runDetailService.getRunDetail(kael, ids.mythicDraft),
      "NOT_FOUND",
    );
  });

  it("lets the assigned raid lead open a DRAFT", async () => {
    const view = await runDetailService.getRunDetail(thorne, ids.mythicDraft);
    expect(view.permissions.canManageRun).toBe(true);
    expect(view.capabilities.canOpen).toBe(true);
    expect(view.capabilities.canEdit).toBe(true);
    expect(view.run.status).toBe("DRAFT");
  });

  it("keeps USER roster mutations rejected", async () => {
    await expectDomainError(
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
