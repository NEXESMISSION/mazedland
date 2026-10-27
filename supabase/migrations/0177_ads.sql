-- ============================================================================
-- 0177 · Advertising spaces sold to companies
--
-- Banks, notaries, builders, movers… buy a space on the site: an image and a
-- link, shown in one of a few placements, rotating with the other ads of the
-- same placement, between two dates. The admin manages them in
-- /admin/publicites and reads, per ad and per day, how often it was seen and
-- clicked — what the advertiser pays for and asks about.
--
-- Images live in the public `properties` bucket under `ads/`, uploaded by
-- the console through the service role; nothing here is written by the
-- client roles. Public pages read the ads on the server (service role) and
-- count views and clicks through `record_ad_event`. Idempotent.
-- ============================================================================

create table if not exists public.ads (
  id                uuid primary key default gen_random_uuid(),
  advertiser        text not null check (char_length(advertiser) between 1 and 120),
  -- What the image says, for screen readers and as a caption: fr, and ar.
  title             text check (title is null or char_length(title) <= 160),
  title_ar          text check (title_ar is null or char_length(title_ar) <= 160),
  image_path        text not null check (char_length(image_path) <= 300),
  -- A tall version for phones; the wide one is used when there is none.
  image_mobile_path text check (image_mobile_path is null or char_length(image_mobile_path) <= 300),
  link_url          text not null check (link_url ~* '^https?://' and char_length(link_url) <= 600),
  placement         text not null check (placement in ('home_top', 'home_middle', 'catalogue', 'listing')),
  starts_at         timestamptz,
  ends_at           timestamptz,
  active            boolean not null default true,
  sort_order        integer not null default 0,
  views             bigint not null default 0,
  clicks            bigint not null default 0,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create index if not exists ads_placement_idx on public.ads (placement, active, sort_order);

-- Per ad and per day (Tunis time): the report an advertiser receives.
create table if not exists public.ad_daily (
  ad_id   uuid not null references public.ads(id) on delete cascade,
  day     date not null,
  views   integer not null default 0,
  clicks  integer not null default 0,
  primary key (ad_id, day)
);

alter table public.ads      enable row level security;
alter table public.ad_daily enable row level security;
revoke all on table public.ads, public.ad_daily from anon, authenticated;
grant all on table public.ads, public.ad_daily to service_role;

drop trigger if exists _touch_ads on public.ads;
create or replace function public._touch_ads() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger _touch_ads before update on public.ads for each row execute function public._touch_ads();

-- One view or one click: the total on the ad, and the day's line.
create or replace function public.record_ad_event(p_ad uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Africa/Tunis')::date;
begin
  if p_kind not in ('view', 'click') then
    raise exception 'unknown ad event %', p_kind using errcode = '22023';
  end if;
  update public.ads
     set views  = views  + case when p_kind = 'view'  then 1 else 0 end,
         clicks = clicks + case when p_kind = 'click' then 1 else 0 end
   where id = p_ad;
  if not found then return; end if;
  insert into public.ad_daily as d (ad_id, day, views, clicks)
  values (p_ad, v_day, case when p_kind = 'view' then 1 else 0 end, case when p_kind = 'click' then 1 else 0 end)
  on conflict (ad_id, day) do update
    set views  = d.views  + excluded.views,
        clicks = d.clicks + excluded.clicks;
end;
$$;

revoke execute on function public.record_ad_event(uuid, text) from public, anon, authenticated;
grant execute on function public.record_ad_event(uuid, text) to service_role;

notify pgrst, 'reload schema';
