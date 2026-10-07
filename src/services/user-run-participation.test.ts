import { describe, expect, it } from "vitest";
import {
  isMyRunsPendingBucket,
  isMyRunsSelectedBucket,
  resolveUserRunParticipation,
  resolveUserRunParticipationFromDraftIds,
} from "@/services/user-run-participation";

describe("resolveUserRunParticipation", () => {
  it("signup only → OFFERED, not selected", () => {
    const result = resolveUserRunParticipation({
      status: "PENDING",
      draftSelected: false,
      selectedRole: null,
      publishedRole: null,
    });
    expect(result.selectionState).toBe("OFFERED");
    expect(result.picked).toBe(false);
    expect(result.displayRole).toBeNull();
    expect(isMyRunsPendingBucket("PENDING", result)).toBe(true);
    expect(isMyRunsSelectedBucket(result)).toBe(false);
  });

  it("draft selected → DRAFT with selected role", () => {
    const result = resolveUserRunParticipation({
      status: "PENDING",
      draftSelected: true,
      selectedRole: "HEALER",
      publishedRole: null,
    });
    expect(result.selectionState).toBe("DRAFT");
    expect(result.picked).toBe(true);
    expect(result.displayRole).toBe("HEALER");
    expect(isMyRunsSelectedBucket(result)).toBe(true);
    expect(isMyRunsPendingBucket("PENDING", result)).toBe(false);
  });

  it("published selected → PUBLISHED", () => {
    const result = resolveUserRunParticipation({
      status: "SELECTED",
      draftSelected: true,
      selectedRole: "HEALER",
      publishedRole: "HEALER",
    });
    expect(result.selectionState).toBe("PUBLISHED");
    expect(result.picked).toBe(true);
    expect(result.displayRole).toBe("HEALER");
  });

  it("published role wins over draft role when roster is published", () => {
    const result = resolveUserRunParticipation({
      status: "SELECTED",
      draftSelected: true,
      selectedRole: "RANGED_DPS",
      publishedRole: "HEALER",
    });
    expect(result.selectionState).toBe("PUBLISHED");
    expect(result.displayRole).toBe("HEALER");
  });

  it("draft deselected → falls back to OFFERED", () => {
    const result = resolveUserRunParticipation({
      status: "PENDING",
      draftSelected: false,
      selectedRole: null,
      publishedRole: null,
    });
    expect(result.selectionState).toBe("OFFERED");
    expect(result.picked).toBe(false);
  });

  it("offspec draft role is authoritative displayRole", () => {
    const result = resolveUserRunParticipation({
      status: "PENDING",
      draftSelected: true,
      selectedRole: "RANGED_DPS",
      publishedRole: null,
    });
    expect(result.displayRole).toBe("RANGED_DPS");
  });

  it("NOT_SELECTED without draft pick stays not selected", () => {
    const result = resolveUserRunParticipation({
      status: "NOT_SELECTED",
      draftSelected: false,
      selectedRole: null,
      publishedRole: null,
    });
    expect(result.selectionState).toBe("NOT_SELECTED");
    expect(result.picked).toBe(false);
  });

  it("WITHDRAWN ignores draft flags", () => {
    const result = resolveUserRunParticipation({
      status: "WITHDRAWN",
      draftSelected: true,
      selectedRole: "HEALER",
      publishedRole: null,
    });
    expect(result.selectionState).toBe("WITHDRAWN");
    expect(result.picked).toBe(false);
    expect(result.displayRole).toBeNull();
  });
});

describe("resolveUserRunParticipationFromDraftIds", () => {
  it("resolves only signup ids present in the draft map", () => {
    const draft = new Map<string, "HEALER" | null>([["a", "HEALER"]]);
    const a = resolveUserRunParticipationFromDraftIds(
      { id: "a", status: "PENDING", publishedRole: null },
      draft,
    );
    const b = resolveUserRunParticipationFromDraftIds(
      { id: "b", status: "PENDING", publishedRole: null },
      draft,
    );
    expect(a.selectionState).toBe("DRAFT");
    expect(a.displayRole).toBe("HEALER");
    expect(b.selectionState).toBe("OFFERED");
  });

  it("external / absent signup ids are not selected", () => {
    const draft = new Map<string, "TANK" | null>();
    const result = resolveUserRunParticipationFromDraftIds(
      { id: "external-placeholder", status: "PENDING", publishedRole: null },
      draft,
    );
    expect(result.selectionState).toBe("OFFERED");
    expect(result.picked).toBe(false);
  });
});
