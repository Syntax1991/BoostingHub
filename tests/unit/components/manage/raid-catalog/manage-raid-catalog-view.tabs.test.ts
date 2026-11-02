import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ManageRaidCatalogView } from "@/components/manage/raid-catalog/manage-raid-catalog-view";
import {
  raidCatalogHref,
  raidSeasonOptions,
  resolveRaidCatalogScope,
  resolveRaidCatalogTab,
  scopeRaids,
  type RaidCatalogRaidScope,
} from "@/components/manage/raid-catalog/raid-catalog-tabs";
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
    shortName: null,
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

const archived: Partial<RaidCatalogRaidRow> = {
  archived: true,
  archivedAt: "2026-10-26T00:00:00.000Z",
  actions: { delete: false, removeDuplicate: false, archive: false, restore: true },
};

const page: RaidCatalogPageData = {
  raids: [
    raid("r1", "The Venomous Abyss"),
    raid("r2", "The Unbinding of Kith'ix", {
      duplicateOf: { id: "r3", name: "The Unbinding of Kith'ix" },
      actions: { delete: false, removeDuplicate: true, archive: false, restore: false },
    }),
    raid("r4", "Manaforge Omega", { season: "The War Within Season 3", availableForRuns: false, ...archived }),
    raid("r5", "The Voidspire", { season: "Midnight Season 1" }),
    raid("r6", "The Dreamrift", { season: "Midnight Season 1", ...archived }),
    raid("r7", "QA Manual Raid", { season: "QA" }),
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
  // Persisted Raid.season values (A–Z) and the code-defined Blizzard seasons (newest first).
  seasons: ["Midnight Season 1", "Midnight Season 2", "QA", "The War Within Season 3"],
  importSeasons: [
    { key: "MIDNIGHT_S2", name: "Midnight Season 2", current: true, raidCount: 3 },
    { key: "MIDNIGHT_S1", name: "Midnight Season 1", current: false, raidCount: 3 },
    { key: "TWW_S3", name: "The War Within Season 3", current: false, raidCount: 1 },
  ],
};

const seasonOptions = raidSeasonOptions(page.seasons, page.importSeasons);

type Params = { status?: string; season?: string };

function scopeOf(params: Params): RaidCatalogRaidScope {
  return resolveRaidCatalogScope(params, seasonOptions);
}

function render(tab: ReturnType<typeof resolveRaidCatalogTab>, params: Params = {}) {
  return renderToStaticMarkup(createElement(ManageRaidCatalogView, { page, tab, scope: scopeOf(params) }));
}

function visibleNames(params: Params) {
  return scopeRaids(page.raids, scopeOf(params), "Midnight Season 2").visible.map((row) => row.name);
}

describe("Raid Catalog tabs", () => {
  it("defaults to Raids for a missing, invalid or repeated ?tab=", () => {
    expect(resolveRaidCatalogTab(undefined)).toBe("raids");
    expect(resolveRaidCatalogTab("nope")).toBe("raids");
    expect(resolveRaidCatalogTab(["presets", "raids"])).toBe("raids");
    expect(resolveRaidCatalogTab("presets")).toBe("presets");
    expect(resolveRaidCatalogTab("raids")).toBe("raids");
  });

  it("renders real URL tabs; the Raids count is the visible default scope, not every imported raid", () => {
    const html = render("raids");
    expect(html).toContain('href="/manage/raid-catalog?tab=raids"');
    expect(html).toContain('href="/manage/raid-catalog?tab=presets"');
    const raidsTab = html.match(/<a href="\/manage\/raid-catalog\?tab=raids"[^>]*>(.*?)<\/a>/)?.[1] ?? "";
    expect(html).toMatch(/<a href="\/manage\/raid-catalog\?tab=raids" aria-current="page"/);
    expect(raidsTab).toContain("· 2</span>");
    expect(html).not.toContain("#run-presets");
  });

  it("Raids shows only raid content — no Run Presets", () => {
    const html = render("raids");
    expect(html).toContain("Import season");
    expect(html).toContain("The Venomous Abyss");
    expect(html).toContain("Duplicate");
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

describe("Raids scope (status + season)", () => {
  it("default view: active raids of the current season only — archived Manaforge Omega is not shown", () => {
    expect(scopeOf({})).toEqual({ status: "active", season: null });
    expect(visibleNames({})).toEqual(["The Venomous Abyss", "The Unbinding of Kith'ix"]);
    const html = render("raids");
    expect(html).not.toContain("Manaforge Omega");
    expect(html).not.toContain("The Voidspire");
    expect(html).not.toContain("The Dreamrift");
  });

  it("Archived shows archived raids of every season, All shows both", () => {
    // No season chosen: Archived / All look across seasons, so old archived raids are one click away.
    expect(visibleNames({ status: "archived" })).toEqual(["Manaforge Omega", "The Dreamrift"]);
    expect(visibleNames({ status: "all" })).toHaveLength(page.raids.length);
    // An explicit season still narrows them.
    expect(visibleNames({ status: "archived", season: "current" })).toEqual([]);
    expect(visibleNames({ status: "archived", season: "all" })).toEqual(["Manaforge Omega", "The Dreamrift"]);
    expect(visibleNames({ status: "all", season: "all" })).toHaveLength(page.raids.length);
    const html = render("raids", { status: "archived", season: "all" });
    expect(html).toContain("Manaforge Omega");
    expect(html).toContain('href="/manage/raid-catalog/raids/r4"');
    expect(html).not.toContain("The Venomous Abyss");
  });

  it("season filter: persisted seasons, newest Blizzard season first; one season narrows the list", () => {
    expect(seasonOptions).toEqual(["Midnight Season 2", "Midnight Season 1", "The War Within Season 3", "QA"]);
    expect(visibleNames({ season: "Midnight Season 1" })).toEqual(["The Voidspire"]);
    expect(visibleNames({ season: "The War Within Season 3", status: "all" })).toEqual(["Manaforge Omega"]);
    expect(visibleNames({ season: "Midnight Season 2", status: "archived" })).toEqual([]);
    const html = render("raids");
    expect(html).toContain("Current season (Midnight Season 2)");
    expect(html).toContain("All seasons");
  });

  it("unknown status / season values fall back to the default scope", () => {
    expect(scopeOf({ status: "bogus", season: "Nonexistent Season" })).toEqual({
      status: "active",
      season: null,
    });
  });

  it("keeps the filter in the URL, defaults left out", () => {
    expect(raidCatalogHref("raids", scopeOf({}))).toBe("/manage/raid-catalog?tab=raids");
    expect(raidCatalogHref("raids", scopeOf({ status: "archived" }))).toBe(
      "/manage/raid-catalog?tab=raids&status=archived",
    );
    expect(raidCatalogHref("raids", scopeOf({ season: "Midnight Season 1" }))).toBe(
      "/manage/raid-catalog?tab=raids&season=Midnight+Season+1",
    );
    expect(raidCatalogHref("raids", scopeOf({ status: "archived", season: "all" }))).toBe(
      "/manage/raid-catalog?tab=raids&status=archived",
    );
    expect(raidCatalogHref("raids", scopeOf({ season: "current" }))).toBe("/manage/raid-catalog?tab=raids");
    const html = render("raids");
    expect(html).toContain('href="/manage/raid-catalog?tab=raids&amp;status=archived"');
    expect(html).toContain('href="/manage/raid-catalog?tab=raids&amp;status=all"');
  });

  it("the default view stays clean after many seasons", () => {
    const oldSeasons = Array.from({ length: 12 }, (_, index) => "Old Expansion Season " + (index + 1));
    const raids = [
      ...page.raids,
      ...oldSeasons.flatMap((season, index) => [
        raid("old-a-" + index, "Old Raid A" + index, { season, ...archived }),
        raid("old-b-" + index, "Old Raid B" + index, { season }),
      ]),
    ];
    const scope = resolveRaidCatalogScope(
      {},
      raidSeasonOptions([...page.seasons, ...oldSeasons], page.importSeasons),
    );
    const { visible, counts } = scopeRaids(raids, scope, "Midnight Season 2");
    expect(visible.map((row) => row.name)).toEqual(["The Venomous Abyss", "The Unbinding of Kith'ix"]);
    // The Archived / All links make the history visible as counts, without listing it.
    expect(counts).toEqual({ active: 2, archived: 14, all: 30 });
  });
});
