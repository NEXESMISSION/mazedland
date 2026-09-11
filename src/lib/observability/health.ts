// Fallback budget for any heartbeat row created before 0101 added per-job
// max_age_seconds. Each row now carries its OWN budget so slower jobs
// (ending-soon */10, final-payment-due hourly, prune daily) aren't false-stale.
export const DEFAULT_STALE_SECONDS = 300;

/**
 * Heartbeats of jobs that no longer exist.
 *
 * These four drove the auction engine. The jobs were unscheduled when the
 * product was retired, but their `cron_heartbeat` rows were not deleted — so
 * every one of them aged past its budget, and /api/health has answered 503
 * ever since. An uptime monitor pointed at it reports the whole site DOWN, and
 * the genuinely useful signal (is the SMS / e-mail drain running?) is buried
 * under four alarms that can never clear.
 *
 * A denylist rather than an allowlist on purpose: a job added tomorrow is
 * monitored the moment it stamps a heartbeat, without anyone remembering to
 * register it here.
 */
export const RETIRED_HEARTBEATS: ReadonlySet<string> = new Set([
  "tick_auctions",
  "process_bid_events",
  "notify_auctions_ending_soon",
  "notify_final_payment_due",
]);

export type HeartbeatRow = {
  job: string;
  last_run: string;
  max_age_seconds: number | null;
};

export type HeartbeatJob = {
  job: string;
  last_run: string;
  age_seconds: number;
  max_age_seconds: number;
  stale: boolean;
};

export type HeartbeatStatus = {
  ok: boolean;
  stale: string[];
  jobs: HeartbeatJob[];
};

/**
 * Pure dead-man's-switch evaluation: given the cron_heartbeat rows and a clock,
 * compute which jobs are stale (age beyond their OWN max_age_seconds budget) and
 * the overall ok flag. Zero rows is treated as not-yet-healthy (don't 200 a
 * fresh deploy whose crons haven't stamped yet). Extracted from the /api/health
 * route so the staleness logic is unit-testable without a live DB.
 */
export function evaluateHeartbeats(rows: HeartbeatRow[], nowMs: number): HeartbeatStatus {
  const jobs: HeartbeatJob[] = rows.filter((r) => !RETIRED_HEARTBEATS.has(r.job)).map((r) => {
    const ageS = Math.round((nowMs - new Date(r.last_run).getTime()) / 1000);
    const maxAge =
      Number(r.max_age_seconds ?? DEFAULT_STALE_SECONDS) || DEFAULT_STALE_SECONDS;
    return {
      job: r.job,
      last_run: r.last_run,
      age_seconds: ageS,
      max_age_seconds: maxAge,
      stale: ageS > maxAge,
    };
  });
  const stale = jobs.filter((j) => j.stale).map((j) => j.job);
  const ok = jobs.length > 0 && stale.length === 0;
  return { ok, stale, jobs };
}
