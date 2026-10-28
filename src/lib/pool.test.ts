import { describe, expect, it } from "vitest";
import { runPool } from "./pool";

/** A promise settled from outside. */
function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => { open = r; });
  return { p, open };
}

describe("runPool", () => {
  it("starts items in order, never more than `limit` at a time, and finishes them all", async () => {
    const gates = Array.from({ length: 6 }, gate);
    const started: number[] = [];
    let inFlight = 0;
    let peak = 0;
    const run = runPool([0, 1, 2, 3, 4, 5], 3, async (i) => {
      started.push(i);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await gates[i].p;
      inFlight--;
    });
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    gates[1].open();
    await new Promise((r) => setTimeout(r, 0));
    // The slot freed by item 1 goes to item 3, not to the one after 1.
    expect(started).toEqual([0, 1, 2, 3]);
    for (const g of gates) g.open();
    await run;
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(3);
    expect(inFlight).toBe(0);
  });

  it("a limit wider than the list, or below one, still works", async () => {
    const seen: number[] = [];
    await runPool([1, 2], 10, async (n) => { seen.push(n); });
    await runPool([3], 0, async (n) => { seen.push(n); });
    await runPool([], 3, async () => { seen.push(-1); });
    expect(seen).toEqual([1, 2, 3]);
  });

  it("an item that throws rejects the run", async () => {
    await expect(runPool([1, 2], 2, async (n) => { if (n === 2) throw new Error("boom"); })).rejects.toThrow("boom");
  });
});
