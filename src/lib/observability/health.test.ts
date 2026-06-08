import { describe, it, expect } from "vitest";
import { evaluateHeartbeats } from "./health";

// The dead-man's-switch is only useful if its staleness math is correct. These
// pin the per-job-budget comparison the /api/health route depends on.
describe("evaluateHeartbeats", () => {
  const now = Date.UTC(2026, 5, 9, 12, 0, 0);
  const ago = (s: number) => new Date(now - s * 1000).toISOString();

  it("is ok when every job is within its own budget", () => {
    const r = evaluateHeartbeats(
      [
        { job: "tick_auctions", last_run: ago(60), max_age_seconds: 300 },
        { job: "notify_final_payment_due", last_run: ago(3600), max_age_seconds: 7200 },
      ],
      now,
    );
    expect(r.ok).toBe(true);
    expect(r.stale).toEqual([]);
  });

  it("flags ONLY the job past its OWN budget (per-job thresholds)", () => {
    const r = evaluateHeartbeats(
      [
        // 50000s old: fine for a daily job (100000s) ...
        { job: "prune_activity_log", last_run: ago(50_000), max_age_seconds: 100_000 },
        // ... but stale for a minute job (300s).
        { job: "tick_auctions", last_run: ago(50_000), max_age_seconds: 300 },
      ],
      now,
    );
    expect(r.ok).toBe(false);
    expect(r.stale).toEqual(["tick_auctions"]);
  });

  it("falls back to the default budget when max_age_seconds is null", () => {
    const r = evaluateHeartbeats(
      [{ job: "legacy", last_run: ago(400), max_age_seconds: null }],
      now,
    );
    expect(r.jobs[0].max_age_seconds).toBe(300);
    expect(r.stale).toEqual(["legacy"]); // 400 > 300
  });

  it("is NOT ok with zero heartbeat rows (fresh deploy, nothing stamped yet)", () => {
    expect(evaluateHeartbeats([], now).ok).toBe(false);
  });
});
