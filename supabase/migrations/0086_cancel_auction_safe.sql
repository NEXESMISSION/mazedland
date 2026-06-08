-- ============================================================================
-- CONCURRENCY (Med) — race-safe seller cancel + release deposits on cancel.
--
-- The cancel route was a 3-step check-then-write with no lock: read status,
-- read bid count, then an UNCONDITIONAL `update auctions set status='cancelled'`.
-- place_bid takes FOR UPDATE on the auction and only re-checks status, so a bid
-- could commit AFTER the count read but BEFORE the cancel flip — stranding a
-- real, deposit-backed bid on a 'cancelled' lot (and release_deposits_on_close
-- didn't fire for 'cancelled', so the caution stayed locked).
--
-- Fix:
--   1. cancel_auction_safe(): SECURITY DEFINER, locks the auction FOR UPDATE,
--      verifies caller is owner/admin, re-counts bids INSIDE the lock, and
--      refuses ('has_bids') if any exist. Serializes against place_bid's lock,
--      so a concurrent bid either loses the race (cancel sees it → has_bids) or
--      wins (place_bid sees status='cancelled' → auction_closed). No strand.
--   2. _release_deposits_on_close() now also fires on 'cancelled' — a lot can
--      have deposits without bids (entering ≠ bidding), and those cautions must
--      be released when it's cancelled.
-- ============================================================================

create or replace function public.cancel_auction_safe(p_auction_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_auction   public.auctions%rowtype;
  v_owner     uuid;
  v_bid_count int;
begin
  if v_uid is null then
    raise exception 'auth' using errcode = '28000';
  end if;

  select * into v_auction from public.auctions where id = p_auction_id for update;
  if not found then
    raise exception 'auction_not_found' using errcode = 'P0002';
  end if;

  select owner_id into v_owner from public.properties where id = v_auction.property_id;
  if v_uid <> coalesce(v_owner, '00000000-0000-0000-0000-000000000000'::uuid)
     and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_auction.status not in ('scheduled', 'live', 'extending') then
    raise exception 'not_cancellable' using errcode = 'P0001';
  end if;

  select count(*) into v_bid_count from public.bids where auction_id = p_auction_id;
  if v_bid_count > 0 then
    raise exception 'has_bids' using errcode = 'P0001';
  end if;

  update public.auctions
     set status = 'cancelled', updated_at = now()
   where id = p_auction_id;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.cancel_auction_safe(uuid) to authenticated, service_role;

-- Release deposits on cancel too (0072 covered only ended_unsold/awarded/ended_sold).
create or replace function public._release_deposits_on_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('ended_unsold', 'awarded', 'ended_sold', 'cancelled')
     and new.status is distinct from old.status then
    update public.auction_deposits
       set released_at = now()
     where auction_id = new.id
       and released_at is null
       and forfeited_at is null
       and (new.winner_user_id is null or user_id <> new.winner_user_id);
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
