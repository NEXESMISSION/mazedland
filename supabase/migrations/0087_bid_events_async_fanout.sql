-- ============================================================================
-- SCALABILITY (High) — move the bid notification fan-out OUT of place_bid's lock.
--
-- place_bid takes FOR UPDATE on the auction row and, while holding it, ran the
-- outbid ping + a watchlist fan-out (INSERT … SELECT FROM watchlist with a
-- per-watcher correlated NOT EXISTS). On a hot lot the lock-hold time scaled
-- with the watcher count — and since distinct bidders share no cooldown, the
-- final seconds of an English auction serialized every bid behind an
-- O(watchers) insert. That lock contention + WAL amplification is where
-- throughput collapses first.
--
-- Fix: place_bid now drops ONE O(1) `bid_events` row inside the lock; this
-- drain (pg_cron, every minute, FOR UPDATE SKIP LOCKED, bounded batch) does the
-- outbid + watchlist fan-out off the hot path. Realtime still pushes the live
-- price instantly to viewers; the bell/email ping tolerates a sub-minute delay.
-- The 60s dedup is preserved (and naturally coalesces multiple events for the
-- same lot within a drain). The Dutch immediate win/sold pings stay inline in
-- place_bid (O(1), no watcher scan).
-- ============================================================================

create table if not exists public.bid_events (
  id               bigserial primary key,
  auction_id       uuid not null,
  bidder_id        uuid not null,
  amount           numeric(14,2) not null,
  prev_high_bidder uuid,
  is_english       boolean not null default false,
  created_at       timestamptz not null default now(),
  processed_at     timestamptz
);
create index if not exists bid_events_unprocessed_idx
  on public.bid_events (created_at) where processed_at is null;

alter table public.bid_events enable row level security;
-- No policies → only SECURITY DEFINER functions / service_role touch it.

create or replace function public.process_bid_events()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ev    record;
  v_now   timestamptz := now();
  v_title text;
  v_seller uuid;
  v_link  text;
  v_done  int := 0;
begin
  for v_ev in
    select * from public.bid_events
     where processed_at is null
     order by created_at asc
     for update skip locked
     limit 1000
  loop
    select p.title, p.owner_id into v_title, v_seller
      from public.auctions a
      join public.properties p on p.id = a.property_id
     where a.id = v_ev.auction_id;
    v_link := '/auctions/' || v_ev.auction_id::text;

    -- Outbid (English only): notify the displaced top bidder unless they're
    -- actively watching (<45s presence) or were already pinged for this lot in
    -- the last 60s.
    if v_ev.is_english
       and v_ev.prev_high_bidder is not null
       and v_ev.prev_high_bidder <> v_ev.bidder_id
       and not exists (
         select 1 from public.auction_presence ap
          where ap.user_id = v_ev.prev_high_bidder
            and ap.auction_id = v_ev.auction_id
            and ap.seen_at > v_now - interval '45 seconds'
       )
       and not exists (
         select 1 from public.notifications n
          where n.user_id = v_ev.prev_high_bidder
            and n.kind = 'outbid'
            and n.link = v_link
            and n.created_at > v_now - interval '60 seconds'
       ) then
      perform public.enqueue_notification(
        v_ev.prev_high_bidder,
        'outbid',
        'Vous avez été surenchéri',
        'Une nouvelle offre de ' || to_char(v_ev.amount, 'FM999G999G990D00') || ' TND a été placée sur ' ||
          coalesce('« ' || v_title || ' »', 'cette enchère') || '. Réagissez avant la fin.',
        v_link
      );
    end if;

    -- Watchlist fan-out (all types), 60s dedup, single statement.
    insert into public.notifications (user_id, kind, title, body, link)
    select
      w.user_id,
      'watched_new_bid',
      'Nouvelle offre sur un bien suivi',
      coalesce('« ' || v_title || ' »', 'Une enchère suivie') ||
        ' vient de recevoir une nouvelle offre.',
      v_link
    from public.watchlist w
    where w.auction_id = v_ev.auction_id
      and w.user_id <> v_ev.bidder_id
      and (v_seller is null or w.user_id <> v_seller)
      and not exists (
        select 1 from public.notifications n
         where n.user_id = w.user_id
           and n.kind = 'watched_new_bid'
           and n.link = v_link
           and n.created_at > v_now - interval '60 seconds'
      );

    update public.bid_events set processed_at = v_now where id = v_ev.id;
    v_done := v_done + 1;
  end loop;

  return json_build_object('processed', v_done, 'at', v_now);
end;
$$;

revoke all on function public.process_bid_events() from public;
grant execute on function public.process_bid_events() to service_role;

-- Schedule the drain every minute (same pattern as tick_auctions in 0022).
do $$ begin
  if exists (select 1 from cron.job where jobname = 'process_bid_events') then
    perform cron.unschedule('process_bid_events');
  end if;
end $$;
select cron.schedule(
  'process_bid_events',
  '* * * * *',
  $cron$ select public.process_bid_events(); $cron$
);

notify pgrst, 'reload schema';
