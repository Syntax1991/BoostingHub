import { describe, expect, it } from "vitest";
import { hasUnpublishedRosterChanges, type PublishStateSignup } from "@/services/roster-publish-state";

const PUBLISHED_AT = "2026-09-25T10:00:00.000Z";

function booster(id: string, status: PublishStateSignup["status"], publishedRole: PublishStateSignup["publishedRole"] = null): PublishStateSignup {
  return { id, status, participationType: "BOOSTER", publishedRole };
}

function lootbuddy(id: string, status: PublishStateSignup["status"]): PublishStateSignup {
  return { id, status, participationType: "LOOTBUDDY", publishedRole: null };
}

describe("hasUnpublishedRosterChanges", () => {
  it("is false before anything was published", () => {
    expect(
      hasUnpublishedRosterChanges({
        runChangedSinceAck: false,
        publishedAt: null,
        version: 3,
        draft: [{ signupId: "a", selectedRole: "HEALER" }],
        signups: [booster("a", "PENDING")],
      }),
    ).toBe(false);
  });

  it("is false for a freshly published roster (draft == published, roles included)", () => {
    expect(
      hasUnpublishedRosterChanges({
        runChangedSinceAck: false,
        publishedAt: PUBLISHED_AT,
        version: 4,
        draft: [
          { signupId: "a", selectedRole: "HEALER" },
          { signupId: "l", selectedRole: null },
        ],
        signups: [booster("a", "SELECTED", "HEALER"), lootbuddy("l", "SELECTED"), booster("b", "NOT_SELECTED")],
      }),
    ).toBe(false);
  });

  it("membership: published A, draft A+B → dirty", () => {
    expect(
      hasUnpublishedRosterChanges({
        runChangedSinceAck: false,
        publishedAt: PUBLISHED_AT,
        version: 5,
        draft: [
          { signupId: "a", selectedRole: "HEALER" },
          { signupId: "b", selectedRole: "DPS" },
        ],
        signups: [booster("a", "SELECTED", "HEALER"), booster("b", "PENDING")],
      }),
    ).toBe(true);
  });

  it("membership: published A, draft B (replacement) → dirty; draft empty after seeding → dirty", () => {
    const signups = [booster("a", "SELECTED", "HEALER"), booster("b", "PENDING")];
    expect(
      hasUnpublishedRosterChanges({
        runChangedSinceAck: false, publishedAt: PUBLISHED_AT, version: 5, draft: [{ signupId: "b", selectedRole: "HEALER" }], signups }),
    ).toBe(true);
    expect(hasUnpublishedRosterChanges({
        runChangedSinceAck: false, publishedAt: PUBLISHED_AT, version: 5, draft: [], signups })).toBe(true);
  });

  it("role: published A HEALER, draft A DPS → dirty", () => {
    expect(
      hasUnpublishedRosterChanges({
        runChangedSinceAck: false,
        publishedAt: PUBLISHED_AT,
        version: 5,
        draft: [{ signupId: "a", selectedRole: "DPS" }],
        signups: [booster("a", "SELECTED", "HEALER")],
      }),
    ).toBe(true);
  });

  it("a never-seeded draft (version 1, empty, published selection exists) is clean", () => {
    expect(
      hasUnpublishedRosterChanges({
        runChangedSinceAck: false,
        publishedAt: PUBLISHED_AT,
        version: 1,
        draft: [],
        signups: [booster("a", "SELECTED", "HEALER")],
      }),
    ).toBe(false);
  });

  it("ignores draft rows of WITHDRAWN signups (Publish ignores them too)", () => {
    expect(
      hasUnpublishedRosterChanges({
        runChangedSinceAck: false,
        publishedAt: PUBLISHED_AT,
        version: 6,
        draft: [
          { signupId: "a", selectedRole: "HEALER" },
          { signupId: "w", selectedRole: "DPS" },
        ],
        signups: [booster("a", "SELECTED", "HEALER"), booster("w", "WITHDRAWN")],
      }),
    ).toBe(false);
  });

  it("a withdrawn published player leaves the published side, so a draft still holding them is dirty only if others differ", () => {
    // Published A withdrew (no longer SELECTED); the draft row is ignored → published {} vs draft {} → clean.
    expect(
      hasUnpublishedRosterChanges({
        runChangedSinceAck: false,
        publishedAt: PUBLISHED_AT,
        version: 6,
        draft: [{ signupId: "a", selectedRole: "HEALER" }],
        signups: [booster("a", "WITHDRAWN")],
      }),
    ).toBe(false);
  });

  it("a legacy published slot without publishedRole matches any draft role", () => {
    expect(
      hasUnpublishedRosterChanges({
        runChangedSinceAck: false,
        publishedAt: PUBLISHED_AT,
        version: 6,
        draft: [{ signupId: "a", selectedRole: "TANK" }],
        signups: [booster("a", "SELECTED", null)],
      }),
    ).toBe(false);
  });

  it("lootbuddy slots never compare roles", () => {
    expect(
      hasUnpublishedRosterChanges({
        runChangedSinceAck: false,
        publishedAt: PUBLISHED_AT,
        version: 6,
        draft: [{ signupId: "l", selectedRole: "DPS" }],
        signups: [lootbuddy("l", "SELECTED")],
      }),
    ).toBe(false);
  });

  it("changed Run settings (runChangedSinceAck) make an otherwise identical published roster dirty", () => {
    const input = {
      publishedAt: PUBLISHED_AT,
      version: 4,
      draft: [{ signupId: "a", selectedRole: "HEALER" as const }],
      signups: [booster("a", "SELECTED", "HEALER")],
    };
    expect(hasUnpublishedRosterChanges({ ...input, runChangedSinceAck: false })).toBe(false);
    expect(hasUnpublishedRosterChanges({ ...input, runChangedSinceAck: true })).toBe(true);
  });

  it("runChangedSinceAck is ignored before the first publish (nothing to acknowledge yet)", () => {
    expect(
      hasUnpublishedRosterChanges({
        runChangedSinceAck: true,
        publishedAt: null,
        version: 2,
        draft: [],
        signups: [],
      }),
    ).toBe(false);
  });
});
