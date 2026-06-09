-- ============================================================================
-- OBSERVABILITY — pre-seed the notify_email heartbeat so /api/health detects the
-- TOTAL ABSENCE of the money-email worker, not just a stall.
--
-- 0104 has the worker stamp cron_heartbeat('notify_email') on each run, but no
-- row exists until the FIRST successful run — so if the Vercel cron is never
-- configured/deployed, /api/health has no notify_email row and reports healthy
-- while every money-critical email (auction_won, final_payment_due, payment/KYC
-- verdicts, the dead-letter + clawback admin alerts) silently never sends.
--
-- Pre-seed the row (budget 1800s ≈ 3 missed */10 runs). In prod the cron
-- refreshes it; if the worker is never wired, the row ages out and /health 503s
-- — which is the correct signal that the delivery channel is down.
-- ============================================================================

insert into public.cron_heartbeat (job, last_run, max_age_seconds)
values ('notify_email', now(), 1800)
on conflict (job) do update set max_age_seconds = excluded.max_age_seconds;

notify pgrst, 'reload schema';
