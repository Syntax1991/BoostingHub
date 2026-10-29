import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/controllers/run.actions", () => ({
  cancelRunAction: vi.fn(),
  closeRunSignupsAction: vi.fn(),
  completeRunAction: vi.fn(),
  openRunAction: vi.fn(),
  reactivateRunAction: vi.fn(),
  reopenRunSignupsAction: vi.fn(),
  startRunAction: vi.fn(),
  updateRunAction: vi.fn(),
}));
vi.mock("@/controllers/roster.actions", () => ({
  applyRosterBuilderAction: vi.fn(),
  proposeRosterBuilderAction: vi.fn(),
}));

import { RunRosterConfigAdmin } from "@/components/runs/run-roster-config-admin";
import type { RunDetailView } from "@/services/run-detail.service";

const capabilities = {
  canEdit: true,
  canOpen: false,
  canCloseSignups: true,
  canReopenSignups: false,
  canCancel: true,
  canReactivate: false,
  canStart: false,
  canComplete: false,
};

function view(input: { notes: string | null; canManageRun: boolean }): RunDetailView {
  return {
    run: { id: "run-1", cancelledFromStatus: null },
    overview: { notes: input.notes, productLabel: "Manaforge Omega", contentSummary: "Manaforge Omega 8/8" },
    permissions: { canManageRun: input.canManageRun },
    capabilities,
    editor: null,
    attendance: { manager: null },
    finalSetupPreview: null,
    manager: {
      roster: { hasUnpublishedChanges: false, canEdit: true, externalBoosters: [{ id: "e1" }], version: 2 },
    },
    preflight: null,
  } as unknown as RunDetailView;
}

describe("Roster tab Run administration bar", () => {
  it("managers: notes + Run actions in one row; no repeated Run configuration, no separate External Boosters entry", () => {
    const html = renderToStaticMarkup(
      createElement(RunRosterConfigAdmin, { data: view({ notes: "Bring flasks", canManageRun: true }) }),
    );
    expect(html).toContain("Bring flasks");
    expect(html).toContain(">Edit Run<");
    expect(html).toContain(">Close Signups<");
    expect(html).toContain(">Cancel Run<");
    expect(html).not.toContain("Run configuration");
    expect(html).not.toContain("Manaforge Omega");
    expect(html).not.toContain("External Boosters");
    expect(html).not.toContain("Add Booster");
  });

  it("viewers see only the notes; nothing at all without notes", () => {
    const html = renderToStaticMarkup(createElement(RunRosterConfigAdmin, { data: view({ notes: "Bring flasks", canManageRun: false }) }));
    expect(html).toContain("Bring flasks");
    expect(html).not.toContain("Edit Run");
    expect(renderToStaticMarkup(createElement(RunRosterConfigAdmin, { data: view({ notes: null, canManageRun: false }) }))).toBe("");
  });
});
