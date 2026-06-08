// Fallback budget for any heartbeat row created before 0101 added per-job
// max_age_seconds. Each row now carries its OWN budget so slower jobs
// (ending-soon */10, final-payment-due hourly, prune daily) aren't false-stale.
export const DEFAULT_STALE_SECONDS = 300;

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
  const jobs: HeartbeatJob[] = rows.map((r) => {
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
