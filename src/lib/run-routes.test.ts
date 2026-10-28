import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runDetailPath, syncRunDetailTab, type RunDetailTabState } from "@/lib/run-routes";
import { preflightCheckAction } from "@/components/runs/run-preflight-panel";

describe("syncRunDetailTab — Run Detail tab follows client-side navigation", () => {
  it("Operations → Roster: a Preflight link to /runs/[id]#roster-attention switches the visible tab", () => {
    // Production bug (PR #298 smoke): URL changed, tab stayed on Operations.
    const onOperations: RunDetailTabState = { tab: "operations", initialTab: "operations" };
    expect(syncRunDetailTab(onOperations, "roster", false)).toEqual({ tab: "roster", initialTab: "roster" });
  });

  it("every Preflight action link lands on the Roster tab", () => {
    const onOperations: RunDetailTabState = { tab: "operations", initialTab: "operations" };
    const ids = [
      "selected_lockouts",
      "selected_schedule_conflicts",
      "composition:COMPOSITION_UNDER_TARGET:x",
      "selected_blizzard_sync",
      "publish_blocker:CHARACTER_INACTIVE:s1",
      "unpublished_changes",
    ];
    for (const id of ids) {
      const action = preflightCheckAction({ id, status: "WARNING" }, "run-1");
      expect(action?.href.startsWith(runDetailPath("run-1"))).toBe(true);
      // runDetailPath(run) carries no ?tab= → the page renders initialTab "roster".
      expect(action?.href).not.toContain("?tab=");
      expect(syncRunDetailTab(onOperations, "roster", false).tab).toBe("roster");
    }
  });

  it("an unchanged initialTab returns the same state object — manual tab clicks are never reset, no render loop", () => {
    // User clicked Attendance; the server still reports the old tab until its replace() lands.
    const manual: RunDetailTabState = { tab: "attendance", initialTab: "roster" };
    expect(syncRunDetailTab(manual, "roster", false)).toBe(manual);
  });

  it("the router.replace of a manual click settles without changing the tab", () => {
    const manual: RunDetailTabState = { tab: "attendance", initialTab: "roster" };
    const settled = syncRunDetailTab(manual, "attendance", false);
    expect(settled).toEqual({ tab: "attendance", initialTab: "attendance" });
    expect(syncRunDetailTab(settled, "attendance", false)).toBe(settled);
  });

  it("resolves alias tabs the same way as the first render", () => {
    const state: RunDetailTabState = { tab: "roster", initialTab: "roster" };
    expect(syncRunDetailTab(state, "overview", false).tab).toBe("operations");
    expect(syncRunDetailTab(state, "consumables", false).tab).toBe("roster");
    expect(syncRunDetailTab(state, "consumables", true).tab).toBe("consumables");
  });

  it("RunDetailTabs uses the sync during render (not only the initial useState value)", () => {
    const source = readFileSync(new URL("../components/runs/run-detail-tabs.tsx", import.meta.url), "utf8");
    expect(source).toContain("syncRunDetailTab(tabState, initialTab");
    expect(source).toMatch(/if \(synced !== tabState\) setTabState\(synced\)/);
  });
});
