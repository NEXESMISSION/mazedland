-- ============================================================================
-- Batta.tn — Seller picks "offre directe" or "enchère" on the sell form.
--
-- Before this migration, `listing_type` lived only on auctions and the
-- sell form never exposed it — sellers always ended up scheduling an
-- auction afterward. We now capture the seller's intent on the property
-- itself, charge a (possibly different) listing fee, and on payment
-- capture we auto-launch a direct-sale listing or leave the property in
-- 'ready' so the seller can schedule the auction normally.
--
-- Changes:
--   1. properties.listing_type ('auction' | 'direct'), default 'auction'
--      + properties.sale_price (required if direct)
--      + properties.sale_negotiable (boolean)
--   2. app_settings.listing_fee_offer_tnd — admin-tunable offer fee.
--      Surfaced through the same public-read policy.
--   3. accept_listing_payment(): when property.listing_type='direct',
--      create the matching auctions row so the listing goes live
--      immediately (no schedule step needed for offers).
-- ============================================================================

-- ─── 1. properties columns ─────────────────────────────────────────────────

alter table public.properties
  add column if not exists listing_type text not null default 'auction';

do $$ begin
  alter table public.properties
    add constraint properties_listing_type_values
    check (listing_type in ('auction', 'direct'));
exception when duplicate_object then null; end $$;

alter table public.properties
  add column if not exists sale_price      numeric(14,2),
  add column if not exists sale_negotiable boolean not null default false;

-- Direct listings must carry a price; auction listings must not (price
-- belongs on the auction row).
do $$ begin
  alter table public.properties
    add constraint properties_sale_price_required_for_direct
    check (
      (listing_type = 'direct'  and sale_price is not null and sale_price > 0)
      or
      (listing_type = 'auction' and sale_price is null)
    );
exception when duplicate_object then null; end $$;

create index if not exists properties_listing_type_idx
  on public.properties(listing_type);

-- ─── 2. app_settings — offer-only listing fee ──────────────────────────────

insert into public.app_settings (key, value, description) values
  ('listing_fee_offer_tnd', to_jsonb(15::numeric),
   'Frais de publication pour une offre directe (vente à prix fixe), TND.')
on conflict (key) do nothing;

-- Re-create the public-read policy with the new key. Same shape as 0026
-- but extended with listing_fee_offer_tnd.
drop policy if exists app_settings_public_read on public.app_settings;
create policy app_settings_public_read on public.app_settings
  for select
  using (
    key in (
      'listing_fee_tnd',
      'listing_fee_offer_tnd',
      'promo_home_featured_tnd',
      'promo_top_listed_tnd',
      'promo_banner_tnd'
    )
  );

-- ─── 3. accept_listing_payment — auto-launch direct listings ───────────────

create or replace function public.accept_listing_payment(
  p_payment_id  uuid,
  p_durations   jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_pay      record;
  v_prop     record;
  v_admin_id uuid;
  v_max_days int := 0;
  v_d        int;
  v_expires  timestamptz := null;
  v_promo_home   boolean := false;
  v_promo_top    boolean := false;
  v_promo_banner boolean := false;
  v_existing_auction uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_admin_id := auth.uid();

  select id, user_id, kind, amount, status, property_id, metadata
    into v_pay
  from public.payments
  where id = p_payment_id
  for update;

  if v_pay.id is null then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;
  if v_pay.kind <> 'listing_fee' then
    raise exception 'wrong_kind' using errcode = '22023';
  end if;
  if v_pay.status not in ('pending', 'pending_review') then
    raise exception 'already_resolved' using errcode = '22023';
  end if;
  if v_pay.property_id is null then
    raise exception 'payment_missing_property' using errcode = '22023';
  end if;

  if (p_durations ? 'home_featured') then
    begin v_d := (p_durations->>'home_featured')::int; exception when others then v_d := 0; end;
    if v_d > 0 then v_promo_home := true; v_max_days := greatest(v_max_days, v_d); end if;
  end if;
  if (p_durations ? 'top_listed') then
    begin v_d := (p_durations->>'top_listed')::int; exception when others then v_d := 0; end;
    if v_d > 0 then v_promo_top := true; v_max_days := greatest(v_max_days, v_d); end if;
  end if;
  if (p_durations ? 'banner') then
    begin v_d := (p_durations->>'banner')::int; exception when others then v_d := 0; end;
    if v_d > 0 then v_promo_banner := true; v_max_days := greatest(v_max_days, v_d); end if;
  end if;

  if v_max_days > 0 then
    v_expires := now() + make_interval(days => v_max_days);
  end if;

  update public.payments
     set status      = 'captured',
         reviewer_id = v_admin_id,
         reviewed_at = now(),
         admin_notes = null,
         metadata    = coalesce(metadata, '{}'::jsonb)
                       || jsonb_build_object('accepted_durations', p_durations)
   where id = p_payment_id;

  update public.properties
     set status              = case when status in ('draft','pending_review') then 'ready'::property_status else status end,
         rejection_reason    = null,
         promo_home_featured = promo_home_featured or v_promo_home,
         promo_top_listed    = promo_top_listed    or v_promo_top,
         promo_banner        = promo_banner        or v_promo_banner,
         promo_expires_at    = case
           when v_expires is null then promo_expires_at
           when promo_expires_at is null then v_expires
           else greatest(promo_expires_at, v_expires)
         end,
         updated_at          = now()
   where id = v_pay.property_id
   returning id, owner_id, listing_type, sale_price, sale_negotiable
   into v_prop;

  -- Direct-sale listings go live immediately as an auctions row with
  -- listing_type='direct'. Auctions still need a manual /sell/.../schedule
  -- step from the seller. Only create the row once — re-running accept on
  -- the same property (e.g. promo extension) shouldn't duplicate it.
  if v_prop.listing_type = 'direct' then
    select id into v_existing_auction
      from public.auctions
     where property_id = v_prop.id
       and listing_type = 'direct'
     limit 1;

    if v_existing_auction is null then
      insert into public.auctions (
        property_id, type, listing_type,
        opening_price, sale_price, sale_negotiable,
        starts_at, ends_at, status, current_price
      ) values (
        v_prop.id,
        'english',              -- placeholder; ignored when listing_type='direct'
        'direct',
        v_prop.sale_price,      -- satisfies opening_price > 0
        v_prop.sale_price,
        coalesce(v_prop.sale_negotiable, false),
        now(),
        now() + interval '180 days',
        'live'::auction_status,
        v_prop.sale_price
      );
    end if;
  end if;

  perform public.enqueue_notification(
    v_pay.user_id,
    'listing_published',
    'Annonce publiée',
    'Votre paiement a été validé. Votre annonce est désormais visible sur Batta.tn.',
    '/sell'
  );
end;
$$;

revoke all on function public.accept_listing_payment(uuid, jsonb) from public;
grant execute on function public.accept_listing_payment(uuid, jsonb) to service_role;
grant execute on function public.accept_listing_payment(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
