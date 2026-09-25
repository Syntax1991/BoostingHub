import { describe, expect, it } from "vitest";
import { resolveRosterActions } from "@/components/manage/roster-actions";

const base = {
  canEdit: true,
  runStatus: "OPEN" as const,
  isPublished: false,
  hasLocalEdits: false,
  hasUnpublishedChanges: false,
  needsPublishSeed: false,
};

describe("resolveRosterActions", () => {
  it("never published + local edits → Save Roster (and Discard), no Update / Publish", () => {
    expect(resolveRosterActions({ ...base, hasLocalEdits: true })).toEqual({
      save: true,
      update: false,
      publish: false,
      repost: false,
      discard: true,
      seed: false,
    });
  });

  it("never published + saved state → Publish Roster only", () => {
    expect(resolveRosterActions({ ...base, runStatus: "ROSTERING" })).toEqual({
      save: false,
      update: false,
      publish: true,
      repost: false,
      discard: false,
      seed: false,
    });
  });

  it("published + clean → Publish Roster (repost) only — no Save, no Update", () => {
    expect(resolveRosterActions({ ...base, runStatus: "PUBLISHED", isPublished: true })).toEqual({
      save: false,
      update: false,
      publish: false,
      repost: true,
      discard: false,
      seed: false,
    });
  });

  it("published + local edits → Update Roster (one action) + Discard; Save absent; Publish cannot bypass", () => {
    const actions = resolveRosterActions({ ...base, runStatus: "PUBLISHED", isPublished: true, hasLocalEdits: true });
    expect(actions).toMatchObject({ update: true, discard: true, save: false, publish: false, repost: false });
  });

  it("published + saved/Run-settings changes (server dirty) → Update Roster; Publish blocked until clean", () => {
    const actions = resolveRosterActions({
      ...base,
      runStatus: "PUBLISHED",
      isPublished: true,
      hasUnpublishedChanges: true,
    });
    expect(actions).toMatchObject({ update: true, save: false, publish: false, repost: false, discard: false });
  });

  it("after Update (clean again) → Publish Roster available again", () => {
    const actions = resolveRosterActions({ ...base, runStatus: "PUBLISHED", isPublished: true });
    expect(actions.repost).toBe(true);
    expect(actions.update).toBe(false);
  });

  it("legacy unseeded published roster: seed button; clean → repost available", () => {
    expect(
      resolveRosterActions({ ...base, runStatus: "PUBLISHED", isPublished: true, needsPublishSeed: true }),
    ).toMatchObject({ seed: true, repost: true, update: false, save: false });
  });

  it("locked roster (after Start) → no actions", () => {
    const actions = resolveRosterActions({ ...base, canEdit: false, runStatus: "IN_PROGRESS", isPublished: true });
    expect(Object.values(actions).some(Boolean)).toBe(false);
  });
});
