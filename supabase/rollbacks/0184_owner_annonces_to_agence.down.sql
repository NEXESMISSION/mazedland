-- Rollback of 0184 · the 11 annonces moved on 2026-10-28 go back to their
-- owner's name. Take `node scripts/backup-db.mjs` first.
update public.listings
   set shop_id = null
 where reference in (
   'MZ-00075', 'MZ-00248', 'MZ-00033', 'MZ-00039', 'MZ-00040', 'MZ-00072',
   'MZ-00057', 'MZ-00064', 'MZ-00068', 'MZ-00088', 'MZ-00089'
 );
