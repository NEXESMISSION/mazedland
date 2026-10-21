-- ============================================================================
-- 0165 · Free listings for individuals, moderation that runs itself
--
-- The platform should run with as little human work as possible. Until now
-- every annonce cost 15 TND and waited for an admin to read it. From here:
--
--   · A seller publishes for free while they have fewer than
--     `free_listing_limit` annonces live (default 2). Beyond that the existing
--     paths apply: a pack credit, or the per-listing fee.
--   · A submitted annonce is checked by rules (src/lib/moderation/rules.ts).
--     A seller an admin has already approved once, whose annonce passes every
--     rule, is published on the spot. Anything else waits for an admin, and
--     `review_flags` says why — so the admin reads the reason instead of the
--     whole annonce.
--   · Visitors can report an annonce. Reports from three different people take
--     it off the catalogue until an admin looks.
--
-- 1. listings.review_flags — why an annonce is waiting (first_listing,
--    too_few_photos, contact_in_text, banned_words, price_implausible,
--    duplicate, reported). Empty for anything published.
-- 2. listing_reports — one row per reporter per annonce. `reporter_key` is the
--    user id, or a salted hash of the IP for a visitor who is not signed in.
--    Service role only: the API route is the only reader and writer.
-- 3. Two settings an admin can change without a deploy: the free limit, and
--    the words that send an annonce to manual review.
--
-- Additive and idempotent.
-- ============================================================================

alter table public.listings
  add column if not exists review_flags text[] not null default '{}';

create table if not exists public.listing_reports (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.listings(id) on delete cascade,
  reporter_id  uuid references public.profiles(id) on delete set null,
  reporter_key text not null,
  reason       text not null
                 check (reason in ('scam', 'wrong_info', 'sold', 'duplicate', 'inappropriate', 'other')),
  note         text check (note is null or length(note) <= 500),
  created_at   timestamptz not null default now(),
  -- Set when an admin has dealt with the annonce, so a later wave of reports
  -- counts from zero.
  resolved_at  timestamptz,
  unique (listing_id, reporter_key)
);

create index if not exists listing_reports_open
  on public.listing_reports (listing_id)
  where resolved_at is null;

alter table public.listing_reports enable row level security;
-- No policies: nothing but the service role touches it.
revoke all on public.listing_reports from anon, authenticated;
grant all on public.listing_reports to service_role;

insert into public.app_settings (key, value, description) values
  ('free_listing_limit', '2'::jsonb,
   'Annonces gratuites en ligne en même temps, par vendeur.'),
  ('moderation_banned_words', '["casino", "crypto", "bitcoin", "forex", "viagra"]'::jsonb,
   'Mots qui envoient une annonce en vérification manuelle.')
on conflict (key) do nothing;
