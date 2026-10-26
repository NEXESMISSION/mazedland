-- ============================================================================
-- 0170 · Social Publisher: an annonce, shared on Mazed Immo's own pages
--
-- A seller can ask for their annonce to be posted on the Mazed Immo Facebook
-- page and Instagram account, and prepared for Facebook groups that a person
-- on the team shares by hand (Meta has no API for groups any more). Nothing
-- is posted without the seller's consent, recorded with the request, and
-- nothing is posted for an annonce that is not online.
--
-- 1. social_accounts — the pages the site posts to. The access token is
--    sealed by the app (AES-256-GCM, src/lib/social/crypto.ts) before it is
--    stored: the database only ever holds ciphertext.
-- 2. social_publication_requests — one per annonce and ask: the channels, the
--    language, the consent, the price (free at launch), the review.
-- 3. social_content_variants — the text per channel, as generated and as an
--    admin may have corrected it. What is posted is what was approved.
-- 4. social_publication_jobs — the queue: one row per (request, channel,
--    group, action). The unique key is what makes a retry safe — a job that
--    timed out is picked up again, never inserted twice — and the Instagram
--    container id is kept so a retry publishes the same container.
-- 5. social_publication_results — the log: one row per attempt or manual step.
-- 6. social_group_directory — the Facebook groups, with what they accept.
-- 7. social_tracking_events — visits that arrived from a post (UTM link).
--
-- When an annonce stops being online, a trigger cancels what was not posted
-- yet and queues the follow-up of what was: « vendu / loué » on the Facebook
-- post, a manual task where the API cannot do it (Instagram, groups).
--
-- Written by the server only (service role). A seller may read their own
-- requests. Idempotent.
-- ============================================================================

-- ── 1. social_accounts ─────────────────────────────────────────────────────
create table if not exists public.social_accounts (
  id                uuid primary key default gen_random_uuid(),
  platform          text not null check (platform in ('facebook_page', 'instagram', 'tiktok')),
  external_id       text not null,
  name              text not null,
  username          text,
  -- The Instagram professional account publishes with its Facebook page's token.
  parent_account_id uuid references public.social_accounts(id) on delete set null,
  token_sealed      text,
  -- Null when the token does not expire (a page token from a long-lived user token).
  token_expires_at  timestamptz,
  scopes            text[] not null default '{}',
  status            text not null default 'connected'
                      check (status in ('connected', 'expired', 'revoked', 'disconnected')),
  last_error        text,
  last_checked_at   timestamptz,
  connected_by      uuid references public.profiles(id) on delete set null,
  connected_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint social_accounts_once unique (platform, external_id)
);

drop trigger if exists _touch_social_accounts on public.social_accounts;
create trigger _touch_social_accounts before update on public.social_accounts
  for each row execute function public._touch_updated_at();

alter table public.social_accounts enable row level security;
revoke all on table public.social_accounts from anon, authenticated;

-- ── 6. social_group_directory (before the jobs that point at it) ───────────
create table if not exists public.social_group_directory (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 2 and 120),
  url             text not null check (url ~ '^https://(www\.|m\.|web\.)?facebook\.com/groups/[^/?#]+'),
  -- Empty arrays mean « all of Tunisia », « every kind of property ».
  governorates    text[] not null default '{}',
  deal_types      text[] not null default '{sale,rent}'
                    check (deal_types <@ array['sale', 'rent']::text[] and cardinality(deal_types) > 0),
  category_kinds  text[] not null default '{}'
                    check (category_kinds <@ array['residential', 'land', 'commercial']::text[]),
  members         integer check (members is null or members >= 0),
  allows_links    boolean not null default true,
  rules           text check (rules is null or char_length(rules) <= 1000),
  status          text not null default 'active' check (status in ('active', 'paused')),
  last_shared_at  timestamptz,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint social_groups_once unique (url)
);

drop trigger if exists _touch_social_group_directory on public.social_group_directory;
create trigger _touch_social_group_directory before update on public.social_group_directory
  for each row execute function public._touch_updated_at();

alter table public.social_group_directory enable row level security;
revoke all on table public.social_group_directory from anon, authenticated;

