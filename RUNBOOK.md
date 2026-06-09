# Batta.tn — Operations Runbook

The on-call reference: how to tell the system is healthy, find an incident, and
recover. Pairs with [ARCHITECTURE.md](ARCHITECTURE.md) (how it's built) and the
go-to-market check (`node scripts/launch-check.mjs`).

Prod Supabase project ref: `sajxoovrsoacfnytiijv`. Host: Vercel. DB cron: pg_cron.

---

## 1. Is it healthy? — `/api/health`

A dead-man's-switch over `cron_heartbeat`: every background job stamps a
heartbeat on success; the endpoint returns **503** if any job is past its
freshness budget, **200** otherwise.

- **Public:** `GET /api/health` → `{ ok, stale_count }` (no detail).
- **Detailed:** add `Authorization: Bearer $CRON_SECRET` (or `?key=`) → per-job
  `{ job, last_run_at, max_age_seconds, stale }`.
- **DO THIS BEFORE LAUNCH:** point an external uptime monitor (UptimeRobot,
  Better Stack, Pingdom) at `/api/health` with a 2–5 min interval and alert on
  non-200. This is the single most important production alarm — it catches a
  pg_cron stall (auctions stop closing) before customers do.

The 10 prod pg_cron jobs (verify with `select * from cron.job;` or
`scripts/launch-check.mjs`): `tick_auctions` + `process_bid_events` (every
minute), `batta-ending-soon`, `batta-final-payment-due`, plus nightly cleanup
jobs. notify-email runs on the **Vercel** cron (`vercel.json`), not pg_cron.

## 2. Finding an incident — logs & tracing

- **Request correlation:** every request gets an 8-char request-id
  (`src/lib/observability/requestContext.ts`), echoed in the `x-request-id`
  response header and on every server log line + in `fail()` error bodies. To
  trace one failure end-to-end, grep Vercel logs for that id.
- **Client crashes:** browser errors POST to `/api/observability/client-error`
  → land in `activity_log` (and the log stream) alongside server errors.
- **Where:** Vercel dashboard → the project → Logs (functions + middleware).
- **Activity audit:** `activity_log` table — pageviews (sampled, see
  `ACTIVITY_PAGEVIEW_*` env) + actions (bids/payments/logins, always recorded).
  PII auto-scrubbed at 30 days (`prune_activity_log`).

## 3. Common incidents & recovery

| Symptom | Check | Fix |
|---|---|---|
| **Auctions not closing / winners not set** | `tick_auctions` heartbeat stale in `/api/health` | Manually fire the backstop: `GET /api/cron/auctions/tick` with `Authorization: Bearer $CRON_SECRET`. Confirm pg_cron job `tick_auctions` is `active`. It's bounded to 500/run — a backlog drains over consecutive minutes. |
| **Outbid / watchlist pings lagging** | `process_bid_events` heartbeat | The tick route also drains `bid_events`; hit it (above) or check the pg_cron job. Up to ~1 min lag on a very hot lot is expected. |
| **Stranded `scheduled` auction (window elapsed, never went live)** | auction stuck in `scheduled` past `starts_at` | `tick_auctions_cron` (0100) rescues these automatically next tick; fire the backstop to force it. |
| **Emails not sending** | `notify_email` heartbeat; `RESEND_API_KEY`/`EMAIL_FROM` set in Vercel | Without Resend keys the worker is a silent no-op (notifications stay in-app). Set keys + verify the sender domain. Backlog lives in the outbox; dead-letters raise an admin alert. |
| **Payment captured in error / buyer defaulted after payout** | `/admin/payments`, `seller_balance.clawback_owed` | `reverse_settlement(payment_id, reason)` admin RPC (0110) flips a captured buy_now/final_payment to refunded; `seller_earnings` drops it automatically. |
| **Deposit stuck locked after close** | `/admin/deposits` | The `_release_deposits_on_close` trigger (0072) frees non-winner deposits on terminal status. If one is stranded, fire the tick backstop or check the auction reached a terminal state. |
| **Whole site down** | Supabase status + Vercel status | Single-provider blast radius: if Supabase (DB/Auth/Realtime/Storage) has an incident, the app is down. No failover — check status.supabase.com. |

## 4. Secrets rotation (DO BEFORE LAUNCH)

The DB password, service-role key, and Supabase access token were shared in
development. Rotate all three in the Supabase dashboard, then update Vercel env +
local `.env.local`. Also set/rotate `CRON_SECRET` in Vercel (cron routes return
503 if unset, so the backstops + email worker stop).

## 5. Backups & restore

Supabase Point-in-Time Recovery is **tier-dependent** — confirm it's enabled for
the prod project (Dashboard → Database → Backups). Without it you only have daily
logical backups. Test a restore-to-staging once before launch so the procedure
is known, not discovered during an incident.

## 6. Deploy & rollback

- Branch `fix/scale-audit-blockers` → `main` (Vercel auto-deploys `main`).
- **Migrate before merge:** apply any new SQL migration to prod
  (`SUPABASE_DB_PASSWORD=… supabase db push`) BEFORE the code that uses it lands
  on `main` — otherwise the deploy hits a missing column/function.
- **Rollback:** Vercel dashboard → Deployments → promote the previous green
  deploy. Migrations are append-only and not auto-reverted; a bad migration needs
  a new forward-fixing migration.
- **Gate:** CI runs lint + typecheck + unit + the required RPC integration suite
  on every PR to `main`. Never merge red.
