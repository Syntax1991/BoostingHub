import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/controllers/run-consumable-audit.actions", () => ({
  analyzeRunConsumablesAction: vi.fn(),
  attachRunWarcraftLogsReportAction: vi.fn(),
  decideRunWarcraftLogsFightAction: vi.fn(),
  detachRunWarcraftLogsReportAction: vi.fn(),
  rescanRunWarcraftLogsAction: vi.fn(),
}));

import { RunWarcraftLogsPanel } from "@/components/runs/run-warcraft-logs-panel";
import type { RunWarcraftLogsView } from "@/services/run-warcraft-logs.service";

const logs: RunWarcraftLogsView = {
  runWindow: { startedAt: "2026-09-28T17:13:33.000Z", completedAt: "2026-09-28T21:39:00.000Z" },
  toleranceSeconds: 300,
  reports: [
    {
      code: "WV3BMCHnLvZfb9Yd",
      title: "Manawyrm Logging",
      url: "https://www.warcraftlogs.com/reports/WV3BMCHnLvZfb9Yd",
      startAt: "2026-09-28T17:19:15.807Z",
      endAt: "2026-09-28T18:54:09.998Z",
      lastScannedAt: "2026-09-28T22:00:00.000Z",
      attachedAt: "2026-09-28T21:39:53.038Z",
      attachedByName: "Syntax",
      source: "MANUAL",
      assigned: 1,
      needsReview: 1,
      ignored: 0,
      assignedFrom: "2026-09-28T17:43:57.453Z",
      assignedTo: "2026-09-28T17:48:05.656Z",
      sharedWithRuns: 0,
      overlappingFights: 0,
    },
  ],
  fights: [
    {
      id: "f1",
      reportCode: "WV3BMCHnLvZfb9Yd",
      wclFightId: 4,
      encounterName: "Nymrissa Wavecaller",
      label: "Nymrissa Wavecaller",
      kill: true,
      startAt: "2026-09-28T17:43:57.453Z",
      endAt: "2026-09-28T17:48:05.656Z",
      status: "NEEDS_REVIEW",
      manual: false,
      reasons: [],
      rosterMatched: 14,
      rosterSize: 15,
    },
  ],
  needsReview: 1,
};

describe("RunWarcraftLogsPanel action buttons", () => {
  it("only 'Link & analyze' submits the link form; Re-scan, Re-analyze, Detach and fight decisions are plain buttons, enabled when idle", () => {
    const html = renderToStaticMarkup(
      createElement(RunWarcraftLogsPanel, { runId: "run-1", logs, canManage: true, wclConfigured: true, stale: false, hasSnapshot: true }),
    );
    const buttons = [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({
      attrs: match[1]!,
      label: match[2]!.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim(),
    }));
    const byLabel = (label: string) => buttons.find((button) => button.label === label);
    for (const label of ["Re-scan fights", "Re-analyze", "Detach", "Assign to this run", "Remove from this run"]) {
      expect(byLabel(label)?.attrs).toContain('type="button"');
      expect(byLabel(label)?.attrs).not.toMatch(/\sdisabled=""/); // the attribute, not the Tailwind "disabled:" variant
    }
    expect(buttons.filter((button) => button.attrs.includes('type="submit"')).map((button) => button.label)).toEqual(["Link & analyze"]);
  });
});