-- ── 2. social_publication_requests ─────────────────────────────────────────
create table if not exists public.social_publication_requests (
  id                uuid primary key default gen_random_uuid(),
  listing_id        uuid not null references public.listings(id) on delete cascade,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  channels          text[] not null
                      check (cardinality(channels) > 0
                             and channels <@ array['facebook_page', 'instagram', 'facebook_groups', 'tiktok']::text[]),
  language          text not null default 'both' check (language in ('ar', 'fr', 'both')),
  status            text not null default 'pending_approval'
                      check (status in ('draft', 'pending_approval', 'scheduled', 'published',
                                        'failed', 'rejected', 'cancelled', 'withdrawn')),
  -- What the seller agreed to, and when. Nothing past « draft » without it.
  consent_at        timestamptz,
  consent_version   text,
  price_tnd         numeric(10,2) not null default 0 check (price_tnd >= 0),
  scheduled_for     timestamptz,
  reviewed_by       uuid references public.profiles(id) on delete set null,
  reviewed_at       timestamptz,
  rejection_reason  text check (rejection_reason is null or char_length(rejection_reason) <= 500),
  -- The annonce stopped being online and the posts were followed up.
  closed_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint social_requests_consent check (status = 'draft' or consent_at is not null)
);

-- One live ask per annonce: a second one would post the same house twice.
-- A refused, cancelled or withdrawn one leaves room for a new ask.
create unique index if not exists social_requests_one_open
  on public.social_publication_requests (listing_id)
  where status in ('draft', 'pending_approval', 'scheduled', 'published', 'failed');
-- The reference printed on every post (« Réf. MZ-1A2B3C ») and the short link
-- an Instagram caption can carry (/p/1A2B3C): the first six hex digits of the
-- id. Not unique on purpose — a clash is read as « the most recent one ».
alter table public.social_publication_requests
  add column if not exists ref text
  generated always as (upper(substr(replace(id::text, '-', ''), 1, 6))) stored;
create index if not exists social_requests_ref_idx
  on public.social_publication_requests (ref, created_at desc);
create index if not exists social_requests_status_idx
  on public.social_publication_requests (status, created_at desc);
create index if not exists social_requests_user_idx
  on public.social_publication_requests (user_id, created_at desc);

drop trigger if exists _touch_social_publication_requests on public.social_publication_requests;
create trigger _touch_social_publication_requests before update on public.social_publication_requests
  for each row execute function public._touch_updated_at();

alter table public.social_publication_requests enable row level security;
revoke all on table public.social_publication_requests from anon, authenticated;
grant select on table public.social_publication_requests to authenticated;

drop policy if exists social_requests_own_read on public.social_publication_requests;
create policy social_requests_own_read on public.social_publication_requests
  for select to authenticated using (user_id = auth.uid());

-- ── 3. social_content_variants ─────────────────────────────────────────────
create table if not exists public.social_content_variants (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null references public.social_publication_requests(id) on delete cascade,
  channel         text not null check (channel in ('facebook_page', 'instagram', 'facebook_groups', 'tiktok')),
  -- 2 200 is Instagram's caption limit, the tightest of the three.
  body            text not null check (char_length(body) between 1 and 2200),
  generated_body  text not null,
  link_url        text,
  -- Storage paths of the photos, in the order they are posted.
  photo_paths     text[] not null default '{}',
  edited_by       uuid references public.profiles(id) on delete set null,
  edited_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint social_variants_once unique (request_id, channel)
);

drop trigger if exists _touch_social_content_variants on public.social_content_variants;
create trigger _touch_social_content_variants before update on public.social_content_variants
  for each row execute function public._touch_updated_at();

alter table public.social_content_variants enable row level security;
revoke all on table public.social_content_variants from anon, authenticated;

