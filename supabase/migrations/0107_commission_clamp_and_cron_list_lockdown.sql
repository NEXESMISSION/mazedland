-- ============================================================================
-- MONEY + SECURITY hardening (re-benchmark findings).
--
-- 1) batta_commission_rate() (0074) regex-guards the admin value but has NO
--    upper bound, so an admin fat-finger of rate=5 (meant "5%") or any value >1
--    drives seller_earnings.net_amount = amount*(1-rate) NEGATIVE — the seller
--    is shown (and could be paid) a negative balance. Clamp the effective rate
--    to [0, 0.95]: net is always ≥ 5% of gross, never negative.
--
-- 2) list_cron_jobs() (0022) is SECURITY DEFINER, GRANTed to `authenticated`,
--    with no admin gate — any logged-in user can enumerate the pg_cron schedule
--    (job names + command text). It is not called anywhere in the app, so just
--    revoke it from authenticated (keep service_role for ops). Closes the
--    internal-schema disclosure and pre-empts secret exposure if a future cron
--    is ever scheduled with an embedded HTTP bearer.
-- ============================================================================

-- 1) Clamp the commission rate.
create or replace function public.batta_commission_rate()
returns numeric
language sql
stable
set search_path = public
as $$
  select least(
    greatest(
      coalesce(
        (
          select (value ->> 'rate')::numeric
            from public.app_settings
           where key = 'commission'
             and (value ->> 'rate') ~ '^[0-9]+(\.[0-9]+)?$'
           limit 1
        ),
        0.05::numeric
      ),
      0::numeric
    ),
    0.95::numeric
  );
$$;

-- 2) Lock down the cron-schedule enumerator.
revoke execute on function public.list_cron_jobs() from authenticated;

notify pgrst, 'reload schema';
