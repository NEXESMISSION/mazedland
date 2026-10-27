-- Rollback of 0177 · advertising spaces. Deletes every ad and its daily
-- figures (the images stay in storage under ads/). Take
-- `node scripts/backup-db.mjs` first.
drop function if exists public.record_ad_event(uuid, text);
drop trigger if exists _touch_ads on public.ads;
drop function if exists public._touch_ads();
drop table if exists public.ad_daily;
drop table if exists public.ads;
notify pgrst, 'reload schema';
