-- Rollback of 0168: demandes and their matches. The notifications already
-- sent (kind request_match) stay in the bell. Export first
-- (node scripts/backup-db.mjs).
drop table if exists public.matches, public.property_requests;
