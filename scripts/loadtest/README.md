# Scale / load testing

The two scenarios that decide whether Batta survives "thousands of users in the
final minute" — the hot-lot **bid** path (#2) and the realtime **fan-out** (#3).
Both run with plain `node` (no Docker) against a **throwaway staging** Supabase
project, and both hard-refuse the prod ref unless `FORCE_PROD=1`.

> Never run these against prod — they create users, place bids, and insert rows.

## 1. Stand up a staging target (~5 min)

1. [supabase.com](https://supabase.com) → **New project** (free tier). Pick a
   region close to prod, set a DB password.
2. Link + apply the full schema:
   ```pwsh
   supabase link --project-ref <staging-ref>
   $env:SUPABASE_DB_PASSWORD="<staging db password>"
   supabase db push          # applies supabase/migrations/** (through 0119+)
   ```
3. From **Settings → API**, grab the Project URL, `anon` key, and `service_role`
   key into your shell:
   ```pwsh
   $env:LOADTEST_SUPABASE_URL="https://<staging-ref>.supabase.co"
   $env:LOADTEST_SERVICE_KEY="<service_role key>"
   $env:LOADTEST_ANON_KEY="<anon key>"
   ```

## 2. Hot-lot bid throughput — `hot-lot-bids.mjs` (#2)

Drives N concurrent signed-in bidders at ONE auction and reports the
`FOR UPDATE` lock-contention curve.

```pwsh
$env:USERS="300"; $env:DURATION_SEC="60"
node scripts/loadtest/hot-lot-bids.mjs
```

Reports throughput (bids/sec) + p50/p95/p99 `place_bid` latency + the outcome
histogram. **Read it:** re-run at `USERS=50/200/500`. If p95/p99 latency climbs
sharply with more users, you've hit the single-row serialization ceiling — the
fix is reducing work under the lock (a tested `place_bid` change), not more CPU.

## 3. Realtime fan-out — `realtime-fanout.mjs` (#3)

Opens N concurrent realtime subscriptions to one auction's bid channel, fires M
bids, and measures delivery rate + insert→receive latency.

```pwsh
$env:VIEWERS="300"; $env:BIDS="80"
node scripts/loadtest/realtime-fanout.mjs
```

Needs Node 22+ (global `WebSocket`) or `npm i -D ws`. **Read it:** re-run at
`VIEWERS=100/300/1000`. If delivery drops below ~99% or p95 latency balloons,
you're at the Supabase Realtime throughput ceiling for your tier — upgrade the
tier or move the hot-lot price to a single coalesced broadcast instead of
per-row `postgres_changes`.

## What "passing" looks like

- **Bids:** p99 latency stays flat (e.g. < ~150 ms) and throughput scales with
  users up to your target concurrency; no error spike beyond expected
  `below_min_increment` / `bid_too_fast`.
- **Realtime:** delivery ≥ 99% and p95 latency < ~1 s at your target `VIEWERS`.

Record the numbers per tier so the launch decision is a measurement, not a guess.
