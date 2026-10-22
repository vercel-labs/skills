const DEFAULT_FETCH_CONCURRENCY = 4;

/** How many sources may clone or download at once; override with SKILLS_CLONE_CONCURRENCY. */
export function fetchConcurrency(): number {
  const parsed = Number.parseInt(process.env.SKILLS_CLONE_CONCURRENCY ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_FETCH_CONCURRENCY;
}

/** Map `items` through `fn` with at most `limit` in flight; results keep input order. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
  limit = fetchConcurrency()
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
