-- ============================================================================
-- PIVOT PHASE 4 -- listings expire, and the seller hears about it first.
--
-- Ported from Mazed Auto's 0156. Land's `listings` table has carried
-- `expires_at` since 0146 and `products.duration_days` has said "30" since
-- 0148, but nothing ever read either: the 30-day lifecycle was written down
-- and inert. `/admin/annonces` even ships "Expirent bientot" and "Expirees"
-- tabs, and the second could never have shown a row.
--
-- Expiry is what keeps a classifieds catalogue honest: without it, every villa
-- sold last spring is still on the site, buyers stop trusting the listings, and
-- a one-time publication fee never repeats. Property is the harder case, not
-- the easier one -- a plot that sold quietly six months ago looks exactly like
-- a plot for sale, and there is no registration number a buyer can check.
--
-- Two jobs in one function:
--   * J-3 warning, once per listing (marked in attributes so a re-run cannot
--     send it twice -- the notification table is the outbox, not a log).
--   * published -> expired, the moment expires_at passes.
--
-- Notifications go through enqueue_notification, so they land in the bell and
-- ride the existing e-mail/SMS drains with no new plumbing.
--
-- The cron slot below is deliberately hourly and at :07, away from
-- `tick_auctions` on the every-minute lane. That job is still running the
-- auction product out; this one must not queue behind it.
-- ============================================================================

create or replace function public.expire_listings()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_warned  int := 0;
  v_expired int := 0;
  r         record;
begin
  -- ── J-3: "votre annonce expire bientôt" ──────────────────────────────────
  for r in
    select id, seller_id, title, expires_at
      from public.listings
     where status = 'published'
       and expires_at is not null
       and expires_at <= now() + interval '3 days'
       and expires_at > now()
       and coalesce((attributes->>'_expiry_warned')::boolean, false) = false
     for update skip locked
  loop
    perform public.enqueue_notification(
      r.seller_id,
      'listing_expiring',
      'Votre annonce expire bientôt',
      format('« %s » sera retirée le %s. Renouvelez-la pour rester visible.',
             r.title, to_char(r.expires_at, 'DD/MM')),
      '/account/listings'
    );
    update public.listings
       set attributes = attributes || jsonb_build_object('_expiry_warned', true)
     where id = r.id;
    v_warned := v_warned + 1;
  end loop;

  -- ── The expiry itself ────────────────────────────────────────────────────
  for r in
    select id, seller_id, title
      from public.listings
     where status = 'published'
       and expires_at is not null
       and expires_at <= now()
     for update skip locked
  loop
    update public.listings
       set status = 'expired',
           attributes = attributes - '_expiry_warned'   -- so a renewal warns again
     where id = r.id;

    perform public.enqueue_notification(
      r.seller_id,
      'listing_expired',
      'Annonce expirée',
      format('« %s » n''est plus visible. Renouvelez-la pour la remettre en ligne.', r.title),
      '/account/listings'
    );
    v_expired := v_expired + 1;
  end loop;

  return json_build_object('ok', true, 'warned', v_warned, 'expired', v_expired);
end;
$$;

revoke all on function public.expire_listings() from public, anon, authenticated;
grant execute on function public.expire_listings() to service_role;

-- Hourly. Expiry is a date, not a deadline to the second — an hour of slack
-- costs nothing and keeps this off the every-minute lane with tick_auctions.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('expire_listings')
      where exists (select 1 from cron.job where jobname = 'expire_listings');
    perform cron.schedule('expire_listings', '7 * * * *', 'select public.expire_listings();');
  end if;
end $$;

notify pgrst, 'reload schema';
