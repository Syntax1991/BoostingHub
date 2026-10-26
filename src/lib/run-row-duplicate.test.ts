import { describe, expect, it } from "vitest";
import { CREATE_RUN_OPT_IN_DEFAULTS } from "@/lib/create-run-form-defaults";
import {
  canAddRunRow,
  duplicateRunRow,
  quickDuplicateLabel,
  shiftDatetimeLocal,
} from "@/lib/run-row-duplicate";

/** Create Run quick duplicate (copy / +1h / +2h) — real-hour arithmetic in Europe/Berlin. */

type Row = { key: string; scheduledLocal: string; overrides: Record<string, unknown>; expanded: boolean };

function row(key: string, scheduledLocal: string, overrides: Record<string, unknown> = {}): Row {
  return { key, scheduledLocal, overrides, expanded: true };
}

let counter = 0;
const newKey = () => `new-${++counter}`;

describe("shiftDatetimeLocal (Europe/Berlin, real hours)", () => {
  it("+1h / +2h add exactly one / two real hours", () => {
    expect(shiftDatetimeLocal("2026-11-12T20:00", 1)).toBe("2026-11-12T21:00");
    expect(shiftDatetimeLocal("2026-11-12T20:00", 2)).toBe("2026-11-12T22:00");
    expect(shiftDatetimeLocal("2026-11-12T20:00", 0)).toBe("2026-11-12T20:00");
  });

  it("crosses midnight, month and year boundaries", () => {
    expect(shiftDatetimeLocal("2026-11-12T23:30", 1)).toBe("2026-11-13T00:30");
    expect(shiftDatetimeLocal("2027-01-31T23:15", 2)).toBe("2027-02-01T01:15");
    expect(shiftDatetimeLocal("2026-12-31T23:00", 2)).toBe("2027-01-01T01:00");
  });

  it("DST: one real hour across spring-forward and fall-back", () => {
    // 2027-03-28 02:00 CET → 03:00 CEST: 01:30 + 1 real hour is 03:30 local.
    expect(shiftDatetimeLocal("2027-03-28T01:30", 1)).toBe("2027-03-28T03:30");
    // 2026-10-25 03:00 CEST → 02:00 CET: 01:30 CEST + 2 real hours is 02:30 CET.
    expect(shiftDatetimeLocal("2026-10-25T01:30", 2)).toBe("2026-10-25T02:30");
  });

  it("leaves an unparseable value unchanged", () => {
    expect(shiftDatetimeLocal("", 1)).toBe("");
  });
});

describe("duplicateRunRow", () => {
  const overrides = { difficulty: "MYTHIC", raidLeadId: "lead-2", notes: "bring flasks", desiredTankCount: 3 };
  const rows = [row("a", "2026-11-12T20:00"), row("b", "2026-11-13T19:30", overrides), row("c", "2026-11-14T20:00")];

  it("copies the row it is invoked on (overrides, own key) and inserts it right below", () => {
    const next = duplicateRunRow(rows, "b", 0, 25, newKey);
    expect(next.map((entry) => entry.key)).toEqual(["a", "b", expect.stringMatching(/^new-/), "c"]);
    const copy = next[2]!;
    expect(copy.scheduledLocal).toBe("2026-11-13T19:30");
    expect(copy.overrides).toEqual(overrides);
    expect(copy.overrides).not.toBe(rows[1]!.overrides);
    expect(copy.expanded).toBe(false);
    expect(rows).toHaveLength(3); // input untouched
  });

  it("+1h / +2h use the source row's start, not the last row's", () => {
    expect(duplicateRunRow(rows, "a", 1, 25, newKey)[1]!.scheduledLocal).toBe("2026-11-12T21:00");
    expect(duplicateRunRow(rows, "b", 2, 25, newKey)[2]!.scheduledLocal).toBe("2026-11-13T21:30");
  });

  it("never exceeds the 25-run limit", () => {
    const full = Array.from({ length: 25 }, (_, index) => row(`r${index}`, "2026-11-12T20:00"));
    expect(canAddRunRow(24, 25)).toBe(true);
    expect(canAddRunRow(25, 25)).toBe(false);
    expect(duplicateRunRow(full, "r3", 1, 25, newKey)).toHaveLength(25);
    expect(duplicateRunRow(full.slice(0, 24), "r3", 2, 25, newKey)).toHaveLength(25);
  });

  it("an unknown source row changes nothing", () => {
    expect(duplicateRunRow(rows, "zzz", 1, 25, newKey).map((entry) => entry.key)).toEqual(["a", "b", "c"]);
  });

  it("labels say exactly what is duplicated", () => {
    expect(quickDuplicateLabel(0)).toBe("Duplicate run");
    expect(quickDuplicateLabel(1)).toBe("Duplicate run +1 hour");
    expect(quickDuplicateLabel(2)).toBe("Duplicate run +2 hours");
  });

  it("the approved opt-in defaults stay off (duplication never touches them)", () => {
    expect(CREATE_RUN_OPT_IN_DEFAULTS.asRecurring).toBe(false);
    expect(CREATE_RUN_OPT_IN_DEFAULTS.discordRolePing).toBe(false);
    const copy = duplicateRunRow([row("a", "2026-11-12T20:00", { notes: "x" })], "a", 1, 25, newKey)[1]!;
    expect(Object.keys(copy).sort()).toEqual(["expanded", "key", "overrides", "scheduledLocal"]);
  });
});
