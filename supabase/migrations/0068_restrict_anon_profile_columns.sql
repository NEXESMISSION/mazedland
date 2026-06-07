-- ============================================================================
-- SECURITY (High) — stop the anonymous bulk PII scrape of seller profiles.
--
-- `profiles_public_read_actors` (0005) is a ROW-level SELECT policy letting
-- anon read any profile that is an agency/bank/bailiff, an approved
-- inspector, or owns a `ready` listing — so the inspector grid and partner
-- directory render. But RLS is not column-level: the migration comment
-- ASSUMED sensitive columns were "individually unselected" by the app, yet a
-- direct PostgREST query (profiles?select=phone,kyc_status,trust_score) over
-- the same allowed rows scrapes every active seller's phone number and KYC
-- state. GDPR-grade exposure.
--
-- Fix (anon vector — the literal finding): keep the row policy so the public
-- pages still resolve, but column-restrict the `anon` role to the only
-- fields any public/anon consumer actually reads. Verified consumers
-- (inspectors page, inspectors/book, embedded bidder/owner names) select
-- only full_name / role — never phone/kyc_status/trust_score/governorate.
--
-- anon is never "self", so this cannot break a logged-in user's read of
-- their own row (that goes through the `authenticated` role, untouched).
--
-- NOTE (tracked follow-up): a logged-in account holder can still read other
-- actors' sensitive columns via the same row policy. Fully closing that
-- requires moving the public actor read behind a SECURITY DEFINER view that
-- exposes only {id, full_name, role} and repointing the embedded joins — a
-- larger refactor handled separately. This migration closes the
-- unauthenticated scrape, which is the headline exposure.
-- ============================================================================

revoke select on public.profiles from anon;
grant select (id, full_name, role) on public.profiles to anon;

notify pgrst, 'reload schema';
