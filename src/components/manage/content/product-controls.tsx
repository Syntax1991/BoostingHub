"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createProductAction,
  deleteProductAction,
  setProductActiveAction,
  setProductSelectableAction,
  updateProductAction,
} from "@/controllers/content-catalog.actions";
import { CheckboxField, ContentDialog, Field, fieldInputClass } from "@/components/manage/content/content-dialog";

export type ProductRaidOption = { id: string; name: string; bossTotal: number };

type ContentRow = {
  raidId: string;
  bossCountMode: "FIXED" | "VARIABLE";
  fixedBossCount: string;
  minBossCount: string;
  defaultBossCount: string;
};

export type ProductFormValues = {
  productId?: string;
  name: string;
  active: boolean;
  selectable: boolean;
  sortOrder: number;
  contents: ReadonlyArray<{
    raidId: string;
    bossCountMode: "FIXED" | "VARIABLE";
    fixedBossCount: number | null;
    minBossCount: number | null;
    defaultBossCount: number | null;
  }>;
};

const text = (value: number | null) => (value == null ? "" : String(value));

function toRows(values?: ProductFormValues): ContentRow[] {
  if (!values || values.contents.length === 0) {
    return [{ raidId: "", bossCountMode: "VARIABLE", fixedBossCount: "", minBossCount: "1", defaultBossCount: "" }];
  }
  return values.contents.map((content) => ({
    raidId: content.raidId,
    bossCountMode: content.bossCountMode,
    fixedBossCount: text(content.fixedBossCount),
    minBossCount: text(content.minBossCount),
    defaultBossCount: text(content.defaultBossCount),
  }));
}

