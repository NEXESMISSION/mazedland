-- ============================================================================
-- Batta.tn — Phase 4: scheduled & lifecycle notifications.
--
-- Three additions:
--
--   1. welcome_notification — fires once on profile creation. We piggyback
--      on the existing auth.users → profiles trigger by extending the
--      _on_auth_user_created() function. The notification points to the
--      KYC start page since that's the next thing every new user needs.
--
--   2. auction_ending_soon — pg_cron job (every 10 minutes) that finds
--      live auctions whose ends_at falls in a defined window from now,
--      then pings every watcher + the current high bidder. We use a
--      dedicated state column (notifications_ending_*_sent_at) on
--      auctions so we never double-notify after a deadline extension.
--
--   3. listing_expired — hooks into expire_listing_promotions() so we
--      tell sellers when their paid promo placements run out.
-- ============================================================================

-- ─── 1. Welcome notification on first profile creation ─────────────────────

create or replace function public._on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted_id uuid;
begin
  insert into public.profiles (id, full_name, phone, role, language)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', null),
    coalesce(new.raw_user_meta_data ->> 'phone', null),
    coalesce(
      (new.raw_user_meta_data ->> 'role')::user_role,
      'individual'::user_role
    ),
    coalesce(new.raw_user_meta_data ->> 'language', 'ar')
  )
  on conflict (id) do nothing
  returning id into v_inserted_id;

  if (new.raw_user_meta_data ->> 'role') = 'admin' then
    update auth.users
      set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
        || jsonb_build_object('role', 'admin')
      where id = new.id;
  end if;

  -- Only fire the welcome on a fresh insert (v_inserted_id set). Repeat
  -- triggers from auth providers re-creating the row would otherwise
  -- spam the bell.
  if v_inserted_id is not null then
    perform public.enqueue_notification(
      v_inserted_id,
      'welcome',
      'Bienvenue sur Batta.tn',
      'Pour commencer, vérifiez votre identité et complétez votre profil.',
      '/kyc/start'
    );
  end if;

  return new;
end;
$$;

-- ─── 2. Ending-soon: state column + scheduled function ─────────────────────

alter table public.auctions
  add column if not exists ending_24h_notified_at timestamptz,
  add column if not exists ending_1h_notified_at  timestamptz;

create or replace function public.notify_auctions_ending_soon()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a       record;
  v_title   text;
  v_link    text;
  v_24h     int := 0;
  v_1h      int := 0;
  v_now     timestamptz := now();
begin
  -- ── 24-hour window (between 23h and 24h from now) ───────────────────────
  for v_a in
    select a.id, a.property_id, a.ends_at, a.winner_user_id
      from public.auctions a
     where a.status in ('live', 'extending')
       and a.ending_24h_notified_at is null
       and a.ends_at >  v_now + interval '23 hours'
       and a.ends_at <= v_now + interval '24 hours 10 minutes'
  loop
    select title into v_title from public.properties where id = v_a.property_id;
    v_link := '/auctions/' || v_a.id::text;

    -- Notify watchers.
    perform public.enqueue_notification(
      w.user_id,
      'auction_ending_soon',
      'Enchère bientôt terminée',
      coalesce('« ' || v_title || ' »', 'Une enchère suivie') ||
        ' se termine dans environ 24 heures.',
      v_link
    )
    from public.watchlist w
    where w.auction_id = v_a.id;

    -- Notify the current high bidder if any.
    if v_a.winner_user_id is not null then
      perform public.enqueue_notification(
        v_a.winner_user_id,
        'auction_ending_soon',
        'Votre enchère se termine bientôt',
        'Vous menez ' || coalesce('« ' || v_title || ' »', 'une enchère') ||
          ' — il reste environ 24 heures.',
        v_link
      );
    end if;

    update public.auctions set ending_24h_notified_at = v_now where id = v_a.id;
    v_24h := v_24h + 1;
  end loop;

  -- ── 1-hour window (between 50m and 70m from now) ────────────────────────
  for v_a in
    select a.id, a.property_id, a.ends_at, a.winner_user_id
      from public.auctions a
     where a.status in ('live', 'extending')
       and a.ending_1h_notified_at is null
       and a.ends_at >  v_now + interval '50 minutes'
       and a.ends_at <= v_now + interval '70 minutes'
  loop
    select title into v_title from public.properties where id = v_a.property_id;
    v_link := '/auctions/' || v_a.id::text;

    perform public.enqueue_notification(
      w.user_id,
      'auction_ending_soon',
      'Dernière heure pour enchérir',
      coalesce('« ' || v_title || ' »', 'Une enchère suivie') ||
        ' se termine dans environ 1 heure.',
      v_link
    )
    from public.watchlist w
    where w.auction_id = v_a.id;

    if v_a.winner_user_id is not null then
      perform public.enqueue_notification(
        v_a.winner_user_id,
        'auction_ending_soon',
        'Vous menez — dernière heure',
        'Vous menez ' || coalesce('« ' || v_title || ' »', 'une enchère') ||
          ' — il reste environ 1 heure.',
        v_link
      );
    end if;

    update public.auctions set ending_1h_notified_at = v_now where id = v_a.id;
    v_1h := v_1h + 1;
  end loop;

  return json_build_object('notified_24h', v_24h, 'notified_1h', v_1h, 'at', v_now);
end;
$$;

revoke all on function public.notify_auctions_ending_soon() from public;
grant execute on function public.notify_auctions_ending_soon() to service_role;

-- ─── 3. Listing expired — wrap expire_listing_promotions to notify ─────────

create or replace function public.expire_listing_promotions()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_p     record;
begin
  -- Lock + collect rows we're about to clear so we can notify each owner.
  for v_p in
    select id, owner_id, title
      from public.properties
     where promo_expires_at is not null
       and promo_expires_at <= now()
       and (promo_home_featured or promo_top_listed or promo_banner)
     for update
  loop
    update public.properties
       set promo_home_featured = false,
           promo_top_listed    = false,
           promo_banner        = false,
           promo_expires_at    = null,
           updated_at          = now()
     where id = v_p.id;

    perform public.enqueue_notification(
      v_p.owner_id,
      'listing_expired',
      'Boost expiré',
      'Les options de mise en avant de ' ||
        coalesce('« ' || v_p.title || ' »', 'votre annonce') ||
        ' ont expiré. Vous pouvez les renouveler depuis votre tableau de bord.',
      '/sell'
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.expire_listing_promotions() from public;
grant execute on function public.expire_listing_promotions() to service_role;

-- ─── 4. Schedule notify_auctions_ending_soon via pg_cron ────────────────────

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'batta-ending-soon') then
      perform cron.unschedule('batta-ending-soon');
    end if;
    perform cron.schedule(
      'batta-ending-soon',
      '*/10 * * * *',
      $cron$ select public.notify_auctions_ending_soon(); $cron$
    );
  end if;
exception when others then
  raise notice 'pg_cron schedule skipped: %', sqlerrm;
end;
$$;

notify pgrst, 'reload schema';
