/**
 * Round-robin worker pool: at most `concurrency` workers active at once,
 * each pulling the next unclaimed item until the list is exhausted. Shared
 * by manual Blizzard "Refresh All" and the scheduled Blizzard character sync
 * job so both enforce their concurrency ceiling the same way.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!);
    }
  }

  const pool = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: pool }, () => runWorker()));
  return results;
}
