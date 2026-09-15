import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { runCreateSuccessPath } from "@/lib/run-routes";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/manage/runs",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: React.ReactNode; className?: string }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("@/components/manage/manage-runs-filters", () => ({
  ManageRunsFilters: () => createElement("div", { "data-testid": "manage-runs-filters" }),
}));

vi.mock("@/components/manage/run-quick-actions", () => ({
  RunQuickActions: () => null,
}));

import { ManageRunsView } from "@/components/manage/manage-views";
import type { ManagedRunsPage } from "@/services/run.service";

describe("runCreateSuccessPath", () => {
  it("redirects a single created Run to canonical detail", () => {
    expect(runCreateSuccessPath(["run-1"])).toBe("/runs/run-1");
  });

  it("redirects multiple created Runs to Manage Runs with massCreated count", () => {
    expect(runCreateSuccessPath(["run-1", "run-2", "run-3"])).toBe("/manage/runs?massCreated=3");
    expect(runCreateSuccessPath(["run-1", "run-2", "run-3"])).not.toBe("/runs/run-1");
  });

  it("falls back to /runs when no Run ids are returned", () => {
    expect(runCreateSuccessPath([])).toBe("/runs");
  });
});

describe("ManageRunsView massCreated banner", () => {
  it("renders Created N run drafts without restoring a Create button", () => {
    const data = {
      canCreate: true,
      filters: { status: undefined, raidLeadId: undefined, timeframe: undefined, archived: "active" as const },
      raidLeads: [],
      runs: [],
    } satisfies ManagedRunsPage;

    const html = renderToStaticMarkup(createElement(ManageRunsView, { data, massCreatedCount: 3 }));
    expect(html).toContain("Created 3 run drafts.");
    expect(html).not.toContain(">Create Run<");
    expect(html).not.toContain('href="/runs/create"');
    expect(html).not.toContain('href="/manage/runs/create"');
  });
});
