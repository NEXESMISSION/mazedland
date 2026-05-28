-- ============================================================================
-- Batta.tn — Deep-link listing_published / listing_expired notifications.
--
-- accept_listing_payment() (last redefined in 0028) and
-- expire_listing_promotions() (defined in 0031) both notify the seller but
-- bake `/sell` — the generic dashboard — into the link. Both already have
-- the property id in scope, so we point straight at the seller-side detail
-- page (/sell/<id>) instead. The seller lands on the listing the message
-- is about, not a list of "which one was it?".
--
-- CREATE OR REPLACE preserves the trigger/cron bindings; bodies are
-- otherwise identical to their last definitions.
-- ============================================================================

-- ─── accept_listing_payment — listing_published deep-link ──────────────────
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
        v_prop.sale_price,
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
    '/sell/' || v_pay.property_id::text
  );
end;
$$;

revoke all on function public.accept_listing_payment(uuid, jsonb) from public;
grant execute on function public.accept_listing_payment(uuid, jsonb) to service_role;
grant execute on function public.accept_listing_payment(uuid, jsonb) to authenticated;

-- ─── expire_listing_promotions — listing_expired deep-link ─────────────────
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
      '/sell/' || v_p.id::text
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.expire_listing_promotions() from public;
grant execute on function public.expire_listing_promotions() to service_role;

notify pgrst, 'reload schema';
