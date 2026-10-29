import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/controllers/roster.actions", () => ({
  addRosterPlayerAction: vi.fn(),
  applyRosterBuilderAction: vi.fn(),
  getRosterManualAddOptionsAction: vi.fn(),
  prepareRosterEditAction: vi.fn(),
  proposeRosterBuilderAction: vi.fn(),
  publishRosterAction: vi.fn(),
  repostRosterAction: vi.fn(),
  saveExternalBoostersAction: vi.fn(),
  saveRosterDraftAction: vi.fn(),
  searchRosterPlayersAction: vi.fn(),
  syncRosterCharactersAction: vi.fn(),
  updateRosterAction: vi.fn(),
}));

import { RosterBuilderView } from "@/components/manage/roster-builder";

type View = Parameters<typeof RosterBuilderView>[0]["data"];

/** The smallest Roster view the Roster tab renders: an editable roster without signups. */
function emptyView(): View {
  return {
    run: {
      id: "run-1",
      title: "Fri HC",
      productLabel: "Venom",
      contentSummary: "Venom 8/8",
      difficulty: "HEROIC",
      lootType: "VIP",
      scheduledStartAt: "2026-11-02T18:30:00.000Z",
      status: "ROSTERING",
      raidLeadName: "Lead",
      notes: null,
      signupsOpen: true,
      signupWindowOpen: true,
      desiredTankCount: 1,
      desiredHealerCount: 1,
      desiredDpsCount: 1,
      desiredLootbuddyCount: 0,
      activeSignupCount: 0,
      publishedSelectedCount: 0,
      backupCount: 0,
      lootbuddyCount: 0,
      lateFill: false,
    },
    roster: {
      id: "roster-1",
      state: "DRAFT",
      version: 1,
      publishedAt: null,
      publishedByName: null,
      canEdit: true,
      externalBoosters: [],
      needsPublishSeed: false,
      runChangedSinceAck: false,
      postRevision: 0,
      hasUnpublishedChanges: false,
    },
    bossPlan: { enabled: false, bosses: [], draft: [], published: [] },
    boosters: [],
    withdrawnPicks: [],
    groups: {
      tanks: [],
      healers: [],
      meleeDps: [],
      rangedDps: [],
      unassignedDps: [],
      legacyDps: [],
      dps: [],
      lootbuddies: [],
    },
  } as unknown as View;
}

describe("Roster tab section order", () => {
  const html = renderToStaticMarkup(createElement(RosterBuilderView, { data: emptyView(), embedded: true }));
  const position = (marker: string) => {
    const index = html.indexOf(marker);
    expect(index, `${marker} is rendered`).toBeGreaterThanOrEqual(0);
    return index;
  };

  it("Roster (warnings, groups, composition) → Signups (search, filters) → Buffs last", () => {
    const roster = position(">Roster <");
    const groups = position(">Group 1<");
    const signups = position(">Signups <");
    const search = position('placeholder="Player or character"');
    const buffs = position(">Buffs<");
    expect(roster).toBeLessThan(groups);
    expect(groups).toBeLessThan(signups);
    expect(signups).toBeLessThan(search);
    expect(search).toBeLessThan(buffs);
    // Nothing of the Roster tab's own sections follows the Buffs strip.
    expect(html.slice(buffs)).not.toContain(">Signups <");
    expect(html.slice(buffs)).not.toContain(">Group 1<");
  });

  it("renders the Buffs strip exactly once, with its coverage list", () => {
    expect(html.split(">Buffs<").length - 1).toBe(1);
    expect(html.split('aria-label="Class buff coverage"').length - 1).toBe(1);
  });
});
