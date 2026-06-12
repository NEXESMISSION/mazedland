-- ============================================================================
-- PERF (scalability) — indexes for hot read paths found in the 2026-06 audit.
--
-- All are pure additive `create index if not exists` — no data change, safe to
-- re-run, and Postgres picks them only when they help. Three groups:
--
--   1. properties.attributes (jsonb) — the explore feed filters on car specs
--      stored in attributes (fuel/condition exact, year/mileage numeric range).
--      Without these every filtered explore cache-miss is a full table scan.
--      A GIN index covers arbitrary containment; the expression indexes serve
--      the exact ->> and numeric -> comparisons the route actually issues.
--      (On the land twin these columns are simply absent from attributes, so
--      the expression indexes index NULLs — harmless, near-zero size.)
--
--   2. payments (user_id, auction_id, kind, status) — the auction detail page
--      checks "does this viewer have a pending_review deposit on this lot?" on
--      every authenticated render. The single-column indexes forced an index
--      intersection; this composite serves it in one seek.
--
--   3. payments (auction_id, kind) — the seller fork of the same page looks up
--      the lot's final payment by (auction_id, kind).
-- ============================================================================

-- 1) Explore jsonb filters --------------------------------------------------
create index if not exists idx_properties_attributes_gin
  on public.properties using gin (attributes);

create index if not exists idx_properties_attr_fuel
  on public.properties ((attributes->>'fuel'));

create index if not exists idx_properties_attr_condition
  on public.properties ((attributes->>'condition'));

-- Numeric range filters. The explore route compares the SINGLE-ARROW jsonb
-- expression (attributes->'year') with gte/lte — jsonb numbers compare
-- numerically — so the index must be on that exact jsonb expression, not a
-- cast. jsonb has a default btree operator class, so this is a valid btree
-- index that the planner can use for the range scans.
create index if not exists idx_properties_attr_year
  on public.properties ((attributes->'year'));

create index if not exists idx_properties_attr_mileage
  on public.properties ((attributes->'mileage'));

-- 2) Per-viewer deposit gate on the auction detail page ---------------------
create index if not exists idx_payments_user_auction_kind_status
  on public.payments (user_id, auction_id, kind, status);

-- 3) Seller final-payment lookup --------------------------------------------
create index if not exists idx_payments_auction_kind
  on public.payments (auction_id, kind);

notify pgrst, 'reload schema';
