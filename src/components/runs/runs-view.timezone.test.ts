import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { runController } from "@/controllers/app.controller";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/runs",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: React.ReactNode; className?: string }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("@/components/runs/runs-filters", () => ({
  RunsFilters: () => createElement("div", { "data-testid": "runs-filters" }),
}));

vi.mock("@/components/runs/signup-dialog", () => ({
  RunSignupButton: () => null,
}));

import { RunsView } from "@/components/runs/runs-view";

type RunsPage = Awaited<ReturnType<typeof runController.getRunsPage>>;
type RunRow = RunsPage["runs"][number];

function row(id: string, title: string, scheduledStartAt: string): RunRow {
  return {
    id,
    title,
    scheduledStartAt,
    productLabel: "Venomous Abyss",
    contentSummary: "",
    difficulty: "HEROIC",
    status: "OPEN",
    raidLeadName: "Lead",
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
    desiredLootbuddyCount: 0,
    signupCount: 0,
    selectedCount: 0,
    signupWindowOpen: true,
    alreadySigned: false,
    currentUserSignups: [],
    ownSignupCount: 0,
  } as unknown as RunRow;
}

// Service order (by instant): Fri 20:00 Berlin, then Sat 01:30 Berlin.
const data = {
  filters: {},
  canCreate: false,
  runs: [
    row("r1", "Friday Heroic", "2026-10-16T18:00:00.000Z"),
    row("r2", "Late Heroic", "2026-10-16T23:30:00.000Z"),
  ],
} as unknown as RunsPage;

const render = (timeZone?: string) =>
  renderToStaticMarkup(createElement(RunsView, timeZone ? { data, timeZone } : { data }));

describe("RunsView viewer timezone (BWP-3)", () => {
  it("shows Berlin times and one page-level timezone label for a Berlin viewer", () => {
    const html = render("Europe/Berlin");
    expect(html).toContain("Times shown in <span");
    expect(html).toContain(">Europe/Berlin</span>");
    expect(html).toContain("Fri 16/10/2026");
    expect(html).toContain("20:00");
    expect(html).toContain("Sat 17/10/2026");
    expect(html).toContain("01:30");
  });

  it("shows the same instants in Toronto local time for a Toronto viewer", () => {
    const html = render("America/Toronto");
    expect(html).toContain(">America/Toronto</span>");
    expect(html).toContain("Fri 16/10/2026");
    expect(html).toContain("14:00");
    // 01:30 Berlin Saturday is still Friday evening in Toronto.
    expect(html).toContain("19:30");
    expect(html).not.toContain("Sat 17/10/2026");
    expect(html).not.toContain("20:00");
  });

  it("falls back to Europe/Berlin without a viewer timezone", () => {
    const html = render();
    expect(html).toContain(">Europe/Berlin</span>");
    expect(html).toContain("20:00");
  });

  it("keeps the service order (instant), independent of formatted strings", () => {
    for (const timeZone of ["Europe/Berlin", "America/Toronto", "Pacific/Auckland"]) {
      const html = render(timeZone);
      expect(html.indexOf("Friday Heroic")).toBeLessThan(html.indexOf("Late Heroic"));
    }
  });
});
