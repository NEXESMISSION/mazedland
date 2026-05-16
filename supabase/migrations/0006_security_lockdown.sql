-- ============================================================================
-- Batta.tn — security lockdown (audit fixes C1, C2, C3, C5, H6, H7)
--
-- Fixes a constellation of privilege-escalation and race-condition bugs:
--
--   C1  signup trigger blindly copied client-supplied role into
--       profiles AND mirrored 'admin' into auth.users.raw_app_meta_data.
--       Anyone could sign up as admin.
--
--   C2  profiles_self_update had no column restriction, so users could
--       set their own role='admin', kyc_status='verified', etc., and
--       sail past every admin-route gate.
--
--   C3  property documents lived in the PUBLIC `properties` bucket;
--       the row-level KYC+deposit gate on property_documents was
--       irrelevant once the storage URL leaked.
--
--   C5  bids_insert_self only checked auth.uid()=bidder_id, so the
--       browser SDK could insert bids on closed auctions, below
--       opening, on auctions where the bidder is the owner, etc.
--       Every business rule lived in the API route only.
--
--   H6  the bid route wrote `current_price` on sealed-bid auctions,
--       leaking the live high-water mark via the public-readable
--       auctions row.
--
--   H7  proxy-bid resolution + auction-state update had no row lock,
--       so two concurrent bidders both saw themselves winning.
-- ============================================================================

-- ─── C1: pin role to 'individual' at signup ─────────────────────────────────
-- The trigger now ignores any client-supplied role or admin claim. Role
-- elevation goes through admin-only flows (inspector approval, partner
-- onboarding) which run with service-role privileges.

create or replace function public._on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role, language)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', null),
    coalesce(new.raw_user_meta_data ->> 'phone', null),
    -- HARDCODED: never trust client metadata for role.
    'individual'::user_role,
    coalesce(new.raw_user_meta_data ->> 'language', 'ar')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ─── C2: forbid users from mutating sensitive columns on their own row ──────
-- RLS-level column restrictions don't compose cleanly with row policies,
-- so we enforce via a BEFORE UPDATE trigger. The trigger is admin-aware
-- (is_admin() check) so the admin routes can still update KYC verdicts
-- and role changes through the same SQL path.

create or replace function public._guard_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then return new; end if;

  if new.id is distinct from old.id
     or new.role is distinct from old.role
     or new.kyc_status is distinct from old.kyc_status
     or new.kyc_submitted_at is distinct from old.kyc_submitted_at
     or new.kyc_verified_at is distinct from old.kyc_verified_at
     or new.trust_score is distinct from old.trust_score then
    raise exception 'forbidden: cannot change protected column without admin';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_self_update on public.profiles;
create trigger guard_profile_self_update
  before update on public.profiles
  for each row execute function public._guard_profile_self_update();

-- ─── KYC submission mirrors kyc_status into the profile automatically ───────
-- Without this, the client can't set kyc_status='submitted' anymore (the
-- guard above would block it), and the admin route is the only writer.
-- Trigger uses SECURITY DEFINER so it can bypass the guard.

create or replace function public._mirror_kyc_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set kyc_status = 'submitted',
         kyc_submitted_at = coalesce(kyc_submitted_at, now())
   where id = new.user_id
     and kyc_status not in ('verified');
  return new;
end;
$$;

drop trigger if exists mirror_kyc_submission on public.kyc_submissions;
create trigger mirror_kyc_submission
  after insert on public.kyc_submissions
  for each row execute function public._mirror_kyc_submission();

-- ─── C3: private bucket for property documents ──────────────────────────────
-- Photos stay in the public `properties` bucket; everything sensitive
-- (titre foncier, permis de bâtir, quitus fiscal) moves here. Read is
-- gated to property owner, admin, or any KYC-verified bidder who holds
-- an active deposit on a published auction for that property.

insert into storage.buckets (id, name, public)
values ('property-documents', 'property-documents', false)
on conflict (id) do nothing;

