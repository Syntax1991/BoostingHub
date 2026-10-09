/** UPPER_SNAKE_CASE identity: letter first, then letters/digits/underscores (2–64 chars). */
export const PRODUCT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Postgres `Product.key` practical ceiling (matches create-form / validator max). */
export const PRODUCT_KEY_MAX_LENGTH = 64;

/**
 * Deterministic UPPER_SNAKE_CASE base key from a product display name.
 * Does not check uniqueness — call {@link allocateUniqueProductKey} for that.
 */
export function productKeyBaseFromName(name: string): string {
  let key = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  if (!key) key = "PRODUCT";
  if (!/^[A-Z]/.test(key)) key = `P_${key}`;
  if (key.length < 2) key = `${key}_X`;
  return key.slice(0, PRODUCT_KEY_MAX_LENGTH);
}

function candidateAt(base: string, attempt: number): string {
  if (attempt <= 1) {
    const key = base.slice(0, PRODUCT_KEY_MAX_LENGTH);
    return PRODUCT_KEY_PATTERN.test(key) ? key : "PRODUCT";
  }
  const suffix = `_${attempt}`;
  const room = PRODUCT_KEY_MAX_LENGTH - suffix.length;
  let truncated = base.slice(0, Math.max(1, room)).replace(/_+$/, "");
  if (!truncated || !/^[A-Z]/.test(truncated)) truncated = "PRODUCT";
  if (truncated.length < 2) truncated = `${truncated}X`.slice(0, room);
  const key = `${truncated}${suffix}`;
  return PRODUCT_KEY_PATTERN.test(key) ? key : `PRODUCT${suffix}`.slice(0, PRODUCT_KEY_MAX_LENGTH);
}

/**
 * Pick the first free key: BASE, BASE_2, BASE_3, …
 * `isTaken` should reflect the current DB (call inside a transaction when possible).
 */
export function allocateUniqueProductKey(base: string, isTaken: (key: string) => boolean | Promise<boolean>): string | Promise<string> {
  const normalized = productKeyBaseFromName(base);

  const next = async (): Promise<string> => {
    for (let attempt = 1; attempt < 10_000; attempt += 1) {
      const key = candidateAt(normalized, attempt);
      if (!(await Promise.resolve(isTaken(key)))) return key;
    }
    throw new Error("Could not allocate a unique product key.");
  };

  return next();
}
