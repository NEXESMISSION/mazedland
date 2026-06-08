-- ============================================================================
-- RESILIENCE — make the bid-notification drain self-healing + bounded + observable.
--
-- 0087's process_bid_events ran up to 1000 events in ONE transaction with no
-- per-event isolation: a single failing event (constraint, deadlock, schema
-- drift) rolled back the WHOLE batch and re-selected the same poison row first
-- next run → permanent head-of-line block → ALL outbid/watchlist pings freeze.
-- It also never deleted processed rows (unbounded growth) and had no heartbeat,
-- so a pg_cron stall was silent.
--
-- This migration:
--   * adds bid_events.attempts and wraps each event in a BEGIN/EXCEPTION
--     subtransaction — a poison row is retried up to 5x then quarantined
--     (processed) instead of blocking the queue;
--   * sweeps processed rows older than 7 days (bounded heap);
--   * stamps a cron_heartbeat row so an external monitor can detect a stalled
--     scheduler (paired with the HTTP backstop in /api/cron/auctions/tick).
-- ============================================================================

alter table public.bid_events add column if not exists attempts int not null default 0;

create table if not exists public.cron_heartbeat (
  job      text primary key,
  last_run timestamptz not null default now()
);
alter table public.cron_heartbeat enable row level security;
-- No policies → definer funcs stamp it; service_role reads it for /health.
grant select on public.cron_heartbeat to service_role;

create or replace function public.process_bid_events()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ev     record;
  v_now    timestamptz := now();
  v_title  text;
  v_seller uuid;
  v_link   text;
  v_done   int := 0;
  v_failed int := 0;
begin
  for v_ev in
    select * from public.bid_events
     where processed_at is null and attempts < 5
     order by created_at asc
     for update skip locked
     limit 1000
  loop
    begin
      select p.title, p.owner_id into v_title, v_seller
        from public.auctions a
        join public.properties p on p.id = a.property_id
       where a.id = v_ev.auction_id;
      v_link := '/auctions/' || v_ev.auction_id::text;

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
          v_ev.prev_high_bidder, 'outbid', 'Vous avez été surenchéri',
          'Une nouvelle offre de ' || to_char(v_ev.amount, 'FM999G999G990D00') || ' TND a été placée sur ' ||
            coalesce('« ' || v_title || ' »', 'cette enchère') || '. Réagissez avant la fin.',
          v_link
        );
      end if;

      insert into public.notifications (user_id, kind, title, body, link)
      select
        w.user_id, 'watched_new_bid', 'Nouvelle offre sur un bien suivi',
        coalesce('« ' || v_title || ' »', 'Une enchère suivie') || ' vient de recevoir une nouvelle offre.',
        v_link
      from public.watchlist w
      where w.auction_id = v_ev.auction_id
        and w.user_id <> v_ev.bidder_id
        and (v_seller is null or w.user_id <> v_seller)
        and not exists (
          select 1 from public.notifications n
           where n.user_id = w.user_id and n.kind = 'watched_new_bid'
             and n.link = v_link and n.created_at > v_now - interval '60 seconds'
        );

      update public.bid_events set processed_at = v_now where id = v_ev.id;
      v_done := v_done + 1;
    exception when others then
      -- Quarantine the poison row instead of aborting the batch. Retry up to
      -- 5x (transient deadlock/contention), then give up so it can't block the
      -- queue head forever.
      update public.bid_events
         set attempts = v_ev.attempts + 1,
             processed_at = case when v_ev.attempts + 1 >= 5 then v_now else null end
       where id = v_ev.id;
      v_failed := v_failed + 1;
      raise warning 'process_bid_events: event % failed (attempt %): %', v_ev.id, v_ev.attempts + 1, sqlerrm;
    end;
  end loop;

  -- Retention: keep the heap bounded to the in-flight + recent window.
  delete from public.bid_events
   where processed_at is not null and processed_at < v_now - interval '7 days';

  -- Heartbeat for an external dead-man's-switch.
  insert into public.cron_heartbeat (job, last_run)
  values ('process_bid_events', v_now)
  on conflict (job) do update set last_run = excluded.last_run;

  return json_build_object('processed', v_done, 'failed', v_failed, 'at', v_now);
end;
$$;

revoke all on function public.process_bid_events() from public;
grant execute on function public.process_bid_events() to service_role;

notify pgrst, 'reload schema';
