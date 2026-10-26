-- Rollback of 0174 · visit requests and the Pro client pipeline.
-- Deletes every visit request and lead: take `node scripts/backup-db.mjs` first.
drop table if exists public.leads;
drop table if exists public.visit_requests;
