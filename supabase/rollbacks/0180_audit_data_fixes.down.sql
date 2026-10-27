-- Rollback of 0180 · puts back what the audit fix changed, as it was on
-- 2026-10-27: MZ-00040's year_built 13, and MZ-00057 / MZ-00064 published
-- with no flags. Take `node scripts/backup-db.mjs` first.
update public.listings
   set attributes = attributes || '{"year_built": 13}'::jsonb
 where reference = 'MZ-00040' and not (attributes ? 'year_built');

update public.listings
   set status = 'published', review_flags = array[]::text[]
 where reference in ('MZ-00057', 'MZ-00064') and status = 'pending_review';
