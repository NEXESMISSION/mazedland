import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { minBidIncrement } from "./utils";

/**
 * SQL/TS parity guard for the money-critical ladders.
 *
 * The bid-increment ladder and the Dutch price formula exist in TWO places:
 *   - TS  (src/lib/utils.ts minBidIncrement, src/lib/auction-engine.ts
 *          dutchCurrentPrice) — drives what the UI shows as the minimum next
 *          bid / current Dutch price.
 *   - SQL (supabase/migrations/0006_security_lockdown.sql bid_increment /
 *          dutch_current_price) — the AUTHORITY enforced inside place_bid
 *          (raises below_min_increment / dutch_price_drifted).
 *
 * They agreed only because a human kept them in sync by hand. If a future
 * settings change edits one and not the other, the UI computes a minimum the
 * RPC rejects with a 400 (or, worse, shows a too-low figure that fails on
 * submit). This test parses the canonical SQL out of the migration and asserts
 * the TS implementation produces byte-identical results, so drift fails CI with
 * no staging DB required.
 *
 * If you intentionally change a ladder, change BOTH copies and this test will
 * pass again; if you change one, it goes red and tells you which boundary moved.
 */

const SQL_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations/0006_security_lockdown.sql",
);

const SQL = readFileSync(SQL_PATH, "utf8");

/**
 * Parse the `bid_increment` ladder out of the SQL source as
 * [threshold, increment] pairs plus the trailing `else` increment, e.g.
 *   when current_bid < 100000 then 1000   →  [100000, 1000]
 *   ...
 *   else 25000                            →  elseInc = 25000
 * This is the single source of truth the RPC enforces; we re-derive a JS
 * function from it and compare to the TS ladder.
 */
function parseSqlBidIncrement(): (n: number) => number {
  const fnMatch = SQL.match(
    /create or replace function public\.bid_increment[\s\S]*?\$\$([\s\S]*?)\$\$/i,
  );
  if (!fnMatch) throw new Error("bid_increment function not found in SQL");
  const body = fnMatch[1];

  const bands: Array<[number, number]> = [];
  const whenRe = /when\s+current_bid\s*<\s*(\d+)\s+then\s+(\d+)/gi;
  for (let m = whenRe.exec(body); m; m = whenRe.exec(body)) {
    bands.push([Number(m[1]), Number(m[2])]);
  }
  const elseMatch = body.match(/else\s+(\d+)\s+end/i);
  if (!elseMatch) throw new Error("bid_increment else-branch not found in SQL");
  const elseInc = Number(elseMatch[1]);

  if (bands.length === 0) throw new Error("bid_increment bands not parsed from SQL");

  return (n: number) => {
    for (const [threshold, inc] of bands) {
      if (n < threshold) return inc;
    }
    return elseInc;
  };
}

describe("bid-increment ladder: TS ↔ SQL parity", () => {
  const sqlIncrement = parseSqlBidIncrement();

  // Boundaries that matter: just-below, at, and just-above every threshold the
  // SQL declares, plus a zero and a very large value. A drift in either copy
  // changes at least one of these.
  const probes = [
    0, 1, 99_999, 100_000, 100_001, 499_999, 500_000, 500_001, 999_999,
    1_000_000, 1_000_001, 5_000_000, 50_000_000,
  ];

  for (const n of probes) {
    it(`agrees at currentBid=${n}`, () => {
      expect(minBidIncrement(n)).toBe(sqlIncrement(n));
    });
  }

  it("agrees across a randomized sweep (1000 samples)", () => {
    for (let i = 0; i < 1000; i++) {
      const n = Math.floor(Math.random() * 3_000_000);
      expect(minBidIncrement(n)).toBe(sqlIncrement(n));
    }
  });
});

/**
 * Dutch price parity. The SQL formula is:
 *   greatest(floor, start - floor(elapsed / tick) * decrement)
 * The TS dutchCurrentPrice (auction-engine.ts) computes the same with
 * Math.max / Math.floor. We reproduce the SQL arithmetic verbatim from the
 * coalesce defaults declared in the migration and compare to the TS output for
 * a grid of (elapsed, decrement, tick) cases — catching any drift in the
 * floor/tick/coalesce semantics.
 */
import { dutchCurrentPrice } from "./auction-engine";
import type { Auction } from "./types";

describe("dutch price formula: TS ↔ SQL parity", () => {
  // Re-derive the SQL semantics straight from the migration text so this test
  // also fails if someone edits the coalesce defaults (60s tick, 0 decrement,
  // floor=opening) in SQL without touching the TS mirror.
  it("SQL still defaults tick to 60 and decrement to 0 (TS mirror assumption)", () => {
    const fn = SQL.match(
      /create or replace function public\.dutch_current_price[\s\S]*?\$\$([\s\S]*?)\$\$/i,
    );
    expect(fn, "dutch_current_price not found in SQL").toBeTruthy();
    const body = fn![1];
    expect(body).toMatch(/dutch_tick_seconds,\s*60/);
    expect(body).toMatch(/dutch_decrement,\s*0/);
    expect(body).toMatch(/dutch_floor_price,\s*a\.opening_price/);
    expect(body).toMatch(/dutch_start_price,\s*a\.opening_price/);
  });

  // Faithful re-implementation of the SQL arithmetic.
  function sqlDutch(
    start: number,
    floor: number,
    decrement: number,
    tick: number,
    elapsedSec: number,
  ): number {
    const ticks = Math.floor(Math.max(0, elapsedSec) / (tick || 1));
    return Math.max(floor, start - ticks * decrement);
  }

  const startIso = "2026-06-01T00:00:00Z";
  const startMs = new Date(startIso).getTime();

  const cases: Array<{ dec: number; tick: number; floor: number; start: number }> = [
    { start: 200_000, floor: 150_000, dec: 10_000, tick: 60 },
    { start: 1_000_000, floor: 250_000, dec: 25_000, tick: 30 },
    { start: 500_000, floor: 500_000, dec: 0, tick: 60 },
    { start: 300_000, floor: 100_000, dec: 7_333, tick: 45 },
  ];

  for (const c of cases) {
    it(`agrees for start=${c.start} dec=${c.dec} tick=${c.tick}`, () => {
      const a = {
        type: "dutch",
        starts_at: startIso,
        opening_price: c.start,
        dutch_start_price: c.start,
        dutch_floor_price: c.floor,
        dutch_decrement: c.dec,
        dutch_tick_seconds: c.tick,
      } as unknown as Auction;

      for (let elapsed = 0; elapsed <= 5000; elapsed += 17) {
        const now = new Date(startMs + elapsed * 1000);
        const ts = dutchCurrentPrice(a, now);
        const sql = sqlDutch(c.start, c.floor, c.dec, c.tick, elapsed);
        expect(ts, `elapsed=${elapsed}`).toBe(sql);
      }
    });
  }
});
