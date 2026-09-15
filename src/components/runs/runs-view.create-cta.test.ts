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

const baseData: Omit<RunsPage, "canCreate"> = {
  filters: {},
  runs: [],
};

describe("RunsView Create Run CTA", () => {
  it("shows Create Run linking to /runs/create when canCreate is true", () => {
    const html = renderToStaticMarkup(createElement(RunsView, { data: { ...baseData, canCreate: true } }));
    expect(html).toContain("Create Run");
    expect(html).toContain('href="/runs/create"');
  });

  it("hides Create Run when canCreate is false", () => {
    const html = renderToStaticMarkup(createElement(RunsView, { data: { ...baseData, canCreate: false } }));
    expect(html).not.toContain("Create Run");
    expect(html).not.toContain("/runs/create");
  });
});
