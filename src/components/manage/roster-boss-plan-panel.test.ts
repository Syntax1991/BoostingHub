import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RosterBossPlanPanel } from "@/components/manage/roster-boss-plan-panel";
import type { BossPlanEditorSignup } from "@/components/manage/roster-boss-plan-editor";
import { plannedRunBosses, type RosterBossException } from "@/lib/roster-boss-plan";

const bundle = plannedRunBosses([
  {
    id: "venom",
    raidName: "Venomous Abyss",
    raidShortName: "Venom",
    sortOrder: 1,
    plannedBossCount: 2,
    bosses: [
      { id: "v1", name: "First", sortOrder: 1 },
      { id: "v2", name: "Second", sortOrder: 2 },
    ],
  },
  { id: "tide", raidName: "Tidebound Grotto", raidShortName: "Tide", sortOrder: 2, plannedBossCount: 1, bosses: [{ id: "t1", name: "Tide Boss", sortOrder: 1 }] },
]);

const sham: BossPlanEditorSignup = {
  id: "sham",
  userId: "u1",
  status: "PENDING",
  participationType: "BOOSTER",
  character: { id: "c1", name: "Bexsham", realm: "Antonidas" },
  characterActive: true,
  boosterApproved: true,
  assignableRoles: ["HEALER", "RANGED_DPS"],
};

function render(exceptions: RosterBossException[], warnings: Array<{ code: string; message: string; bossKeys: string[] }> = []) {
  return renderToStaticMarkup(
    createElement(RosterBossPlanPanel, {
      bosses: bundle,
      exceptions,
      slots: [{ signup: sham, name: "Bexsham-Antonidas", wowClass: "SHAMAN", role: "HEALER" }],
      signups: [sham],
      stagedSlotIds: new Set(["sham"]),
      evaluation: { issues: [], warnings },
      editing: true,
      onChange: () => {},
    }),
  );
}

describe("Boss plan panel markup", () => {
  it("one numbered chip per planned boss, Bundle contents labelled; nothing selected until a boss is picked", () => {
    const html = render([]);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(3);
    expect(html).toContain(">Venom<");
    expect(html).toContain(">Tide<");
    expect(html).toContain('title="2. Second"');
    expect(html).not.toContain("Reset all bosses");
    expect(html).not.toContain("<select");
  });

  it("marks bosses with exceptions and warnings, lists the per-boss warnings, offers Reset all", () => {
    const html = render(
      [{ slotSignupId: "sham", runRaidContentId: "venom", raidBossId: "v2", playSignupId: null, role: "RANGED_DPS" }],
      [{ code: "BOSS_COMPOSITION", message: "Venom 2: 0 of 1 Healer.", bossKeys: ["venom:v2"] }],
    );
    expect(html.match(/aria-label="Has exceptions"/g)).toHaveLength(1);
    expect(html.match(/aria-label="Has warnings"/g)).toHaveLength(1);
    expect(html).toContain("Venom 2: 0 of 1 Healer.");
    expect(html).toContain("Reset all bosses");
  });
});
