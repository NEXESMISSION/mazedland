-- ============================================================================
-- Batta.tn — Collapse duplicate "active" payments and stop them recurring.
--
-- A find-or-create that used .maybeSingle() threw whenever >1 row matched,
-- so it kept inserting a fresh pending row on every visit to the deposit
-- checkout — producing dozens of identical "Caution … En attente de reçu"
-- rows. The app code now uses limit(1); these partial unique indexes are
-- the belt-and-braces guard so a race can never duplicate again.
-- ============================================================================

-- 1) De-dup auction-tied actives. Keep the best row per (user, auction,
--    kind): prefer one that already has a receipt, then the most recent.
delete from public.payments p
using (
  select id, row_number() over (
    partition by user_id, auction_id, kind
    order by (receipt_url is not null) desc, created_at desc
  ) as rn
  from public.payments
  where status in ('pending', 'pending_review') and auction_id is not null
) d
where p.id = d.id and d.rn > 1;

-- 2) De-dup property-tied actives (listing_fee).
delete from public.payments p
using (
  select id, row_number() over (
    partition by user_id, property_id, kind
    order by (receipt_url is not null) desc, created_at desc
  ) as rn
  from public.payments
  where status in ('pending', 'pending_review') and property_id is not null
) d
where p.id = d.id and d.rn > 1;

-- 3) One active payment per (user, auction, kind) and per (user, property,
--    kind) going forward.
create unique index if not exists payments_one_active_auction
  on public.payments (user_id, auction_id, kind)
  where status in ('pending', 'pending_review') and auction_id is not null;

create unique index if not exists payments_one_active_property
  on public.payments (user_id, property_id, kind)
  where status in ('pending', 'pending_review') and property_id is not null;

notify pgrst, 'reload schema';