drop policy if exists "property_docs_read" on storage.objects;
create policy "property_docs_read"
on storage.objects for select
using (
  bucket_id = 'property-documents'
  and (
    public.is_admin()
    -- Owner of the document (folder[1] is the uploader's uuid).
    or (storage.foldername(name))[1] = auth.uid()::text
    -- KYC-verified bidder with an active deposit on this property's
    -- auction. Path encodes property_id at folder[2]; we cross-check
    -- with auctions+auction_deposits.
    or exists (
      select 1
      from public.auctions a
      join public.auction_deposits d on d.auction_id = a.id
      join public.profiles pr on pr.id = auth.uid()
      where a.property_id::text = (storage.foldername(name))[2]
        and d.user_id = auth.uid()
        and d.released_at is null
        and d.forfeited_at is null
        and pr.kyc_status = 'verified'
    )
  )
);

drop policy if exists "property_docs_owner_insert" on storage.objects;
create policy "property_docs_owner_insert"
on storage.objects for insert
with check (
  bucket_id = 'property-documents'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "property_docs_owner_update" on storage.objects;
create policy "property_docs_owner_update"
on storage.objects for update
using (
  bucket_id = 'property-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "property_docs_owner_delete" on storage.objects;
create policy "property_docs_owner_delete"
on storage.objects for delete
using (
  bucket_id = 'property-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ─── C5 + H7: place_bid RPC, race-safe, all rules in one place ──────────────
-- Direct INSERT on `bids` is revoked (policy dropped below). The RPC
-- holds the auction row with FOR UPDATE so two concurrent bidders
-- serialize, validates every rule the API route used to enforce, and
-- updates auctions.current_price + ends_at atomically.

create or replace function public.bid_increment(current_bid numeric)
returns numeric
language sql
immutable
as $$
  select case
    when current_bid < 100000 then 1000
    when current_bid < 500000 then 5000
    when current_bid < 1000000 then 10000
    else 25000 end;
$$;

create or replace function public.dutch_current_price(a public.auctions)
returns numeric
language sql
stable
as $$
  select greatest(
    coalesce(a.dutch_floor_price, a.opening_price),
    coalesce(a.dutch_start_price, a.opening_price)
      - floor(
          greatest(0, extract(epoch from (now() - a.starts_at)))
          / nullif(coalesce(a.dutch_tick_seconds, 60), 0)
        ) * coalesce(a.dutch_decrement, 0)
  );
$$;

create or replace function public.place_bid(
  p_auction_id uuid,
  p_amount     numeric,
  p_max_amount numeric default null,
  p_ip         inet    default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_auction  public.auctions%rowtype;
  v_min_next numeric;
  v_dutch    numeric;
  v_bid_id   uuid;
  v_now      timestamptz := now();
  v_kyc      kyc_status;
  v_extend   boolean := false;
begin
  if v_user is null then
    raise exception 'auth' using errcode = '28000';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  -- Lock the auction row to serialize concurrent bidders.
  select * into v_auction
    from public.auctions
   where id = p_auction_id
   for update;
  if not found then
    raise exception 'auction_not_found' using errcode = 'P0002';
  end if;

  if v_auction.status not in ('live', 'extending') then
    raise exception 'auction_closed' using errcode = 'P0001';
  end if;
  if v_auction.ends_at <= v_now then
    raise exception 'auction_expired' using errcode = 'P0001';
  end if;

  -- KYC gate.
  select kyc_status into v_kyc from public.profiles where id = v_user;
  if v_kyc is distinct from 'verified' then
    raise exception 'kyc_required' using errcode = 'P0001';
  end if;

  -- Deposit lock gate — must have an active (unreleased, unforfeited) deposit.
  if not exists (
    select 1 from public.auction_deposits
     where auction_id = p_auction_id and user_id = v_user
       and released_at is null and forfeited_at is null
  ) then
    raise exception 'deposit_required' using errcode = 'P0001';
  end if;

  -- Owner cannot bid on their own auction (anti-shill day-1 gate).
  if exists (
    select 1 from public.properties p
     where p.id = v_auction.property_id and p.owner_id = v_user
  ) then
    raise exception 'self_bid_forbidden' using errcode = 'P0001';
  end if;

  -- Type-specific amount validation.
  if v_auction.type = 'english' then
    if v_auction.current_price is null then
      if p_amount < v_auction.opening_price then
        raise exception 'below_opening' using errcode = 'P0001';
      end if;
    else
      v_min_next := v_auction.current_price
                  + public.bid_increment(v_auction.current_price);
      if p_amount < v_min_next then
        raise exception 'below_min_increment' using errcode = 'P0001';
      end if;
    end if;
  elsif v_auction.type = 'dutch' then
    v_dutch := public.dutch_current_price(v_auction);
    if abs(p_amount - v_dutch) > 0.5 then
      raise exception 'dutch_price_drifted' using errcode = 'P0001';
    end if;
  elsif v_auction.type = 'sealed' then
    if p_amount < v_auction.opening_price then
      raise exception 'below_opening' using errcode = 'P0001';
    end if;
  end if;

  -- Insert the bid (no RLS check — we're SECURITY DEFINER).
  insert into public.bids (auction_id, bidder_id, amount, max_amount, is_proxy, ip_address)
  values (
    p_auction_id, v_user, p_amount, p_max_amount,
    p_max_amount is not null and p_max_amount > p_amount,
    p_ip
  )
  returning id into v_bid_id;

  -- Post-bid auction state update.
  if v_auction.type = 'english' then
    -- Anti-sniping: extend ends_at if the bid landed inside the trigger window.
    v_extend := (v_auction.ends_at - v_now)
              <= make_interval(secs => v_auction.extend_window_seconds);
    update public.auctions
       set current_price = p_amount,
           ends_at = case when v_extend
             then ends_at + make_interval(secs => extend_by_seconds)
             else ends_at end,
           status = case when v_extend
             then 'extending'::auction_status
             else status end
     where id = p_auction_id;
  elsif v_auction.type = 'dutch' then
    -- Dutch: first acceptance hammers the auction.
    update public.auctions
       set current_price  = p_amount,
           status         = 'ended_sold',
           winner_user_id = v_user,
           winner_amount  = p_amount,
           hammer_at      = v_now
     where id = p_auction_id;
  end if;
  -- sealed: deliberately DO NOT touch current_price — the live high-water
  -- mark must stay private until the close job awards the winner.

  return json_build_object(
    'ok', true,
    'bid_id', v_bid_id,
    'current_price', case when v_auction.type = 'sealed' then null else p_amount end,
    'extended', v_extend
  );
end;
$$;

grant execute on function public.place_bid(uuid, numeric, numeric, inet) to authenticated;
grant execute on function public.bid_increment(numeric) to authenticated, anon;
grant execute on function public.dutch_current_price(public.auctions) to authenticated, anon;

-- ─── Revoke direct INSERT on bids; force everything through place_bid ───────
-- Reads stay open per the existing bids_read policy (English/Dutch public,
-- sealed gated). Anti-sniping on sealed bids still doesn't apply by design.

drop policy if exists bids_insert_self on public.bids;

-- ─── 6th-offer admission (H3 partial): require min = winning * 7/6 ──────────
-- The 8-day window state transitions live in a future migration; this is
-- the minimum-amount enforcement on sixth_offers inserts so anything that
-- does land in the table is at least legally admissible.

drop policy if exists sixth_offers_insert_self on public.sixth_offers;
create policy sixth_offers_insert_self on public.sixth_offers for insert
with check (
  auth.uid() = bidder_id
  and exists (
    select 1 from public.auctions a
     where a.id = auction_id
       and a.status = 'sixth_offer_window'
       and a.sixth_offer_deadline > now()
       and a.winner_amount is not null
       and amount >= ceil(a.winner_amount * 7.0 / 6.0)
  )
);

-- ─── PostgREST cache refresh ────────────────────────────────────────────────
notify pgrst, 'reload schema';
