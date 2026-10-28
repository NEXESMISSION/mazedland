/**
 * Run `fn` over `items`, at most `limit` at a time, started in order.
 *
 * A phone preparing and sending eight photos one after another finished the
 * last one late and left the network idle while it encoded and the CPU idle
 * while it sent. Three in flight keeps both busy and the first photo early
 * (PhotoUploader). `fn` is expected to catch its own errors: one that throws
 * rejects the whole run, as Promise.all would.
 */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
}
