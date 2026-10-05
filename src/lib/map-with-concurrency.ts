/**
 * Run async work over items with a hard concurrency ceiling.
 * Results preserve input order. Rejected promises surface as settled results
 * when using the `{ settle: true }` option helpers elsewhere — this function
 * awaits each worker and rethrows the first error (callers that need per-item
 * isolation should wrap the mapper themselves).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (concurrency < 1) {
    throw new Error("mapWithConcurrency: concurrency must be >= 1");
  }
  if (items.length === 0) return [];

  const limit = Math.min(concurrency, items.length);
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

/** Cap used for Raider.IO → Blizzard Character bulk preview. */
export const RAIDER_IO_LOOKUP_CONCURRENCY = 3;

/** Max Characters per Add Character dialog / bulk action. */
export const RAIDER_IO_BULK_MAX = 10;
