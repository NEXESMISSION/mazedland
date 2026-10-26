-- Rollback of 0170 (Social Publisher). Removes the queue worker, the
-- listing-status follow-up, the seven social tables and their settings.
-- Everything in them is lost: requests, posts' ids and links, the groups
-- directory, the sealed page tokens, the tracking events. Export first
-- (node scripts/backup-db.mjs).
select cron.unschedule('social_publish_http')
 where exists (select 1 from cron.job where jobname = 'social_publish_http');

drop trigger if exists _social_follow_listing_status on public.listings;
drop function if exists public._social_follow_listing_status();
drop function if exists public.claim_social_jobs(integer);

drop table if exists
  public.social_tracking_events,
  public.social_publication_results,
  public.social_publication_jobs,
  public.social_content_variants,
  public.social_publication_requests,
  public.social_group_directory,
  public.social_accounts;

delete from public.app_settings
 where key in ('social_enabled', 'social_price_tnd', 'social_auto_approve', 'social_daily_limit');
