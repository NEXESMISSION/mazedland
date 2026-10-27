-- ============================================================================
-- 0183 · Agence reports (cahier P5)
--
-- What a period brought to an agence's annonces, counted where it happened:
--   visitors    people who saw an annonce for the first time (listing_views,
--               first_seen_at; the seller's own views were never recorded)
--   reveals     phone numbers shown (contact_reveals)
--   favourites  annonces saved (watchlist)
--   visits      visit requests (visit_requests)
--   leads       clients added to the pipeline (leads)
-- each as [listing_id, Tunis day, count], so the page adds them up by day, by
-- annonce and by agent without a row limit getting in the way: one jsonb.
--
-- p_seller narrows it to one member's annonces (an agent sees their own).
-- Read by the server only (service role), after it checked the membership.
-- Idempotent.
-- ============================================================================

create or replace function public.shop_report(p_shop uuid, p_since timestamptz, p_seller uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with l as (
    select id from public.listings
     where shop_id = p_shop and (p_seller is null or seller_id = p_seller)
  )
  select jsonb_build_object(
    'visitors', coalesce((
      select jsonb_agg(jsonb_build_array(listing_id, d, n)) from (
        select v.listing_id, (v.first_seen_at at time zone 'Africa/Tunis')::date as d, count(*)::int as n
          from public.listing_views v join l on l.id = v.listing_id
         where v.first_seen_at >= p_since
         group by 1, 2
      ) x), '[]'::jsonb),
    'reveals', coalesce((
      select jsonb_agg(jsonb_build_array(listing_id, d, n)) from (
        select r.listing_id, (r.created_at at time zone 'Africa/Tunis')::date as d, count(*)::int as n
          from public.contact_reveals r join l on l.id = r.listing_id
         where r.created_at >= p_since
         group by 1, 2
      ) x), '[]'::jsonb),
    'favourites', coalesce((
      select jsonb_agg(jsonb_build_array(listing_id, d, n)) from (
        select w.listing_id, (w.created_at at time zone 'Africa/Tunis')::date as d, count(*)::int as n
          from public.watchlist w join l on l.id = w.listing_id
         where w.created_at >= p_since
         group by 1, 2
      ) x), '[]'::jsonb),
    'visits', coalesce((
      select jsonb_agg(jsonb_build_array(listing_id, d, n)) from (
        select vr.listing_id, (vr.created_at at time zone 'Africa/Tunis')::date as d, count(*)::int as n
          from public.visit_requests vr join l on l.id = vr.listing_id
         where vr.created_at >= p_since
         group by 1, 2
      ) x), '[]'::jsonb),
    'leads', coalesce((
      select jsonb_agg(jsonb_build_array(listing_id, d, n)) from (
        select ld.listing_id, (ld.created_at at time zone 'Africa/Tunis')::date as d, count(*)::int as n
          from public.leads ld
         where ld.shop_id = p_shop
           and ld.created_at >= p_since
           and (p_seller is null or ld.created_by = p_seller or ld.listing_id in (select id from l))
         group by 1, 2
      ) x), '[]'::jsonb)
  );
$$;

revoke execute on function public.shop_report(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.shop_report(uuid, timestamptz, uuid) to service_role;

notify pgrst, 'reload schema';
