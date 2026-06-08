-- ============================================================================
-- AUCTION INTEGRITY (HIGH) — validate seller-created auctions server-side.
--
-- Auction creation is a direct client INSERT (ScheduleForm). 0099 locked it to
-- the property owner + a safe initial status, but did NOT validate the rest, so
-- a crafted client could:
--   * auction an UNMODERATED / REJECTED property (property.status <> 'ready');
--   * run MULTIPLE concurrent auctions on one asset;
--   * set UNBOUNDED anti-snipe values (extend_by = years → never-ending lot);
--   * seed current_price = opening_price on an english lot — which makes the
--     OPENING PRICE UN-BIDDABLE: place_bid treats a non-null current_price as a
--     standing bid, so the first bid must exceed opening + increment.
--
-- Two guards:
--  1) _validate_auction_insert (BEFORE INSERT, SECURITY DEFINER) validates
--     SELLER-originated inserts only. Trusted contexts skip it: admins
--     (is_admin()) and the definer-run relist/cron path (auth.uid() IS NULL, no
--     request JWT) — so tick_auctions' auto-relist is never disturbed. For a
--     seller it enforces: property is theirs + 'ready', bounded extend windows,
--     a valid Dutch range, and FORCES english current_price = null so the
--     opening price is biddable.
--  2) a partial unique index = at most ONE active auction per property.
-- ============================================================================

create or replace function public._validate_auction_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner  uuid;
  v_status property_status;
begin
  -- Trusted contexts: admin console + the definer-run relist/cron (no JWT).
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  select owner_id, status into v_owner, v_status
    from public.properties where id = new.property_id;
  if v_owner is null then raise exception 'property_not_found'; end if;
  if v_owner <> auth.uid() then raise exception 'not_property_owner'; end if;
  if v_status <> 'ready' then raise exception 'property_not_ready'; end if;

  -- Bound anti-snipe so a lot can't be made to never end.
  if coalesce(new.extend_window_seconds, 0) < 0 or coalesce(new.extend_window_seconds, 0) > 3600 then
    raise exception 'invalid_extend_window';
  end if;
  if coalesce(new.extend_by_seconds, 0) < 0 or coalesce(new.extend_by_seconds, 0) > 3600 then
    raise exception 'invalid_extend_by';
  end if;

  -- English: never seed current_price — keep the opening price biddable
  -- (place_bid: current_price IS NULL → first valid bid is >= opening_price).
  if new.type = 'english' then
    new.current_price := null;
  end if;

  -- Dutch must have a sane descending range.
  if new.type = 'dutch' then
    if new.dutch_start_price is null
       or new.dutch_floor_price is null
       or new.dutch_start_price <= new.dutch_floor_price then
      raise exception 'invalid_dutch_range';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_auction_insert on public.auctions;
create trigger validate_auction_insert
  before insert on public.auctions
  for each row execute function public._validate_auction_insert();

-- At most ONE active auction per property. tick_auctions sets the old lot to a
-- terminal status BEFORE inserting a relist (same txn), so auto-relist never
-- collides. Warn on any pre-existing violation before enforcing.
do $$
declare v_dupes int;
begin
  select count(*) into v_dupes from (
    select property_id from public.auctions
     where status in ('scheduled','live','extending','sixth_offer_window')
     group by property_id having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise warning '0106: % property(ies) already have >1 active auction — resolve before this index can enforce.', v_dupes;
  end if;
end $$;

create unique index if not exists auctions_one_active_per_property
  on public.auctions (property_id)
  where status in ('scheduled','live','extending','sixth_offer_window');

notify pgrst, 'reload schema';
