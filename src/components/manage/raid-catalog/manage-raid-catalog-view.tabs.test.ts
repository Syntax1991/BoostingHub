import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ManageRaidCatalogView } from "@/components/manage/raid-catalog/manage-raid-catalog-view";
import { resolveRaidCatalogTab } from "@/components/manage/raid-catalog/raid-catalog-tabs";
import type { RaidCatalogPageData, RaidCatalogRaidRow } from "@/services/raid-catalog.service";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("@/controllers/raid-catalog.actions", () => {
  const action = async () => ({ ok: true, message: "" });
  return Object.fromEntries(
    [
      "previewRaidImportAction",
      "importRaidAction",
      "previewSeasonImportAction",
      "importSeasonAction",
      "previewRaidRefreshAction",
      "refreshRaidFromBlizzardAction",
      "createProductAction",
      "updateProductAction",
      "setProductActiveAction",
      "setProductSelectableAction",
      "deleteProductAction",
    ].map((name) => [name, action]),
  );
});

function raid(id: string, name: string, overrides: Partial<RaidCatalogRaidRow> = {}): RaidCatalogRaidRow {
  return {
    id,
    name,
    season: "Midnight Season 2",
    availableForRuns: true,
    sortOrder: 1,
    trackLockouts: true,
    blizzardInstanceId: 1320,
    wclZoneId: 53,
    wclRankingEncounterId: null,
    archivedAt: null,
    bosses: [],
    references: { runContents: 0, templateContents: 0, productContents: 0, lockouts: 0 },
    referenced: false,
    seeded: false,
    structureLocked: false,
    status: { blizzardLinked: true, bossesMapped: 0, bossTotal: 0, lockouts: "READY", warcraftLogs: "MAPPED" },
    archived: false,
    duplicateOf: null,
    actions: { delete: true, removeDuplicate: false, archive: false, restore: false },
    ...overrides,
  } as RaidCatalogRaidRow;
}

const page: RaidCatalogPageData = {
  raids: [
    raid("r1", "The Venomous Abyss"),
    raid("r2", "The Unbinding of Kith'ix", {
      duplicateOf: { id: "r3", name: "The Unbinding of Kith'ix" },
      actions: { delete: false, removeDuplicate: true, archive: false, restore: false },
    }),
    raid("r4", "Manaforge Omega", {
      archived: true,
      archivedAt: "2026-10-26T00:00:00.000Z",
      actions: { delete: false, removeDuplicate: false, archive: false, restore: true },
    }),
  ],
  products: [
    {
      id: "p1",
      key: "VENOMOUS",
      name: "Venomous Abyss Product",
      active: true,
      selectable: true,
      sortOrder: 1,
      seeded: false,
      contents: [],
    },
  ],
  seasons: ["Midnight Season 2"],
  importSeasons: [],
};

function render(tab: ReturnType<typeof resolveRaidCatalogTab>) {
  return renderToStaticMarkup(createElement(ManageRaidCatalogView, { page, tab }));
}

describe("Raid Catalog tabs", () => {
  it("defaults to Raids for a missing, invalid or repeated ?tab=", () => {
    expect(resolveRaidCatalogTab(undefined)).toBe("raids");
    expect(resolveRaidCatalogTab("nope")).toBe("raids");
    expect(resolveRaidCatalogTab(["presets", "raids"])).toBe("raids");
    expect(resolveRaidCatalogTab("presets")).toBe("presets");
    expect(resolveRaidCatalogTab("raids")).toBe("raids");
  });

  it("renders real URL tabs with counts from the loaded page and marks the current one", () => {
    const html = render("raids");
    expect(html).toContain('href="/manage/raid-catalog?tab=raids"');
    expect(html).toContain('href="/manage/raid-catalog?tab=presets"');
    expect(html).toMatch(/aria-current="page"[^>]*>Raids/);
    expect(html).toContain("· 3");
    expect(html).toContain("· 1");
    expect(html).not.toContain("#run-presets");
  });

  it("Raids shows only raid content: imports, rows, lifecycle state — no Run Presets", () => {
    const html = render("raids");
    expect(html).toContain("Import season");
    expect(html).toContain("The Venomous Abyss");
    expect(html).toContain("Duplicate");
    expect(html).toContain("Archived");
    expect(html).not.toContain("Venomous Abyss Product");
    expect(html).not.toContain("New product");
  });

  it("?tab=presets shows only Run Presets", () => {
    const html = render("presets");
    expect(html).toMatch(/aria-current="page"[^>]*>Run Presets/);
    expect(html).toContain("Venomous Abyss Product");
    expect(html).not.toContain("Import season");
    expect(html).not.toContain("Manaforge Omega");
  });
});
