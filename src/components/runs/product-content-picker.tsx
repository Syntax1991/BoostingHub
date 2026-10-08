"use client";

import {
  defaultContentBossCounts,
  orderedContents,
  plannedCountFor,
  variableBounds,
  type ContentBossCounts,
  type PlanningProduct,
  type ProductSelection,
} from "@/lib/product-selection";

export const KEEP_CURRENT_CONTENTS = "";

/** New selection for a product: its default counts for every VARIABLE content. */
export function selectionForProduct(products: readonly PlanningProduct[], productId: string): ProductSelection {
  const product = products.find((row) => row.id === productId);
  return { productId, contentBossCounts: product ? defaultContentBossCounts(product) : {} };
}

/**
 * Product-driven content picker: any persisted active + selectable Product,
 * rendered generically from its ordered contents — a count input per
 * VARIABLE content, a read-only fixed count per FIXED content. No product
 * keys, no assumed number or order of raids.
 */
export function ProductContentPicker({
  products,
  value,
  onChange,
  ariaPrefix,
  keepCurrentLabel,
  disabled = false,
  compact = false,
}: {
  products: readonly PlanningProduct[];
  value: ProductSelection;
  onChange: (next: ProductSelection) => void;
  /** Accessible-name prefix, e.g. "Shared" or "Run 2". */
  ariaPrefix: string;
  /** When set, an extra first option keeps the current contents (productId ""). */
  keepCurrentLabel?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const product = products.find((row) => row.id === value.productId) ?? null;
  const inputClass = `h-9 w-full rounded-md border border-border bg-surface px-2${compact ? " text-sm" : ""}`;

  function setCount(contentId: string, count: number) {
    const next: ContentBossCounts = { ...value.contentBossCounts, [contentId]: count };
    onChange({ productId: value.productId, contentBossCounts: next });
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm">
        <span className="mb-1 block text-muted">Product</span>
        <select
          aria-label={`${ariaPrefix} product`}
          value={value.productId}
          disabled={disabled}
          onChange={(event) =>
            onChange(
              event.target.value === KEEP_CURRENT_CONTENTS
                ? { productId: KEEP_CURRENT_CONTENTS, contentBossCounts: {} }
                : selectionForProduct(products, event.target.value),
            )
          }
          className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-60`}
          required={!keepCurrentLabel}
        >
          {keepCurrentLabel ? <option value={KEEP_CURRENT_CONTENTS}>{keepCurrentLabel}</option> : null}
          {!keepCurrentLabel && !product ? <option value="">Choose a product…</option> : null}
          {products.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>

      {product ? (
        <ul className="space-y-2" aria-label={`${ariaPrefix} product contents`}>
          {orderedContents(product).map((content) => {
            const planned = plannedCountFor(content, value.contentBossCounts);
            if (content.bossCountMode === "FIXED") {
              return (
                <li
                  key={content.productRaidContentId}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-raised px-3 py-2 text-sm"
                >
                  <span>{content.raidName}</span>
                  <span className="text-xs text-muted">
                    Fixed · {planned}/{content.totalBossCount}
                  </span>
                </li>
              );
            }
            const { min, max } = variableBounds(content);
            return (
              <li key={content.productRaidContentId}>
                <label className="block text-sm">
                  <span className="mb-1 block text-muted">{content.raidName} bosses</span>
                  <input
                    type="number"
                    min={min}
                    max={max}
                    value={planned}
                    disabled={disabled}
                    onChange={(event) => setCount(content.productRaidContentId, Number(event.target.value))}
                    className={inputClass}
                    aria-label={`${ariaPrefix} ${content.raidName} planned bosses`}
                  />
                  <span className="mt-1 block text-xs text-muted">
                    {min > 1 ? `${min}–${max}` : `Out of ${max}`} bosses in {content.raidName}.
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** Compact one-line content summary for a selection, e.g. "Venomous 8/8 · Tide 1/1". */
export function selectionSummary(products: readonly PlanningProduct[], value: ProductSelection): string {
  const product = products.find((row) => row.id === value.productId);
  if (!product) return "—";
  return orderedContents(product)
    .map((content) => `${content.raidName} ${plannedCountFor(content, value.contentBossCounts)}/${content.totalBossCount}`)
    .join(" · ");
}
