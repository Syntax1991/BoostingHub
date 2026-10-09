/**
 * Product-driven Run planning (client-safe, no DB access).
 *
 * A Product (DB authority, managed in /manage/raid-catalog) is an ordered list of
 * raid contents. Selecting it for a new Run / Run Setup expands to one
 * RunRaidContent / RunTemplateRaidContent per ProductRaidContent, in the
 * persisted ProductRaidContent order — never assuming a number of contents,
 * a raid order, or a known product key.
 *
 * FIXED contents always use the product's fixed count (client values are
 * ignored). VARIABLE contents take the submitted count per
 * ProductRaidContent id (default: the product's default count) within
 * [minBossCount, raid encounter count].
 */

export type PlanningProductContent = {
  productRaidContentId: string;
  raidId: string;
  raidName: string;
  sortOrder: number;
  bossCountMode: "FIXED" | "VARIABLE";
  fixedBossCount: number | null;
  minBossCount: number | null;
  defaultBossCount: number | null;
  /** The raid's current encounter count — the maximum for every content. */
  totalBossCount: number;
};

export type PlanningProduct = {
  id: string;
  key: string;
  name: string;
  active: boolean;
  selectable: boolean;
  sortOrder: number;
  /** Ordered by ProductRaidContent.sortOrder. */
  contents: PlanningProductContent[];
};

/** Planned boss count per VARIABLE ProductRaidContent id. */
export type ContentBossCounts = Record<string, number>;

export type ProductSelection = { productId: string; contentBossCounts: ContentBossCounts };

export type ExpandedProductContent = { raidId: string; sortOrder: number; plannedBossCount: number };

export class ProductSelectionError extends Error {
  constructor(
    readonly code: "RUN_BOSS_COUNT_INVALID" | "RUN_PRODUCT_SELECTION_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "ProductSelectionError";
  }
}

export function orderedContents(product: PlanningProduct): PlanningProductContent[] {
  return [...product.contents].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function variableBounds(content: PlanningProductContent): { min: number; max: number } {
  return { min: Math.max(1, content.minBossCount ?? 1), max: content.totalBossCount };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Default planned counts for every VARIABLE content (the product's default, kept inside current bounds). */
export function defaultContentBossCounts(product: PlanningProduct): ContentBossCounts {
  const counts: ContentBossCounts = {};
  for (const content of orderedContents(product)) {
    if (content.bossCountMode !== "VARIABLE") continue;
    const { min, max } = variableBounds(content);
    counts[content.productRaidContentId] = clamp(content.defaultBossCount ?? max, min, Math.max(min, max));
  }
  return counts;
}

/** Planned count the selection resolves to for one content (FIXED is server-forced). */
export function plannedCountFor(content: PlanningProductContent, counts: ContentBossCounts): number {
  if (content.bossCountMode === "FIXED") return content.fixedBossCount ?? 0;
  const submitted = counts[content.productRaidContentId];
  if (submitted !== undefined) return submitted;
  const { min, max } = variableBounds(content);
  return clamp(content.defaultBossCount ?? max, min, Math.max(min, max));
}

/**
 * Validate + expand a selection into ordered content write specs (sortOrder 1..n).
 * Throws ProductSelectionError on invalid counts or stale content ids.
 */
export function expandProductSelection(
  product: PlanningProduct,
  counts: ContentBossCounts = {},
): ExpandedProductContent[] {
  const contents = orderedContents(product);
  if (contents.length === 0) {
    throw new ProductSelectionError("RUN_PRODUCT_SELECTION_INVALID", `${product.name} has no raid contents.`);
  }
  const known = new Set(contents.map((content) => content.productRaidContentId));
  for (const id of Object.keys(counts)) {
    if (!known.has(id)) {
      throw new ProductSelectionError(
        "RUN_PRODUCT_SELECTION_INVALID",
        `${product.name} changed since this form was opened. Reload and choose the product again.`,
      );
    }
  }
  return contents.map((content, index) => {
    const planned = plannedCountFor(content, counts);
    if (content.totalBossCount < 1) {
      throw new ProductSelectionError("RUN_BOSS_COUNT_INVALID", `${content.raidName} has no encounters.`);
    }
    if (content.bossCountMode === "FIXED") {
      if (!Number.isInteger(planned) || planned < 1 || planned > content.totalBossCount) {
        throw new ProductSelectionError(
          "RUN_BOSS_COUNT_INVALID",
          `${content.raidName}: the product's fixed boss count is no longer valid.`,
        );
      }
    } else {
      const { min, max } = variableBounds(content);
      if (!Number.isInteger(planned) || planned < min || planned > max) {
        throw new ProductSelectionError(
          "RUN_BOSS_COUNT_INVALID",
          `${content.raidName}: choose between ${min} and ${max} bosses.`,
        );
      }
    }
    return { raidId: content.raidId, sortOrder: index + 1, plannedBossCount: planned };
  });
}

/** Title / channel coverage token (planned / total summed over every content), e.g. `10/10`. */
export function coverageFromContents(
  contents: ReadonlyArray<{ plannedBossCount: number; totalBossCount: number }>,
): string {
  const planned = contents.reduce((sum, row) => sum + row.plannedBossCount, 0);
  const total = contents.reduce((sum, row) => sum + row.totalBossCount, 0);
  return `${planned}/${total}`;
}

/** Coverage preview for a (possibly not yet valid) selection — never throws. */
export function selectionCoveragePreview(product: PlanningProduct, counts: ContentBossCounts): string {
  return coverageFromContents(
    orderedContents(product).map((content) => ({
      plannedBossCount: plannedCountFor(content, counts),
      totalBossCount: content.totalBossCount,
    })),
  );
}

/**
 * Generic product match for existing contents (Run Setup / Run editing,
 * template usability): same raids in the same order, FIXED counts equal,
 * VARIABLE counts inside the content's bounds. First match in product order.
 */
export function matchProductForContents(
  products: readonly PlanningProduct[],
  contents: ReadonlyArray<{ raidId: string; sortOrder: number; plannedBossCount: number }>,
): ProductSelection | null {
  const ordered = [...contents].sort((a, b) => a.sortOrder - b.sortOrder);
  const sortedProducts = [...products].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  for (const product of sortedProducts) {
    const productContents = orderedContents(product);
    if (productContents.length !== ordered.length) continue;
    const counts: ContentBossCounts = {};
    const matches = productContents.every((content, index) => {
      const row = ordered[index]!;
      if (row.raidId !== content.raidId) return false;
      if (content.bossCountMode === "FIXED") return row.plannedBossCount === content.fixedBossCount;
      const { min, max } = variableBounds(content);
      if (row.plannedBossCount < min || row.plannedBossCount > max) return false;
      counts[content.productRaidContentId] = row.plannedBossCount;
      return true;
    });
    if (matches) return { productId: product.id, contentBossCounts: counts };
  }
  return null;
}
