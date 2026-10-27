-- Rollback of 0183 · the agence report function goes; nothing else used it.
-- Take `node scripts/backup-db.mjs` first.
drop function if exists public.shop_report(uuid, timestamptz, uuid);
notify pgrst, 'reload schema';
