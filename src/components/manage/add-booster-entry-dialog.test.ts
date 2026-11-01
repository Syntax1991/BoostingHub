import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/controllers/roster.actions", () => ({
  addRosterPlayerAction: vi.fn(),
  getRosterManualAddOptionsAction: vi.fn(),
  searchRosterPlayersAction: vi.fn(),
  saveExternalBoostersAction: vi.fn(),
}));

import { AddBoosterEntryDialog } from "@/components/manage/add-booster-entry-dialog";
import type { ExternalBooster } from "@/lib/external-booster";

const externals: ExternalBooster[] = [
  { id: "ext-1", name: "Helper", wowClass: "PRIEST", participationType: "BOOSTER", role: "HEALER" },
];

function render(initialMode?: "registered" | "external", boosters: ExternalBooster[] = externals) {
  return renderToStaticMarkup(
    createElement(AddBoosterEntryDialog, {
      runId: "run-1",
      rosterVersion: 3,
      externalBoosters: boosters,
      initialMode,
      onClose: () => {},
      onAdded: () => {},
    }),
  );
}

describe("shared Add Booster entry", () => {
  it("opens on the registered player search with a Registered / External switch", () => {
    const html = render();
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/aria-selected="true"[^>]*>Registered player</);
    expect(html).toContain("External (1)");
    expect(html).toContain(">Add Booster<");
    expect(html).toContain("Add to Roster");
    expect(html).not.toContain("External boosters</h2>");
  });

  it("External mode is the existing External Boosters editor (entries, Add, Save), same switch on top", () => {
    const html = render("external");
    expect(html).toMatch(/aria-selected="true"[^>]*>External \(1\)</);
    expect(html).toContain("External boosters");
    expect(html).toContain("@Helper");
    expect(html).toContain(">Add<");
    expect(html).toContain(">Save<");
    expect(html).not.toContain("Add to Roster");
  });

  it("no externals yet: the switch reads just External", () => {
    expect(render("registered", [])).toMatch(/>External</);
  });
});