-- ── 4. social_publication_jobs ─────────────────────────────────────────────
create table if not exists public.social_publication_jobs (
  id                uuid primary key default gen_random_uuid(),
  request_id        uuid not null references public.social_publication_requests(id) on delete cascade,
  channel           text not null check (channel in ('facebook_page', 'instagram', 'facebook_groups', 'tiktok')),
  -- Facebook groups: one job per group, shared by hand.
  group_id          uuid references public.social_group_directory(id) on delete set null,
  -- publish: the post. mark_closed: say « vendu / loué » on it. remove: take it down.
  action            text not null default 'publish' check (action in ('publish', 'mark_closed', 'remove')),
  account_id        uuid references public.social_accounts(id) on delete set null,
  status            text not null default 'scheduled'
                      check (status in ('scheduled', 'running', 'published', 'done', 'failed',
                                        'manual_action_required', 'cancelled')),
  manual_reason     text check (manual_reason is null or manual_reason in (
                      'no_account', 'account_expired', 'groups_manual', 'not_supported',
                      'limit_reached', 'media_rejected')),
  run_after         timestamptz not null default now(),
  attempts          smallint not null default 0,
  max_attempts      smallint not null default 5,
  locked_at         timestamptz,
  -- Instagram: the media container, made once and reused by every retry.
  container_id      text,
  external_post_id  text,
  external_url      text,
  published_at      timestamptz,
  last_error        text,
  done_by           uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint social_jobs_once unique nulls not distinct (request_id, channel, group_id, action)
);

create index if not exists social_jobs_due_idx
  on public.social_publication_jobs (run_after)
  where status in ('scheduled', 'running');
create index if not exists social_jobs_status_idx
  on public.social_publication_jobs (status, updated_at desc);
create index if not exists social_jobs_request_idx
  on public.social_publication_jobs (request_id);

drop trigger if exists _touch_social_publication_jobs on public.social_publication_jobs;
create trigger _touch_social_publication_jobs before update on public.social_publication_jobs
  for each row execute function public._touch_updated_at();

alter table public.social_publication_jobs enable row level security;
revoke all on table public.social_publication_jobs from anon, authenticated;

