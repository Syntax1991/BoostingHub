import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_ROLE_FILTER_OPTIONS,
  ATTENDANCE_STATUS_SORT_ORDER,
  DEFAULT_ATTENDANCE_FILTERS,
  DEFAULT_ATTENDANCE_SORT,
  attendanceFilterAvailability,
  filterAttendanceRows,
  isDefaultAttendanceFilters,
  sortAttendanceRows,
  viewAttendanceRows,
  type AttendanceViewRow,
} from "@/lib/attendance-view";
import { ATTENDANCE_STATUSES } from "@/models/enums";

let seq = 0;
function row(partial: Partial<AttendanceViewRow> & Pick<AttendanceViewRow, "characterName">): AttendanceViewRow {
  seq += 1;
  return {
    id: `a${String(seq).padStart(3, "0")}`,
    characterRealm: "Antonidas",
    userName: `player${seq}`,
    selectedRole: "RANGED_DPS",
    participationType: "BOOSTER",
    isBackup: false,
    status: "UNMARKED",
    ...partial,
  };
}

const rows: AttendanceViewRow[] = [
  row({ characterName: "Zed", selectedRole: "RANGED_DPS", status: "PRESENT" }),
  row({ characterName: "anna", selectedRole: "HEALER", status: "UNMARKED" }),
  row({ characterName: "Bruno", selectedRole: "TANK", status: "UNMARKED" }),
  row({ characterName: "Mira", selectedRole: "MELEE_DPS", status: "UNMARKED" }),
  row({ characterName: "Carl", selectedRole: null, participationType: "LOOTBUDDY", status: "UNMARKED" }),
  row({ characterName: "Dora", selectedRole: "TANK", status: "NO_SHOW" }),
  row({ characterName: "Eli", selectedRole: "HEALER", status: "LATE", isBackup: true, userName: "Synblast" }),
  row({ characterName: "Finn", selectedRole: "RANGED_DPS", status: "UNMARKED" }),
];
const names = (list: AttendanceViewRow[]) => list.map((entry) => entry.characterName);

