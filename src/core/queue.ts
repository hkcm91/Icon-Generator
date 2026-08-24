/**
 * Bounded-concurrency worker pool.
 *
 * A 250-icon family cannot be fired off with Promise.all: the API rate-limits,
 * and a browser will not hold 250 concurrent requests anyway. N workers pulling
 * from a shared cursor keeps exactly N in flight, which is both what the API
 * tolerates and what makes progress reporting meaningful.
 */

export interface PoolProgress {
  total: number;
  completed: number;
  active: number;
  failed: number;
}

export async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (progress: PoolProgress) => void,
  shouldStop?: () => boolean,
): Promise<Array<{ item: T; result?: R; error?: Error }>> {
  const results: Array<{ item: T; result?: R; error?: Error }> = new Array(items.length);
  const width = Math.max(1, Math.min(concurrency, items.length));

  let cursor = 0;
  let completed = 0;
  let active = 0;
  let failed = 0;

  const report = () => onProgress?.({ total: items.length, completed, active, failed });
  report();

  const run = async () => {
    for (;;) {
      // Checked before taking work, so a stop request drains rather than
      // aborting mid-flight and leaving a card stuck on "generating".
      if (shouldStop?.()) return;
      const index = cursor++;
      if (index >= items.length) return;

      active++;
      report();
      try {
        results[index] = { item: items[index], result: await worker(items[index], index) };
      } catch (error) {
        failed++;
        results[index] = {
          item: items[index],
          error: error instanceof Error ? error : new Error(String(error)),
        };
      } finally {
        active--;
        completed++;
        report();
      }
    }
  };

  await Promise.all(Array.from({ length: width }, run));
  return results.filter(Boolean);
}