-- ── 5. social_publication_results ──────────────────────────────────────────
create table if not exists public.social_publication_results (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.social_publication_jobs(id) on delete cascade,
  attempt           smallint not null default 0,
  -- adopted: after an attempt whose outcome was unknown, the post was found
  -- already online and taken as the result instead of being posted again.
  outcome           text not null check (outcome in ('published', 'done', 'adopted', 'retry', 'failed', 'manual')),
  external_post_id  text,
  external_url      text,
  error_code        text,
  error_message     text check (error_message is null or char_length(error_message) <= 2000),
  detail            jsonb not null default '{}',
  -- Null when the engine did it; the admin otherwise.
  actor             uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists social_results_job_idx
  on public.social_publication_results (job_id, created_at desc);

alter table public.social_publication_results enable row level security;
revoke all on table public.social_publication_results from anon, authenticated;

-- ── 7. social_tracking_events ──────────────────────────────────────────────
create table if not exists public.social_tracking_events (
  id            bigint generated always as identity primary key,
  request_id    uuid references public.social_publication_requests(id) on delete cascade,
  listing_id    uuid not null references public.listings(id) on delete cascade,
  channel       text not null check (channel in ('facebook_page', 'instagram', 'facebook_groups', 'tiktok', 'other')),
  event         text not null check (event in ('visit', 'contact')),
  -- A hash of the visitor's session, so one person reloading counts once.
  session_hash  text,
  created_at    timestamptz not null default now(),
  constraint social_events_once unique (request_id, channel, event, session_hash)
);

create index if not exists social_events_request_idx
  on public.social_tracking_events (request_id, event);
create index if not exists social_events_listing_idx
  on public.social_tracking_events (listing_id, created_at desc);

alter table public.social_tracking_events enable row level security;
revoke all on table public.social_tracking_events from anon, authenticated;

-- ── The queue: take due jobs without two runs taking the same one ──────────
-- A job left « running » for ten minutes belongs to a run that died; it is
-- taken again, and the engine looks for the post before posting a second time.
create or replace function public.claim_social_jobs(p_limit integer default 5)
returns setof public.social_publication_jobs
language sql
security definer
set search_path = public
as $function$
  update public.social_publication_jobs j
     set status = 'running', locked_at = now(), attempts = j.attempts + 1
   where j.id in (
     select id from public.social_publication_jobs
      where (status = 'scheduled' and run_after <= now())
         or (status = 'running' and locked_at < now() - interval '10 minutes')
      order by run_after
      limit greatest(1, least(p_limit, 20))
      for update skip locked
   )
  returning j.*;
$function$;

revoke execute on function public.claim_social_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_social_jobs(integer) to service_role;

-- ── When the annonce stops being online ────────────────────────────────────
create or replace function public._social_follow_listing_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_action text;
begin
  if new.status = old.status or old.status <> 'published' then
    return new;
  end if;
  -- Sold or let: say so. Taken down or refused: remove. Anything else (it
  -- expired, it went back to review after an edit) may come back online, so
  -- the posts stay and only what was not posted yet is cancelled.
  v_action := case
    when new.status in ('sold', 'rented') then 'mark_closed'
    when new.status in ('archived', 'rejected') then 'remove'
  end;

  -- Not posted yet: nothing to follow up, the ask simply ends.
  update public.social_publication_jobs j
     set status = 'cancelled', last_error = 'listing_' || new.status
    from public.social_publication_requests r
   where j.request_id = r.id and r.listing_id = new.id
     and j.status in ('scheduled', 'manual_action_required') and j.action = 'publish';
  update public.social_publication_requests
     set status = 'cancelled', closed_at = now()
   where listing_id = new.id and status in ('draft', 'pending_approval', 'scheduled');

  if v_action is null then
    return new;
  end if;

  -- Posted: say so on the post, or take it down. The Facebook page does it
  -- through the API; Instagram and the groups are a task for a person.
  insert into public.social_publication_jobs (request_id, channel, group_id, action, account_id, status, manual_reason)
  select j.request_id, j.channel, j.group_id, v_action, j.account_id,
         case when j.channel = 'facebook_page' and j.account_id is not null then 'scheduled' else 'manual_action_required' end,
         case when j.channel = 'facebook_page' and j.account_id is not null then null
              when j.channel = 'facebook_groups' then 'groups_manual'
              else 'not_supported' end
    from public.social_publication_jobs j
    join public.social_publication_requests r on r.id = j.request_id
   where r.listing_id = new.id and j.action = 'publish' and j.status = 'published'
  on conflict on constraint social_jobs_once do nothing;

  update public.social_publication_requests
     set closed_at = now()
   where listing_id = new.id and status = 'published' and closed_at is null;
  return new;
end;
$function$;

revoke execute on function public._social_follow_listing_status() from public, anon, authenticated;

drop trigger if exists _social_follow_listing_status on public.listings;
create trigger _social_follow_listing_status after update of status on public.listings
  for each row execute function public._social_follow_listing_status();

-- ── Settings ───────────────────────────────────────────────────────────────
insert into public.app_settings (key, value, description)
values
  ('social_enabled', 'true'::jsonb, 'Promotion des annonces sur les réseaux de Mazed Immo : interrupteur général.'),
  ('social_price_tnd', '0'::jsonb, 'Prix d''une promotion sur les réseaux, en dinars. 0 = gratuit (lancement).'),
  ('social_auto_approve', 'false'::jsonb, 'Publier sans validation d''un admin les demandes d''annonces déjà en ligne.'),
  ('social_daily_limit', '10'::jsonb, 'Nombre maximum de publications par jour sur chaque compte (page Facebook, Instagram).')
on conflict (key) do nothing;

-- ── The worker, every five minutes ─────────────────────────────────────────
-- Same shape as the notification drains: pg_cron calls the route with the
-- shared secret — from the vault when it is there (0158), otherwise the key
-- the e-mail drain already carries, copied inside the database. Without
-- either, nothing is scheduled; approving a request still posts it at once.
do $$
declare
  v_key text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '0170: pg_cron missing — social_publish_http not scheduled.';
    return;
  end if;
  perform cron.unschedule('social_publish_http')
    where exists (select 1 from cron.job where jobname = 'social_publish_http');

  if exists (select 1 from vault.decrypted_secrets where name = 'cron_secret') then
    perform cron.schedule('social_publish_http', '*/5 * * * *',
      $cmd$select net.http_get(
        url := 'https://mazedland.vercel.app/api/cron/social-publish',
        headers := jsonb_build_object(
          'Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        timeout_milliseconds := 60000
      )$cmd$);
    return;
  end if;

  select substring(command from '[?&]key=([^''&]+)') into v_key
    from cron.job where jobname = 'notify_email_http';
  if v_key is null then
    raise notice '0170: no cron secret found — social_publish_http not scheduled.';
    return;
  end if;
  perform cron.schedule('social_publish_http', '*/5 * * * *',
    format('select net.http_get(url:=%L, timeout_milliseconds:=60000)',
           'https://mazedland.vercel.app/api/cron/social-publish?key=' || v_key));
end $$;

notify pgrst, 'reload schema';
