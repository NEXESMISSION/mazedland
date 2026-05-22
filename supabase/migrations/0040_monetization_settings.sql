-- ============================================================================
-- Batta.tn — Parametrable monetization.
--
-- The owner can tune, entirely from /admin/settings:
--   • posting fee per listing type (free / fixed TND / — for direct — percent
--     of the sale price)
--   • promo add-ons (price, or disable)
--   • the bid deposit (free / fixed / percent of opening price) + a global
--     "free until <date>" window
--
-- Stored as structured jsonb in app_settings so there's no schema churn when
-- the pricing model changes. Seeded from today's flat values so behaviour is
-- identical until the owner edits anything. Old flat keys are left in place
-- (harmless) — the app reads the new keys via src/lib/pricing.ts.
-- ============================================================================

insert into public.app_settings (key, value, description) values
  ('fee_listing_auction',
     '{"mode":"fixed","value":20}'::jsonb,
     'Frais de publication — enchère. mode: free | fixed (TND).'),
  ('fee_listing_direct',
     '{"mode":"fixed","value":15}'::jsonb,
     'Frais de publication — offre directe. mode: free | fixed (TND) | percent (% du prix de vente).'),
  ('promo_home',
     '{"enabled":true,"value":15}'::jsonb,
     'Option : mise en avant accueil (TND). enabled=false pour la masquer.'),
  ('promo_top',
     '{"enabled":true,"value":10}'::jsonb,
     'Option : top de la recherche (TND).'),
  ('promo_banner',
     '{"enabled":true,"value":30}'::jsonb,
     'Option : bannière d''accueil (TND).'),
  ('deposit',
     '{"mode":"percent","value":10,"free_until":null}'::jsonb,
     'Caution pour enchérir. mode: free | fixed (TND) | percent (% du prix d''ouverture). free_until: date ISO de gratuité temporaire.')
on conflict (key) do nothing;

-- Allow a zero-amount deposit row so "free entry" can register a participant
-- without a payment (place_bid only checks that a deposit row exists).
alter table public.auction_deposits
  drop constraint if exists auction_deposits_amount_check;
alter table public.auction_deposits
  add constraint auction_deposits_amount_check check (amount >= 0);

notify pgrst, 'reload schema';
