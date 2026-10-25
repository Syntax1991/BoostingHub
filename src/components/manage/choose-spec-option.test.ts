import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChooseSpecOption } from "@/components/manage/choose-spec-option";
import { getWarcraftLogsCharacterUrl } from "@/lib/warcraft-logs";
import type { WclPerformanceRaidSegment } from "@/lib/wcl-performance-display";

const segments: WclPerformanceRaidSegment[] = [
  {
    raidId: "abyss",
    raidName: "The Venomous Abyss",
    roles: [
      { role: "HEALER", specLabel: "Restoration", bestPct: 61, avgPct: 54 },
      { role: "RANGED_DPS", specLabel: "Elemental", bestPct: 97, avgPct: 82 },
    ],
  },
];

const wclId = "stormhowl-wcl-id";

function renderOption(
  choice: { name: string; role: "HEALER" | "RANGED_DPS" },
  onSelect = vi.fn(),
  overrides: { warcraftLogsId?: string | null; wclSegments?: WclPerformanceRaidSegment[] } = {},
) {
  return renderToStaticMarkup(
    createElement(ChooseSpecOption, {
      choice,
      characterLabel: "Stormhowl",
      wowClass: "SHAMAN",
      warcraftLogsId: overrides.warcraftLogsId === undefined ? wclId : overrides.warcraftLogsId,
      wclSegments: overrides.wclSegments ?? segments,
      isCurrent: false,
      onSelect,
    }),
  );
}

describe("ChooseSpecOption — multi-spec modal WCL links", () => {
  it("renders a WCL link per spec with Best + Avg when data exists", () => {
    const elemental = renderOption({ name: "Elemental", role: "RANGED_DPS" });
    const restoration = renderOption({ name: "Restoration", role: "HEALER" });

    expect(elemental).toContain("Best ");
    expect(elemental).toContain("97");
    expect(elemental).toContain("Avg 82");
    expect(elemental).toContain(getWarcraftLogsCharacterUrl(wclId)!);
    expect(elemental).toContain("Open Stormhowl Elemental on Warcraft Logs");

    expect(restoration).toContain("Best ");
    expect(restoration).toContain("61");
    expect(restoration).toContain("Avg 54");
    expect(restoration).toContain(getWarcraftLogsCharacterUrl(wclId)!);
    expect(restoration).toContain("Open Stormhowl Restoration on Warcraft Logs");
  });

  it("Elemental and Restoration links use the same authoritative character destination", () => {
    const destination = getWarcraftLogsCharacterUrl(wclId);
    expect(destination).toBe(`https://www.warcraftlogs.com/character/id/${encodeURIComponent(wclId)}`);
    expect(renderOption({ name: "Elemental", role: "RANGED_DPS" })).toContain(destination!);
    expect(renderOption({ name: "Restoration", role: "HEALER" })).toContain(destination!);
  });

  it("keeps the WCL control as an <a> outside the select <button>", () => {
    const html = renderOption({ name: "Elemental", role: "RANGED_DPS" });
    expect(html).toMatch(/<a[^>]*href="https:\/\/www\.warcraftlogs\.com\/character\/id\//);
    expect(html).toMatch(/<button[^>]*>[\s\S]*Elemental[\s\S]*<\/button>/);
    // Link must not be nested inside the select button.
    const buttonChunk = html.match(/<button[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(buttonChunk).not.toContain("warcraftlogs.com");
  });

  it("does not render a dead WCL link when percentile or id is missing", () => {
    const noData = renderOption(
      { name: "Elemental", role: "RANGED_DPS" },
      vi.fn(),
      { wclSegments: [] },
    );
    expect(noData).not.toContain("warcraftlogs.com");
    expect(noData).not.toContain("Best ");
    expect(noData).not.toContain("N/A");
    expect(noData).not.toContain("WCL —");

    const noId = renderOption(
      { name: "Elemental", role: "RANGED_DPS" },
      vi.fn(),
      { warcraftLogsId: null },
    );
    expect(noId).toContain("Best ");
    expect(noId).toContain("97");
    expect(noId).not.toContain("warcraftlogs.com");
    expect(noId).not.toContain("↗");
  });
});
