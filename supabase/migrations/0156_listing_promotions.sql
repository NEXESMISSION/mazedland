-- ============================================================================
-- Promotions move from `properties` to `listings`.
--
-- TWO THINGS WERE BROKEN AT ONCE, and they turn out to be the same thing.
--
-- 1. `/admin/home` — the screen that decides what appears on the home page and
--    at the top of search — reads and writes `properties.promo_home_featured`,
--    `promo_top_listed`, `promo_banner`, `promo_expires_at` and `promo_manual`.
--    Migration 0153 dropped `properties`. The page answers 200 and lists
--    nothing; the POST route fails on every save.
--
-- 2. `products` has been selling three promotions since 0148 —
--    « Mise en avant · accueil », « Top de la recherche » and « Bannière
--    d'accueil » — and `expire_listing_promotions()` (which drove the same
--    `properties.promo_*` columns) went with the table in 0153. So a promo
--    could be bought and there was nowhere to record it and nothing to expire
--    it. I flagged that as a deliberate gap at the time rather than inventing
--    a schema inside a DROP migration. This is the migration that closes it.
--
-- The columns are the same five, on the table that survived. Same names on
-- purpose: `/admin/home` and its client component keep working with a change
-- of table, and the concepts did not change — only the row they hang off.
--
-- `promo_manual` is the one that earns its place. An admin can grant a
-- placement for free (a launch push, an apology, a favour) and a seller can buy
-- one; the two look identical in the data and must not, because only one of
-- them should be refunded if we take it down early.
-- ============================================================================

alter table public.listings
  add column if not exists promo_home_featured boolean     not null default false,
  add column if not exists promo_top_listed    boolean     not null default false,
  add column if not exists promo_banner        boolean     not null default false,
  add column if not exists promo_expires_at    timestamptz,
  add column if not exists promo_manual        boolean     not null default false;

-- The home page asks "what is featured, right now". A partial index over just
-- the promoted rows keeps that answer cheap as the catalogue grows, because the
-- promoted set stays small by construction.
create index if not exists listings_promo_active_idx
  on public.listings (promo_expires_at)
  where promo_home_featured or promo_top_listed or promo_banner;

comment on column public.listings.promo_manual is
  'True when an admin granted the placement rather than a seller buying it. The two are indistinguishable otherwise, and only one is refundable.';

-- ── Expiry ──────────────────────────────────────────────────────────────────
-- Rebuilt from the `expire_listing_promotions()` that 0153 dropped, against
-- `listings` instead of `properties`. Two differences from the original, both
-- deliberate:
--
--   * it notifies with kind `promo_expired`, not `listing_expired`. The old one
--     reused the listing-expiry kind, so "votre annonce a expiré" and "votre
--     mise en avant a expiré" arrived as the same kind and the bell could not
--     tell a seller which had happened.
--   * the link goes to the annonce, not to a seller dashboard that no longer
--     exists.
create or replace function public.expire_listing_promotions()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_l     record;
begin
  for v_l in
    select id, seller_id, title
      from public.listings
     where promo_expires_at is not null
       and promo_expires_at <= now()
       and (promo_home_featured or promo_top_listed or promo_banner)
     for update skip locked
  loop
    update public.listings
       set promo_home_featured = false,
           promo_top_listed    = false,
           promo_banner        = false,
           promo_expires_at    = null,
           promo_manual        = false,
           updated_at          = now()
     where id = v_l.id;

    -- Best-effort: a notification failure must never leave a promotion live.
    begin
      perform public.enqueue_notification(
        v_l.seller_id,
        'promo_expired',
        'Mise en avant terminée',
        'La mise en avant de « ' || v_l.title || ' » a expiré. '
          || 'Votre annonce reste en ligne.',
        '/annonces/' || v_l.id::text
      );
    exception when others then
      raise warning 'promo expiry notification failed for %: %', v_l.id, sqlerrm;
    end;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.expire_listing_promotions() from public, anon, authenticated;
grant execute on function public.expire_listing_promotions() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('batta-expire-promos')
      where exists (select 1 from cron.job where jobname = 'batta-expire-promos');
    perform cron.schedule('batta-expire-promos', '*/15 * * * *',
                          'select public.expire_listing_promotions();');
  end if;
end $$;

notify pgrst, 'reload schema';
