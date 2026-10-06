-- ============================================================================
-- 0162 · Retire what the auction product left behind
--
-- 0153 deleted the auction product, but some of it outlived the deletion:
--
--   - The commission-rate function, which read app_settings.commission to price
--     an auction sale. Nothing has called it since.
--   - final_payment_interval(), which read final_payment_days for a winner's
--     final payment. Its only caller, _stamp_final_payment_due(), has not been
--     attached to any trigger since 0153.
--   - Five auction settings — commission, deposit, fee_listing_auction,
--     final_payment_days, forfeit_policy — and nine pay-per-post prices
--     (fee_listing_direct, listing_fee_tnd, listing_fee_offer_tnd and six
--     promo_* keys) that `products` (0150) replaced. No code reads any of them;
--     the prices that apply are the ones in /admin/offres.
--   - Four cron jobs still named with the old brand prefix. They are found by
--     the function they run, not by name, and rescheduled as mazed-* with the
--     same schedule and command.
--   - The seed payee's company name. The seed payee is recognisable by its
--     IBAN, which belongs to nobody (0026); usablePayeeMethods refuses it with
--     or without a name, so blanking the name changes nothing for a seller —
--     paid publication stays unavailable until /admin/settings holds a real
--     payee — it only stops the console displaying the old brand.
--
-- Idempotent: every step is a no-op where its target is already gone.
-- ============================================================================

drop function if exists public._stamp_final_payment_due();
drop function if exists public.final_payment_interval();

-- The auction commission function, whatever its brand prefix.
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like '%\_commission\_rate'
  loop
    execute format('drop function %s', f);
  end loop;
end $$;

delete from public.app_settings
 where key in (
   'commission', 'deposit', 'fee_listing_auction', 'final_payment_days', 'forfeit_policy',
   'fee_listing_direct', 'listing_fee_tnd', 'listing_fee_offer_tnd',
   'promo_banner', 'promo_banner_tnd', 'promo_home', 'promo_home_featured_tnd',
   'promo_top', 'promo_top_listed_tnd'
 );

update public.app_settings
   set value = '""'::jsonb, updated_at = now()
 where key = 'payee_name'
   and exists (
     select 1 from public.app_settings
      where key = 'payee_iban'
        and value = '"TN59 0700 3000 0123 4567 8907 8"'::jsonb
   );

-- Reschedule each housekeeping job under its mazed-* name.
do $$
declare
  t record;
  j record;
begin
  if to_regnamespace('cron') is null then
    return;
  end if;

  for t in
    select * from (values
      ('mazed-cleanup-notifications', 'cleanup_old_notifications'),
      ('mazed-cleanup-otps',          'cleanup_phone_otps'),
      ('mazed-prune-notifications',   'prune_read_notifications'),
      ('mazed-expire-promos',         'expire_listing_promotions')
    ) as v(name, fn)
  loop
    for j in
      select jobid, schedule, command
        from cron.job
       where command ilike '%public.' || t.fn || '(%'
         and jobname is distinct from t.name
    loop
      perform cron.unschedule(j.jobid);
      if not exists (select 1 from cron.job where jobname = t.name) then
        perform cron.schedule(t.name, j.schedule, j.command);
      end if;
    end loop;
  end loop;
end $$;