/** Create or edit a Product with its ordered raid contents. The key is generated server-side and never edited. */
export function ProductFormDialog({ product, raids }: { product?: ProductFormValues; raids: ProductRaidOption[] }) {
  const editing = Boolean(product?.productId);
  const [name, setName] = useState(product?.name ?? "");
  const [active, setActive] = useState(product?.active ?? true);
  const [selectable, setSelectable] = useState(product?.selectable ?? true);
  const [sortOrder, setSortOrder] = useState(String(product?.sortOrder ?? 0));
  const [rows, setRows] = useState<ContentRow[]>(toRows(product));

  function reset() {
    setName(product?.name ?? "");
    setActive(product?.active ?? true);
    setSelectable(product?.selectable ?? true);
    setSortOrder(String(product?.sortOrder ?? 0));
    setRows(toRows(product));
  }

  function patch(index: number, change: Partial<ContentRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)));
  }

  function move(index: number, delta: -1 | 1) {
    setRows((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function submit() {
    const contents = rows.map((row) => ({
      raidId: row.raidId,
      bossCountMode: row.bossCountMode,
      fixedBossCount: row.bossCountMode === "FIXED" ? row.fixedBossCount : null,
      minBossCount: row.bossCountMode === "VARIABLE" ? row.minBossCount : null,
      defaultBossCount: row.bossCountMode === "VARIABLE" ? row.defaultBossCount : null,
    }));
    const fields = { name, active, selectable, sortOrder, contents };
    return editing ? updateProductAction({ ...fields, productId: product!.productId }) : createProductAction(fields);
  }

  return (
    <ContentDialog
      triggerLabel={editing ? "Edit" : "New product"}
      triggerVariant={editing ? "secondary" : "primary"}
      triggerClassName={editing ? "h-8 px-2 text-xs" : "h-9 px-3 text-sm"}
      title={editing ? `Edit product · ${product?.name}` : "New product"}
      description="Products describe what can be scheduled. Editing them never changes existing Runs or Run Setups. The internal key is generated automatically and never shown here."
      submitLabel={editing ? "Save product" : "Create product"}
      wide
      onOpen={reset}
      onSubmit={submit}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input className={fieldInputClass} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Order">
          <input className={fieldInputClass} type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </Field>
        <div className="flex flex-col justify-end gap-2 sm:col-span-2">
          <CheckboxField label="Active" checked={active} onChange={setActive} />
          <CheckboxField label="Selectable" checked={selectable} onChange={setSelectable} />
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm text-muted">Raid contents (in order)</legend>
        {rows.map((row, index) => {
          const raid = raids.find((option) => option.id === row.raidId);
          return (
            <div key={index} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-end gap-2">
                <span className="w-6 pb-2 text-xs text-muted">{index + 1}.</span>
                <label className="min-w-[12rem] flex-1 text-sm">
                  <span className="mb-1 block text-xs text-muted">Raid</span>
                  <select
                    className={fieldInputClass}
                    value={row.raidId}
                    onChange={(e) => patch(index, { raidId: e.target.value })}
                  >
                    <option value="">Choose a raid…</option>
                    {raids.map((option) => (
                      <option key={option.id} value={option.id} disabled={option.bossTotal === 0}>
                        {option.name} ({option.bossTotal} encounter{option.bossTotal === 1 ? "" : "s"})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-muted">Boss count</span>
                  <select
                    className={fieldInputClass}
                    value={row.bossCountMode}
                    onChange={(e) => patch(index, { bossCountMode: e.target.value as ContentRow["bossCountMode"] })}
                  >
                    <option value="VARIABLE">Variable</option>
                    <option value="FIXED">Fixed</option>
                  </select>
                </label>
                {row.bossCountMode === "FIXED" ? (
                  <label className="w-24 text-sm">
                    <span className="mb-1 block text-xs text-muted">Bosses</span>
                    <input
                      className={fieldInputClass}
                      type="number"
                      min={1}
                      max={raid?.bossTotal}
                      value={row.fixedBossCount}
                      onChange={(e) => patch(index, { fixedBossCount: e.target.value })}
                    />
                  </label>
                ) : (
                  <>
                    <label className="w-20 text-sm">
                      <span className="mb-1 block text-xs text-muted">Min</span>
                      <input
                        className={fieldInputClass}
                        type="number"
                        min={1}
                        max={raid?.bossTotal}
                        value={row.minBossCount}
                        onChange={(e) => patch(index, { minBossCount: e.target.value })}
                      />
                    </label>
                    <label className="w-20 text-sm">
                      <span className="mb-1 block text-xs text-muted">Default</span>
                      <input
                        className={fieldInputClass}
                        type="number"
                        min={1}
                        max={raid?.bossTotal}
                        value={row.defaultBossCount}
                        onChange={(e) => patch(index, { defaultBossCount: e.target.value })}
                      />
                    </label>
                  </>
                )}
                <span className="pb-2 text-xs text-muted">{raid ? `max ${raid.bossTotal}` : ""}</span>
                <span className="ml-auto inline-flex gap-1">
                  <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)} className="h-8 w-8 rounded-md text-muted hover:bg-surface-raised disabled:opacity-40">
                    ↑
                  </button>
                  <button type="button" aria-label="Move down" disabled={index === rows.length - 1} onClick={() => move(index, 1)} className="h-8 w-8 rounded-md text-muted hover:bg-surface-raised disabled:opacity-40">
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label="Remove content"
                    disabled={rows.length === 1}
                    onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                    className="h-8 rounded-md px-2 text-xs text-danger hover:bg-danger/10 disabled:opacity-40"
                  >
                    Remove
                  </button>
                </span>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() =>
            setRows((current) => [
              ...current,
              { raidId: "", bossCountMode: "VARIABLE", fixedBossCount: "", minBossCount: "1", defaultBossCount: "" },
            ])
          }
          className="h-8 rounded-md border border-border px-2 text-xs hover:bg-surface-raised"
        >
          Add raid content
        </button>
        <p className="text-xs text-muted">The maximum boss count always follows the raid&apos;s encounter count.</p>
      </fieldset>
    </ContentDialog>
  );
}

/** Inline Active / Selectable toggle (lifecycle; no confirmation needed). */
export function ProductFlagToggle({
  productId,
  flag,
  value,
}: {
  productId: string;
  flag: "active" | "selectable";
  value: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const label =
    flag === "active" ? (value ? "Deactivate" : "Activate") : value ? "Hide from selection" : "Make selectable";

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const action = flag === "active" ? setProductActiveAction : setProductSelectableAction;
            const result = await action({ productId, value: !value });
            if (!result.ok) {
              setError(result.message);
              return;
            }
            router.refresh();
          });
        }}
        className="h-8 rounded-md px-2 text-xs text-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
      >
        {label}
      </button>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function DeleteProductButton({ productId, name }: { productId: string; name: string }) {
  return (
    <ContentDialog
      triggerLabel="Delete"
      triggerVariant="ghost"
      triggerClassName="h-8 px-2 text-xs text-danger"
      title={`Delete product ${name}?`}
      description="The product and its raid contents are removed permanently. Existing Runs and Run Setups never reference a product and stay unchanged. Prefer Deactivate if it may be needed again."
      submitLabel="Delete product"
      pendingLabel="Deleting…"
      danger
      onSubmit={() => deleteProductAction({ productId })}
    />
  );
}
