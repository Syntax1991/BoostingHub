import { DomainError } from "@/lib/errors";
import {
  expandProductSelection,
  ProductSelectionError,
  type ContentBossCounts,
  type ExpandedProductContent,
  type PlanningProduct,
} from "@/lib/product-selection";
import { productRepository } from "@/repositories/product.repository";

/**
 * Server authority for product-driven Run planning (Create Run, Mass Create,
 * Run Setup, Schedule). Selector options and submissions both come from the
 * persisted catalog: `Product.active && Product.selectable` — no key
 * allowlist, no preset enum, no special casing of seeded products.
 */

export function isSelectableProduct(product: Pick<PlanningProduct, "active" | "selectable">): boolean {
  return product.active && product.selectable;
}

/** Map pure selection errors to domain errors (user-facing messages, no raw failures). */
export function expandSelectionOrThrow(product: PlanningProduct, counts: ContentBossCounts = {}): ExpandedProductContent[] {
  try {
    return expandProductSelection(product, counts);
  } catch (error) {
    if (error instanceof ProductSelectionError) throw new DomainError(error.code, error.message);
    throw error;
  }
}

/** A product chosen for NEW planning must exist and be active + selectable. */
export function requireSelectableProduct(products: readonly PlanningProduct[], productId: string): PlanningProduct {
  const product = products.find((row) => row.id === productId);
  if (!product || !isSelectableProduct(product)) {
    throw new DomainError(
      "RUN_PRODUCT_UNAVAILABLE",
      "This product is not available for new runs. Reload and choose another product.",
    );
  }
  return product;
}

export const productPlanningService = {
  /** Every product (planning read model) — one query. */
  async listAll(): Promise<PlanningProduct[]> {
    return productRepository.listPlanningProducts();
  },

  /** Selector options: active + selectable products in catalog order — one query. */
  async listSelectable(): Promise<PlanningProduct[]> {
    return (await productRepository.listPlanningProducts()).filter(isSelectableProduct);
  },

  /** Active products (selectable or not) — what keeps existing Run Setups usable. */
  async listActive(): Promise<PlanningProduct[]> {
    return (await productRepository.listPlanningProducts()).filter((product) => product.active);
  },

  /** Resolve + validate a new selection against the DB catalog. */
  async expandNewSelection(input: {
    productId: string;
    contentBossCounts?: ContentBossCounts;
  }): Promise<{ product: PlanningProduct; contents: ExpandedProductContent[] }> {
    const product = requireSelectableProduct(await productRepository.listPlanningProducts(), input.productId);
    return { product, contents: expandSelectionOrThrow(product, input.contentBossCounts ?? {}) };
  },
};
