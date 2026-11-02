import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WclBestLink } from "@/components/ui/wcl-best-link";

describe("WclBestLink", () => {
  it("renders Best Perf. Avg as a Warcraft Logs character link when id is present", () => {
    const html = renderToStaticMarkup(
      createElement(WclBestLink, {
        bestPct: 97,
        warcraftLogsId: "12345678",
        tooltip:
          "The Venomous Abyss\nBest Perf. Avg: 97\nMedian Perf. Avg: 82",
        accessibleName: "Open Stormhowl Elemental on Warcraft Logs",
      }),
    );
    expect(html).toContain("https://www.warcraftlogs.com/character/id/12345678");
    expect(html).toContain("97");
    expect(html).toContain("Open Stormhowl Elemental on Warcraft Logs");
    expect(html).not.toContain("N/A");
    expect(html).not.toContain("WCL —");
  });

  it("renders percentile without a link when warcraftLogsId is missing", () => {
    const html = renderToStaticMarkup(
      createElement(WclBestLink, {
        bestPct: 61,
        warcraftLogsId: null,
        tooltip: null,
        accessibleName: "Open Stormhowl on Warcraft Logs",
      }),
    );
    expect(html).toContain("61");
    expect(html).not.toContain("warcraftlogs.com");
    expect(html).not.toContain("↗");
  });

  it("supports Best Perf. Avg prefix used by the Choose Spec modal", () => {
    const html = renderToStaticMarkup(
      createElement(WclBestLink, {
        bestPct: 97,
        warcraftLogsId: "12345678",
        tooltip: null,
        accessibleName: "Open Stormhowl Elemental on Warcraft Logs",
        labelPrefix: "Best Perf. Avg ",
      }),
    );
    expect(html).toContain("Best Perf. Avg ");
    expect(html).toContain("97");
    expect(html).toContain("↗");
    expect(html).toContain("https://www.warcraftlogs.com/character/id/12345678");
  });
});

