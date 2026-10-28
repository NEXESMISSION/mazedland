-- ============================================================================
-- 0184 · An agence's owner IS the agence (the owner's call, 2026-10-28)
--
-- Since PR #22 an owner publishes as their agence, with no « Moi-même ». The
-- annonces they had published under their own name before go to their agence
-- too, so they show on its page — asked by the owner the same day.
--
-- Every annonce of a person who owns an approved agence, with no agence yet,
-- goes to that agence (their oldest, if they own several — the rule the draft
-- API uses). Nothing else changes: status, dates, places. They already
-- counted in the agence's plan (planUsage counts the owner's own annonces).
--
-- On 2026-10-28 that was 11 annonces: « pro immo » (lassad) MZ-00075, 00248,
-- 00033, 00039, 00040, 00072; « Ahmed » (Ahmed Ben Attia) MZ-00057, 00064,
-- 00068, 00088, 00089. Rollback: supabase/rollbacks/0184_….down.sql.
-- Idempotent: a second run finds none.
-- ============================================================================

with owned as (
  select distinct on (owner_id) owner_id, id
    from public.shops
   where status = 'approved'
   order by owner_id, created_at
)
update public.listings l
   set shop_id = o.id
  from owned o
 where o.owner_id = l.seller_id
   and l.shop_id is null;
