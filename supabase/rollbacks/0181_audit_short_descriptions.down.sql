-- Rollback of 0181 · MZ-00040 and MZ-00039 back online with no flags, as they
-- were on 2026-10-27. Take `node scripts/backup-db.mjs` first.
update public.listings
   set status = 'published', review_flags = array[]::text[]
 where reference in ('MZ-00040', 'MZ-00039') and status = 'pending_review';
