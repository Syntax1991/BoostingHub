import { describe, expect, it } from "vitest";
import {
  coverageFromContents,
  defaultContentBossCounts,
  expandProductSelection,
  matchProductForContents,
  ProductSelectionError,
  selectionCoveragePreview,
  type PlanningProduct,
  type PlanningProductContent,
} from "@/lib/product-selection";

/** Generic product fixtures — no seeded keys, no known raid ids. */
function content(overrides: Partial<PlanningProductContent> & Pick<PlanningProductContent, "productRaidContentId" | "raidId" | "sortOrder">): PlanningProductContent {
  return {
    raidName: `Raid ${overrides.raidId}`,
    bossCountMode: "FIXED",
    fixedBossCount: 1,
    minBossCount: null,
    defaultBossCount: null,
    totalBossCount: 1,
    ...overrides,
  };
}

const threeContent: PlanningProduct = {
  id: "p-three",
  key: "ANY_THREE",
  name: "Three content product",
  active: true,
  selectable: true,
  sortOrder: 3,
  // Persisted order: VARIABLE first, then two FIXED — never re-ordered.
  contents: [
    content({ productRaidContentId: "c-var", raidId: "r-big", sortOrder: 1, bossCountMode: "VARIABLE", fixedBossCount: null, minBossCount: 1, defaultBossCount: 8, totalBossCount: 8 }),
    content({ productRaidContentId: "c-fix-a", raidId: "r-a", sortOrder: 2 }),
    content({ productRaidContentId: "c-fix-b", raidId: "r-b", sortOrder: 3 }),
  ],
};

const twoVariable: PlanningProduct = {
  id: "p-two-var",
  key: "TWO_VARIABLE",
  name: "Two variable contents",
  active: true,
  selectable: true,
  sortOrder: 4,
  contents: [
    content({ productRaidContentId: "v2", raidId: "r-y", sortOrder: 2, bossCountMode: "VARIABLE", fixedBossCount: null, minBossCount: 2, defaultBossCount: 4, totalBossCount: 6 }),
    content({ productRaidContentId: "v1", raidId: "r-x", sortOrder: 1, bossCountMode: "VARIABLE", fixedBossCount: null, minBossCount: 1, defaultBossCount: 3, totalBossCount: 5 }),
  ],
};

describe("expandProductSelection — any product, persisted order", () => {
  it("expands a three-content product into three ordered rows, FIXED forced", () => {
    expect(expandProductSelection(threeContent, { "c-var": 6 })).toEqual([
      { raidId: "r-big", sortOrder: 1, plannedBossCount: 6 },
      { raidId: "r-a", sortOrder: 2, plannedBossCount: 1 },
      { raidId: "r-b", sortOrder: 3, plannedBossCount: 1 },
    ]);
  });

  it("uses the product default when a VARIABLE count is omitted", () => {
    expect(expandProductSelection(threeContent).map((row) => row.plannedBossCount)).toEqual([8, 1, 1]);
    expect(defaultContentBossCounts(threeContent)).toEqual({ "c-var": 8 });
  });

  it("ignores any client value for FIXED contents (server-forced)", () => {
    expect(expandProductSelection(threeContent, { "c-var": 8, "c-fix-a": 5 }).map((row) => row.plannedBossCount)).toEqual([
      8, 1, 1,
    ]);
  });

  it("supports multiple VARIABLE contents, each validated against its own bounds", () => {
    expect(expandProductSelection(twoVariable, { v1: 5, v2: 2 })).toEqual([
      { raidId: "r-x", sortOrder: 1, plannedBossCount: 5 },
      { raidId: "r-y", sortOrder: 2, plannedBossCount: 2 },
    ]);
    expect(() => expandProductSelection(twoVariable, { v1: 1, v2: 1 })).toThrow(ProductSelectionError);
    expect(() => expandProductSelection(twoVariable, { v1: 6, v2: 3 })).toThrow(/between 1 and 5/);
  });

  it("rejects counts outside [min, encounter count] and non-integers", () => {
    for (const count of [0, 9, 2.5]) {
      let code: string | null = null;
      try {
        expandProductSelection(threeContent, { "c-var": count });
      } catch (error) {
        code = error instanceof ProductSelectionError ? error.code : "other";
      }
      expect(code).toBe("RUN_BOSS_COUNT_INVALID");
    }
  });

  it("rejects stale content ids (product changed after the form loaded)", () => {
    let code: string | null = null;
    try {
      expandProductSelection(threeContent, { "gone-content": 3 });
    } catch (error) {
      code = error instanceof ProductSelectionError ? error.code : "other";
    }
    expect(code).toBe("RUN_PRODUCT_SELECTION_INVALID");
  });
});

describe("coverage + generic product matching", () => {
  it("sums coverage over every content", () => {
    expect(selectionCoveragePreview(threeContent, { "c-var": 8 })).toBe("10/10");
    expect(coverageFromContents([{ plannedBossCount: 1, totalBossCount: 1 }, { plannedBossCount: 6, totalBossCount: 8 }])).toBe("7/9");
  });

  it("matches existing contents to a product by raid order and counts", () => {
    const rows = [
      { raidId: "r-big", sortOrder: 1, plannedBossCount: 5 },
      { raidId: "r-a", sortOrder: 2, plannedBossCount: 1 },
      { raidId: "r-b", sortOrder: 3, plannedBossCount: 1 },
    ];
    expect(matchProductForContents([twoVariable, threeContent], rows)).toEqual({
      productId: "p-three",
      contentBossCounts: { "c-var": 5 },
    });
    // Different order, wrong FIXED count, or out-of-range VARIABLE → no match.
    expect(matchProductForContents([threeContent], [rows[1]!, rows[0]!, rows[2]!].map((row, i) => ({ ...row, sortOrder: i + 1 })))).toBeNull();
    expect(matchProductForContents([threeContent], [rows[0]!, { ...rows[1]!, plannedBossCount: 2 }, rows[2]!])).toBeNull();
    expect(matchProductForContents([threeContent], [{ ...rows[0]!, plannedBossCount: 9 }, rows[1]!, rows[2]!])).toBeNull();
  });
});
