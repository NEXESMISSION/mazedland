-- ============================================================================
-- 0180 · Data the 2026-10-27 usability audit found wrong on the public site
--
-- 1. MZ-00040 showed « Année de construction : 13 ». A year outside
--    1850 … next three years is no year (the bounds src/lib/listings/input.ts
--    enforces since); it is removed, not guessed. Any annonce with such a
--    value is cleaned the same way — MZ-00040 is the only one today.
-- 2. MZ-00057 (description « test test test ») and MZ-00064 (a 33 m² farm
--    at 159 TND) go back to the admin's queue with the reasons the new rules
--    give (thin_text, area_implausible, price_implausible). Nothing is
--    deleted; an admin approves or refuses them in /admin/annonces.
--
-- The rules that let these through are fixed in the code of the same change.
-- Idempotent.
-- ============================================================================

update public.listings
   set attributes = attributes - 'year_built'
 where attributes ? 'year_built'
   and (
     (attributes->>'year_built') !~ '^[0-9]{1,4}$'
     or (attributes->>'year_built')::int < 1850
     or (attributes->>'year_built')::int > extract(year from now())::int + 3
   );

update public.listings
   set status = 'pending_review', review_flags = array['thin_text']::text[]
 where reference = 'MZ-00057' and status = 'published';

update public.listings
   set status = 'pending_review', review_flags = array['area_implausible', 'price_implausible']::text[]
 where reference = 'MZ-00064' and status = 'published';
