import { describe, expect, it } from "vitest";
import { groupMyRunsByRun, myRunsSelectionPhrase, type MyRunsOffer } from "@/lib/my-runs-groups";

type Row = MyRunsOffer & { canWithdraw: boolean; canWithdrawWithReason: boolean };

function row(overrides: Partial<Row> & Pick<Row, "id">): Row {
  return {
    runId: "run-sat",
    runTitle: "Sat 21:30 HC VIP 10/10 UwE",
    contentTitle: "Venom & Tide & Kithix",
    difficulty: "HEROIC",
    scheduledStartAt: "2026-10-31T20:30:00.000Z",
    status: "PENDING",
    selectionState: "OFFERED",
    displayRole: null,
    offeredRoles: ["HEALER"],
    participationType: "BOOSTER",
    characterName: "Synbeast",
    characterRealm: "Antonidas",
    lootbuddyClass: null,
    canWithdraw: true,
    canWithdrawWithReason: false,
    ...overrides,
  };
}

const synblastDraft = row({
  id: "s-blast",
  characterName: "Synblast",
  selectionState: "DRAFT",
  displayRole: "HEALER",
  canWithdraw: false,
  canWithdrawWithReason: true,
});
const pendingSat = [
  row({ id: "s-beast", characterName: "Synbeast", offeredRoles: ["RANGED_DPS"] }),
  row({ id: "s-void", characterName: "Synvoid" }),
  row({ id: "s-mist", characterName: "Synmist" }),
  row({ id: "s-light", characterName: "Synlight" }),
];

describe("groupMyRunsByRun — Pending Run blocks with selected context", () => {
  it("1. a Pending Run without a selected participation renders normally (no context)", () => {
    const [group] = groupMyRunsByRun(pendingSat, []);
    expect(group!.selectedContext).toEqual([]);
    expect(group!.offers.map((offer) => offer.id)).toEqual(["s-beast", "s-void", "s-mist", "s-light"]);
  });

  it("2./3. a Pending Run with a selected participation carries it as context — name and role", () => {
    const [group] = groupMyRunsByRun(pendingSat, [synblastDraft]);
    expect(group!.selectedContext).toHaveLength(1);
    expect(group!.selectedContext[0]).toMatchObject({ characterName: "Synblast", characterRealm: "Antonidas", displayRole: "HEALER" });
  });

  it("4. the selected state comes from the authoritative selectionState (Draft vs Published)", () => {
    expect(myRunsSelectionPhrase(synblastDraft, "Pending")).toBe("Selected · Draft");
    expect(myRunsSelectionPhrase({ selectionState: "PUBLISHED" }, "Selected")).toBe("Selected · Confirmed");
    // Signup order / status alone never makes a row "selected".
    expect(myRunsSelectionPhrase({ selectionState: "OFFERED" }, "Pending")).toBe("Pending");
  });

  it("5./6. pending participations stay listed with their Withdraw capability unchanged", () => {
    const [group] = groupMyRunsByRun(pendingSat, [synblastDraft]);
    expect(group!.offers).toEqual(pendingSat);
    expect(group!.offers.every((offer) => offer.canWithdraw)).toBe(true);
  });

  it("7. the selected participation is never duplicated as a pending row (and vice versa)", () => {
    const [group] = groupMyRunsByRun(pendingSat, [synblastDraft]);
    expect(group!.offers.map((offer) => offer.id)).not.toContain("s-blast");
    // A row listed in the section itself is never repeated as context.
    const [same] = groupMyRunsByRun([synblastDraft], [synblastDraft]);
    expect(same!.selectedContext).toEqual([]);
  });

  it("8. selected context never leaks into another Run's block", () => {
    const pendingFri = row({ id: "f-1", runId: "run-fri", runTitle: "Fri 20:00 HC VIP 10/10 Alantra" });
    const groups = groupMyRunsByRun([...pendingSat, pendingFri], [synblastDraft]);
    expect(groups.map((group) => [group.runId, group.selectedContext.map((pick) => pick.id)])).toEqual([
      ["run-sat", ["s-blast"]],
      ["run-fri", []],
    ]);
    // A selection on a Run with no pending block is simply not shown here.
    expect(groupMyRunsByRun([pendingFri], [synblastDraft])[0]!.selectedContext).toEqual([]);
  });

  it("multiple selected participations on one Run (Booster + Lootbuddy) are all shown", () => {
    const lootbuddy = row({
      id: "s-lb",
      participationType: "LOOTBUDDY",
      characterName: null,
      lootbuddyClass: "MAGE",
      selectionState: "PUBLISHED",
      status: "SELECTED",
    });
    const [group] = groupMyRunsByRun(pendingSat, [synblastDraft, lootbuddy]);
    expect(group!.selectedContext.map((pick) => pick.id)).toEqual(["s-blast", "s-lb"]);
  });

  it("only draft/published picks count as context — never another non-selected row", () => {
    const notPicked = row({ id: "s-np", status: "NOT_SELECTED", selectionState: "NOT_SELECTED" });
    expect(groupMyRunsByRun(pendingSat, [notPicked])[0]!.selectedContext).toEqual([]);
  });

  it("10. the Run block uses the compact raid title from the shared helper", () => {
    const [group] = groupMyRunsByRun(pendingSat, []);
    expect(group!.contentTitle).toBe("Venom & Tide & Kithix");
  });
});
