-- ============================================================================
-- INFRA (CI parity) — guarantee the service-role has full table access.
--
-- Hosted Supabase grants `service_role` ALL on public tables via its bootstrap
-- default-privileges, so admin/service-role server code (manual-payment, KYC
-- review, the RPC integration fixtures) works there. A clean `supabase start`
-- for CI applies our migrations against postgres-owned tables WITHOUT that
-- hosted bootstrap, so service_role hit "permission denied for table profiles /
-- properties" and every RPC integration test failed at fixture setup.
--
-- Make the grant EXPLICIT so a fresh stack matches hosted. Harmless + correct:
-- service_role is the server-only key that already bypasses RLS and is meant to
-- have full data access; it is never exposed to the browser. Idempotent.
-- ============================================================================

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Cover tables/sequences created by future migrations too.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

notify pgrst, 'reload schema';