describe("attendance sorting", () => {
  it("default sort is Attendance; status order is UNMARKED first, then the domain enum order", () => {
    expect(DEFAULT_ATTENDANCE_SORT).toBe("attendance");
    expect(ATTENDANCE_STATUS_SORT_ORDER).toEqual(["UNMARKED", "PRESENT", "LATE", "LEFT_EARLY", "NO_SHOW", "EXCUSED", "STANDBY"]);
    expect(ATTENDANCE_STATUS_SORT_ORDER).toEqual(ATTENDANCE_STATUSES);
  });

  it("Attendance: UNMARKED before resolved; within a status Tank → Healer → Melee → Ranged → no role, then name", () => {
    expect(names(sortAttendanceRows(rows, "attendance"))).toEqual([
      "Bruno", // UNMARKED tank
      "anna", // UNMARKED healer
      "Mira", // UNMARKED melee
      "Finn", // UNMARKED ranged
      "Carl", // UNMARKED lootbuddy (no role)
      "Zed", // PRESENT
      "Eli", // LATE
      "Dora", // NO_SHOW
    ]);
  });

  it("Role: authoritative role order, then Character (Melee and Ranged stay apart)", () => {
    expect(names(sortAttendanceRows(rows, "role"))).toEqual(["Bruno", "Dora", "anna", "Eli", "Mira", "Finn", "Zed", "Carl"]);
  });

  it("Character: alphabetical, case-insensitive; realm breaks ties", () => {
    expect(names(sortAttendanceRows(rows, "character"))).toEqual(["anna", "Bruno", "Carl", "Dora", "Eli", "Finn", "Mira", "Zed"]);
    const twins = [
      row({ characterName: "Same", characterRealm: "Thrall" }),
      row({ characterName: "same", characterRealm: "Antonidas" }),
    ];
    expect(sortAttendanceRows(twins, "character").map((entry) => entry.characterRealm)).toEqual(["Antonidas", "Thrall"]);
  });

  it("Type: Booster then Lootbuddy (domain order), each by role then Character — deterministic", () => {
    const sorted = sortAttendanceRows(rows, "type");
    expect(names(sorted)).toEqual(["Bruno", "Dora", "anna", "Eli", "Mira", "Finn", "Zed", "Carl"]);
    expect(names(sortAttendanceRows([...rows].reverse(), "type"))).toEqual(names(sorted));
  });

  it("changing a status moves the row into its new group under Attendance sort", () => {
    const updated = rows.map((entry) => (entry.characterName === "anna" ? { ...entry, status: "PRESENT" as const } : entry));
    const sorted = names(sortAttendanceRows(updated, "attendance"));
    expect(sorted.indexOf("anna")).toBeGreaterThan(sorted.indexOf("Carl"));
    expect(sorted.slice(4, 6)).toEqual(["anna", "Zed"]); // PRESENT group: healer before ranged
  });

  it("never mutates the input", () => {
    const snapshot = JSON.stringify(rows);
    sortAttendanceRows(rows, "character");
    viewAttendanceRows(rows, { ...DEFAULT_ATTENDANCE_FILTERS, status: "UNMARKED" }, "role");
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});

describe("attendance filters", () => {
  it("defaults to All — the full list stays visible", () => {
    expect(isDefaultAttendanceFilters(DEFAULT_ATTENDANCE_FILTERS)).toBe(true);
    expect(filterAttendanceRows(rows, DEFAULT_ATTENDANCE_FILTERS)).toHaveLength(rows.length);
  });

  it("Status Unmarked shows only unmarked rows", () => {
    expect(names(filterAttendanceRows(rows, { ...DEFAULT_ATTENDANCE_FILTERS, status: "UNMARKED" })).sort()).toEqual(
      ["Bruno", "Carl", "Finn", "Mira", "anna"].sort(),
    );
  });

  it("Role keeps Melee and Ranged distinct; options never offer generic DPS", () => {
    expect(ATTENDANCE_ROLE_FILTER_OPTIONS).toEqual(["TANK", "HEALER", "MELEE_DPS", "RANGED_DPS"]);
    expect(names(filterAttendanceRows(rows, { ...DEFAULT_ATTENDANCE_FILTERS, role: "MELEE_DPS" }))).toEqual(["Mira"]);
    expect(names(filterAttendanceRows(rows, { ...DEFAULT_ATTENDANCE_FILTERS, role: "RANGED_DPS" })).sort()).toEqual(["Finn", "Zed"]);
  });

  it("Type uses the participation type; only types that occur are offered", () => {
    expect(names(filterAttendanceRows(rows, { ...DEFAULT_ATTENDANCE_FILTERS, type: "LOOTBUDDY" }))).toEqual(["Carl"]);
    expect(attendanceFilterAvailability(rows)).toEqual({ types: ["BOOSTER", "LOOTBUDDY"], hasBackups: true });
    expect(attendanceFilterAvailability(rows.filter((entry) => entry.participationType === "BOOSTER" && !entry.isBackup))).toEqual({
      types: ["BOOSTER"],
      hasBackups: false,
    });
  });

  it("Search matches Character, realm or player name, case-insensitively", () => {
    expect(names(filterAttendanceRows(rows, { ...DEFAULT_ATTENDANCE_FILTERS, search: "ANN" }))).toEqual(["anna"]);
    expect(names(filterAttendanceRows(rows, { ...DEFAULT_ATTENDANCE_FILTERS, search: "synb" }))).toEqual(["Eli"]);
    expect(filterAttendanceRows(rows, { ...DEFAULT_ATTENDANCE_FILTERS, search: "antonidas" })).toHaveLength(rows.length);
  });

  it("filters combine with AND, then sort; backup filter splits main roster and backups", () => {
    const visible = viewAttendanceRows(rows, { ...DEFAULT_ATTENDANCE_FILTERS, status: "UNMARKED", role: "HEALER" }, "attendance");
    expect(names(visible)).toEqual(["anna"]);
    expect(names(filterAttendanceRows(rows, { ...DEFAULT_ATTENDANCE_FILTERS, backup: "BACKUP" }))).toEqual(["Eli"]);
    expect(filterAttendanceRows(rows, { ...DEFAULT_ATTENDANCE_FILTERS, backup: "MAIN" })).toHaveLength(rows.length - 1);
    expect(isDefaultAttendanceFilters({ ...DEFAULT_ATTENDANCE_FILTERS, search: "  " })).toBe(true);
    expect(isDefaultAttendanceFilters({ ...DEFAULT_ATTENDANCE_FILTERS, role: "TANK" })).toBe(false);
  });

  it("a status change removes the row from an Unmarked view", () => {
    const filters = { ...DEFAULT_ATTENDANCE_FILTERS, status: "UNMARKED" as const };
    const updated = rows.map((entry) => (entry.characterName === "Bruno" ? { ...entry, status: "PRESENT" as const } : entry));
    expect(names(viewAttendanceRows(updated, filters, "attendance"))).not.toContain("Bruno");
    expect(viewAttendanceRows(updated, filters, "attendance")).toHaveLength(4);
  });
});
