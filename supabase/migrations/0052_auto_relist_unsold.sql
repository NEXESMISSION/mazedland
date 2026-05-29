-- ============================================================================
-- Batta.tn — Auto-relist unsold auctions
--
-- When an auction closes as `ended_unsold` (no bids, or top bid below the
-- reserve price, or a Dutch auction that timed out without a buyer), the
-- platform now automatically schedules a fresh auction for the same
-- property. The new listing inherits every pricing parameter from the
-- previous one, opens at a random moment between 1 hour and 2 days from
-- the close time, and runs for the same duration as the original.
--
-- Design notes:
--   * We INSERT a new row rather than reviving the closed row. The
--     historical row stays as a permanent record (bids, hammer_at,
--     winner_*) and analytics queries don't have to special-case revivals.
--   * `relisted_from_id` is a self-FK so the chain is walkable. UIs that
--     want to show "3rd attempt" can count ancestors.
--   * Only `listing_type = 'auction'` rows are relisted. Direct-sale
--     listings have no "ended_unsold" terminal state in the current
--     workflow — they sit until sold or are cancelled by the seller.
--   * The randomness uses `random()` per row so a batch close doesn't
--     re-list everything at the same future moment.
-- ============================================================================

-- ─── 1. Lineage column ─────────────────────────────────────────────────────

alter table public.auctions
  add column if not exists relisted_from_id uuid
    references public.auctions(id) on delete set null;

create index if not exists auctions_relisted_from_idx
  on public.auctions(relisted_from_id);

-- ─── 2. tick_auctions — spawn a relist whenever a close yields ended_unsold ──
-- Same skeleton as 0007_state_machine.sql; only the close-branch is
-- extended. Sixth-offer finalization is unchanged.

create or replace function public.tick_auctions()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now           timestamptz := now();
  v_started       int := 0;
  v_closed        int := 0;
  v_awarded       int := 0;
  v_relisted      int := 0;
  v_a             public.auctions%rowtype;
  v_top_bid       record;
  v_top_sixth     record;
  v_duration      interval;
  v_delay_seconds int;
  v_new_starts    timestamptz;
  v_new_ends      timestamptz;
begin
  -- 1) START
  with started as (
    update public.auctions
       set status = 'live'
     where status = 'scheduled'
       and starts_at <= v_now
       and ends_at   >  v_now
     returning 1
  )
  select count(*) into v_started from started;

  -- 2) CLOSE
  for v_a in
    select * from public.auctions
     where status in ('live', 'extending')
       and ends_at <= v_now
     for update skip locked
  loop
    if v_a.type = 'dutch' then
      update public.auctions
         set status = 'ended_unsold'
       where id = v_a.id;
      v_closed := v_closed + 1;
      -- Relist Dutch timeout too (no buyer accepted).
      if v_a.listing_type = 'auction' then
        v_duration      := v_a.ends_at - v_a.starts_at;
        -- Random delay in [1 hour, 2 days] = [3600s, 172800s].
        v_delay_seconds := 3600 + floor(random() * (172800 - 3600 + 1))::int;
        v_new_starts    := v_now + make_interval(secs => v_delay_seconds);
        v_new_ends      := v_new_starts + v_duration;

        insert into public.auctions (
          property_id, type, opening_price, reserve_price,
          dutch_start_price, dutch_floor_price, dutch_decrement, dutch_tick_seconds,
          starts_at, ends_at,
          extend_window_seconds, extend_by_seconds,
          status,
          listing_type, sale_price, sale_negotiable, buy_now_price,
          relisted_from_id
        ) values (
          v_a.property_id, v_a.type, v_a.opening_price, v_a.reserve_price,
          v_a.dutch_start_price, v_a.dutch_floor_price, v_a.dutch_decrement, v_a.dutch_tick_seconds,
          v_new_starts, v_new_ends,
          v_a.extend_window_seconds, v_a.extend_by_seconds,
          'scheduled'::auction_status,
          v_a.listing_type, v_a.sale_price, v_a.sale_negotiable, v_a.buy_now_price,
          v_a.id
        );
        v_relisted := v_relisted + 1;
      end if;
      continue;
    end if;

    -- English + sealed: find the high bid.
    select bidder_id, amount
      into v_top_bid
      from public.bids
     where auction_id = v_a.id
     order by amount desc, placed_at asc
     limit 1;

    if v_top_bid is null
       or (v_a.reserve_price is not null and v_top_bid.amount < v_a.reserve_price) then
      update public.auctions set status = 'ended_unsold' where id = v_a.id;

      -- Spawn relist for English/sealed unsold.
      if v_a.listing_type = 'auction' then
        v_duration      := v_a.ends_at - v_a.starts_at;
        v_delay_seconds := 3600 + floor(random() * (172800 - 3600 + 1))::int;
        v_new_starts    := v_now + make_interval(secs => v_delay_seconds);
        v_new_ends      := v_new_starts + v_duration;

        insert into public.auctions (
          property_id, type, opening_price, reserve_price,
          dutch_start_price, dutch_floor_price, dutch_decrement, dutch_tick_seconds,
          starts_at, ends_at,
          extend_window_seconds, extend_by_seconds,
          status,
          listing_type, sale_price, sale_negotiable, buy_now_price,
          relisted_from_id
        ) values (
          v_a.property_id, v_a.type, v_a.opening_price, v_a.reserve_price,
          v_a.dutch_start_price, v_a.dutch_floor_price, v_a.dutch_decrement, v_a.dutch_tick_seconds,
          v_new_starts, v_new_ends,
          v_a.extend_window_seconds, v_a.extend_by_seconds,
          'scheduled'::auction_status,
          v_a.listing_type, v_a.sale_price, v_a.sale_negotiable, v_a.buy_now_price,
          v_a.id
        );
        v_relisted := v_relisted + 1;
      end if;
    else
      update public.auctions
         set status               = 'sixth_offer_window',
             current_price        = v_top_bid.amount,
             winner_user_id       = v_top_bid.bidder_id,
             winner_amount        = v_top_bid.amount,
             hammer_at            = v_now,
             sixth_offer_deadline = v_now + interval '8 days'
       where id = v_a.id;
    end if;
    v_closed := v_closed + 1;
  end loop;

  -- 3) SIXTH-OFFER FINALIZE (unchanged from 0007).
  for v_a in
    select * from public.auctions
     where status = 'sixth_offer_window'
       and sixth_offer_deadline is not null
       and sixth_offer_deadline <= v_now
     for update skip locked
  loop
    select bidder_id, amount
      into v_top_sixth
      from public.sixth_offers
     where auction_id = v_a.id
     order by amount desc, placed_at asc
     limit 1;

    if v_top_sixth is null then
      update public.auctions set status = 'awarded' where id = v_a.id;
    else
      update public.auctions
         set status         = 'awarded',
             winner_user_id = v_top_sixth.bidder_id,
             winner_amount  = v_top_sixth.amount,
             current_price  = v_top_sixth.amount
       where id = v_a.id;
    end if;
    v_awarded := v_awarded + 1;
  end loop;

  return json_build_object(
    'started',  v_started,
    'closed',   v_closed,
    'awarded',  v_awarded,
    'relisted', v_relisted,
    'at',       v_now
  );
end;
$$;

revoke all on function public.tick_auctions() from public;
grant execute on function public.tick_auctions() to service_role;

notify pgrst, 'reload schema';
