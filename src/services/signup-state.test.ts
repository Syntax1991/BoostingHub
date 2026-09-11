import { describe, expect, it } from "vitest";
import { isActiveSignupOffer, planCharacterOfferReconciliation, type OfferReconciliationSignup } from "@/services/signup-state";

function row(
  id: string,
  characterId: string | null,
  participationType: OfferReconciliationSignup["participationType"],
  status: OfferReconciliationSignup["status"],
): OfferReconciliationSignup {
  return { id, characterId, participationType, status };
}

describe("isActiveSignupOffer", () => {
  it("is true only for PENDING and SELECTED", () => {
    expect(isActiveSignupOffer("PENDING")).toBe(true);
    expect(isActiveSignupOffer("SELECTED")).toBe(true);
    expect(isActiveSignupOffer("WITHDRAWN")).toBe(false);
    expect(isActiveSignupOffer("NOT_SELECTED")).toBe(false);
  });
});

describe("planCharacterOfferReconciliation", () => {
  it("reconciles A+B active to B+C desired: withdraws A, keeps B, creates C", () => {
    const { plan, blocked } = planCharacterOfferReconciliation({
      participationType: "BOOSTER",
      desiredCharacterIds: ["B", "C"],
      currentSignups: [
        row("s-a", "A", "BOOSTER", "PENDING"),
        row("s-b", "B", "BOOSTER", "PENDING"),
      ],
      rosterSelectedSignupIds: [],
      runStatus: "OPEN",
    });

    expect(blocked).toEqual([]);
    expect(plan?.toWithdraw).toEqual(["s-a"]);
    expect(plan?.kept).toEqual(["s-b"]);
    expect(plan?.toCreate).toEqual(["C"]);
    expect(plan?.toReactivate).toEqual([]);
  });

  it("reactivates a WITHDRAWN row instead of creating a duplicate", () => {
    const { plan, blocked } = planCharacterOfferReconciliation({
      participationType: "BOOSTER",
      desiredCharacterIds: ["A"],
      currentSignups: [row("s-a", "A", "BOOSTER", "WITHDRAWN")],
      rosterSelectedSignupIds: [],
      runStatus: "OPEN",
    });

    expect(blocked).toEqual([]);
    expect(plan?.toReactivate).toEqual([{ id: "s-a", characterId: "A" }]);
    expect(plan?.toCreate).toEqual([]);
    expect(plan?.toWithdraw).toEqual([]);
  });

  it("withdraws every active offer of the other type when switching participation type", () => {
    const { plan, blocked } = planCharacterOfferReconciliation({
      participationType: "LOOTBUDDY",
      desiredCharacterIds: ["D"],
      currentSignups: [
        row("s-a", "A", "BOOSTER", "PENDING"),
        row("s-b", "B", "BOOSTER", "PENDING"),
      ],
      rosterSelectedSignupIds: [],
      runStatus: "OPEN",
    });

    expect(blocked).toEqual([]);
    expect(plan?.toWithdraw.sort()).toEqual(["s-a", "s-b"]);
    expect(plan?.toCreate).toEqual(["D"]);
  });

  it("blocks the whole plan when a removal candidate is currently roster-draft-selected", () => {
    const { plan, blocked } = planCharacterOfferReconciliation({
      participationType: "BOOSTER",
      desiredCharacterIds: ["B"],
      currentSignups: [
        row("s-a", "A", "BOOSTER", "PENDING"),
        row("s-b", "B", "BOOSTER", "PENDING"),
      ],
      rosterSelectedSignupIds: ["s-a"],
      runStatus: "OPEN",
    });

    expect(plan).toBeNull();
    expect(blocked).toEqual([{ signupId: "s-a", reason: "ROSTER_SELECTED" }]);
  });

  it("blocks the whole plan when a removal candidate is SELECTED after publish", () => {
    const { plan, blocked } = planCharacterOfferReconciliation({
      participationType: "BOOSTER",
      desiredCharacterIds: [],
      currentSignups: [row("s-a", "A", "BOOSTER", "SELECTED")],
      rosterSelectedSignupIds: [],
      runStatus: "PUBLISHED",
    });

    expect(plan).toBeNull();
    expect(blocked).toEqual([{ signupId: "s-a", reason: "PUBLISHED_LOCKED" }]);
  });

  it("allows removing a PENDING offer freely even on a published run", () => {
    const { plan, blocked } = planCharacterOfferReconciliation({
      participationType: "BOOSTER",
      desiredCharacterIds: [],
      currentSignups: [row("s-a", "A", "BOOSTER", "PENDING")],
      rosterSelectedSignupIds: [],
      runStatus: "PUBLISHED",
    });

    expect(blocked).toEqual([]);
    expect(plan?.toWithdraw).toEqual(["s-a"]);
  });

  it("is a no-op when desired exactly matches current active offers", () => {
    const { plan, blocked } = planCharacterOfferReconciliation({
      participationType: "BOOSTER",
      desiredCharacterIds: ["A"],
      currentSignups: [row("s-a", "A", "BOOSTER", "PENDING")],
      rosterSelectedSignupIds: [],
      runStatus: "OPEN",
    });

    expect(blocked).toEqual([]);
    expect(plan?.kept).toEqual(["s-a"]);
    expect(plan?.toWithdraw).toEqual([]);
    expect(plan?.toCreate).toEqual([]);
    expect(plan?.toReactivate).toEqual([]);
  });
});
