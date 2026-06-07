-- ============================================================================
-- AUCTION ENGINE (High) — auto-release losing bidders' deposits on close.
--
-- Only the buy-now RPC (0019) ever released losing deposits; the tick close
-- path (ended_unsold / sixth-offer→awarded) never did, so losers' cautions
-- stayed locked indefinitely until an admin manually ran "prepare refunds".
-- At scale that is an unbounded manual backlog of customer money held hostage.
--
-- Fix: an AFTER UPDATE trigger on auctions.status. When an auction reaches a
-- terminal state, flag every still-active, non-winner deposit as released
-- (released_at = now) — exactly the state the admin "prepare refunds" queue
-- consumes, so refunds now populate automatically. Idempotent (only touches
-- rows where released_at IS NULL); harmless overlap with the buy-now RPC.
--
--   * ended_unsold        → no winner, release ALL active deposits
--   * awarded / ended_sold → release all EXCEPT the winner's caution
--                            (winner's is consumed by final/buy-now payment,
--                             or separately forfeited if they walk)
-- sixth_offer_window is deliberately NOT terminal: deposits stay locked during
-- the 8-day window (a sixth offer can still displace the provisional winner).
-- ============================================================================

create or replace function public._release_deposits_on_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('ended_unsold', 'awarded', 'ended_sold')
     and new.status is distinct from old.status then
    update public.auction_deposits
       set released_at = now()
     where auction_id = new.id
       and released_at is null
       and forfeited_at is null
       and (new.winner_user_id is null or user_id <> new.winner_user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists release_deposits_on_close on public.auctions;
create trigger release_deposits_on_close
  after update of status on public.auctions
  for each row execute function public._release_deposits_on_close();

notify pgrst, 'reload schema';
