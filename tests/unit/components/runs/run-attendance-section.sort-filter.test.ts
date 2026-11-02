import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/controllers/attendance.actions", () => ({
  markAllPresentAction: vi.fn(),
  replaceParticipantAction: vi.fn(),
  setAttendanceAction: vi.fn(),
  correctAttendanceAction: vi.fn(),
}));
vi.mock("@/controllers/run.actions", () => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : vi.fn()) }));

import { RunAttendanceSection } from "@/components/runs/run-attendance-section";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/labels";

function managerRow(id: string, characterName: string, selectedRole: string | null, status: string, participationType = "BOOSTER") {
  return {
    id,
    characterName,
    characterRealm: "Antonidas",
    userName: `${characterName}-player`,
    wowClass: "MAGE",
    selectedRole,
    participationType,
    isBackup: false,
    status,
    note: null,
    markedAt: null,
    markedByName: null,
  };
}

const rows = [
  managerRow("a1", "Zed", "RANGED_DPS", "PRESENT"),
  managerRow("a2", "Bruno", "TANK", "UNMARKED"),
  managerRow("a3", "anna", "HEALER", "UNMARKED"),
  managerRow("a4", "Carl", null, "UNMARKED", "LOOTBUDDY"),
];

function data() {
  return {
    run: { id: "r1", status: "IN_PROGRESS" },
    capabilities: { canStart: false, canComplete: true },
    finalSetupPreview: null,
    attendance: {
      own: [],
      manager: {
        started: true,
        canMutate: true,
        canCorrect: false,
        rows,
        summary: {
          unmarked: 3,
          counts: { UNMARKED: 3, PRESENT: 1, LATE: 0, LEFT_EARLY: 0, NO_SHOW: 0, EXCUSED: 0, STANDBY: 0 },
        },
        externalBoosters: [],
        replacementCandidates: [],
      },
    },
  } as never;
}

describe("Attendance sort + filter toolbar", () => {
  const html = renderToStaticMarkup(createElement(RunAttendanceSection, { data: data() }));

  it("defaults: Sort Attendance, every filter All, full list visible, no result count / Reset", () => {
    expect(html).toMatch(/<option value="attendance" selected="">Sort: Attendance<\/option>/);
    expect(html).toMatch(/<option value="ALL" selected="">Status: All<\/option>/);
    expect(html).toMatch(/<option value="ALL" selected="">Role: All<\/option>/);
    expect(html).toMatch(/<option value="ALL" selected="">Type: All<\/option>/);
    expect(html).not.toContain("shown");
    expect(html).not.toContain(">Reset<");
    for (const name of ["Zed", "Bruno", "anna", "Carl"]) expect(html).toContain(`>${name}<`);
  });

  it("rows render in the default order: UNMARKED by role first, then resolved", () => {
    const order = ["Bruno", "anna", "Carl", "Zed"].map((name) => html.indexOf(`>${name}<`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("offers only authoritative options: all statuses, concrete roles, occurring types; no Backup without backups", () => {
    for (const label of Object.values(ATTENDANCE_STATUS_LABELS)) {
      expect(html.toLowerCase()).toContain(`>${label.toLowerCase()}<`);
    }
    expect(html).toContain(">Melee DPS<");
    expect(html).toContain(">Ranged DPS<");
    expect(html).not.toMatch(/<option value="DPS"/);
    expect(html).toContain('<option value="LOOTBUDDY">Lootbuddy</option>');
    expect(html).not.toContain("Backup: All");
  });

  it("Complete Run and the bulk action use the authoritative unmarked count of the whole set", () => {
    expect(html).toContain("Complete Run (3 unmarked)");
    expect(html).toContain("Mark all unmarked as Present");
  });
});
