-- ============================================================================
-- MONEY (CRITICAL) — a winner's deposit must not become seller earnings until
-- the sale actually SETTLES.
--
-- seller_earnings (0096) counted the winner's captured `deposit_lock` toward the
-- seller's gross as soon as the auction reached status ended_sold/awarded, with
-- the ONLY exclusion being a manual admin forfeit (forfeited_at). So in the
-- window between award and the buyer paying the balance:
--   * the deposit shows as withdrawable seller balance (seller_balance →
--     request_payout), and the platform can PAY IT OUT;
--   * if the winner then DEFAULTS (never pays the final_payment / the 14-day
--     window lapses), the deposit should be forfeited — but the seller may
--     already have withdrawn it, and there is no clawback. Net: the platform
--     pays the seller a deposit for a sale that never completed = real cash loss.
-- (The forfeit is manual-only, so the race is wide open, not a corner case.)
--
-- Fix: the deposit_lock counts toward seller earnings ONLY when the lot is
-- actually settled — i.e. the same winner+auction has a captured buy_now OR
-- final_payment. Economics are unchanged for completed sales:
--   * buy-now:  deposit_lock + buy_now (= price − deposit, 0079) = full price;
--   * auction:  deposit_lock + final_payment (= winner_amount − deposit) = win.
-- Before the balance is captured the deposit is held earnest money, not seller
-- earnings. Everything else is verbatim from 0096 (buy_now / final_payment /
-- forfeit / latest-deposit dedup). Idempotent.
-- ============================================================================

create or replace function public.seller_earnings(p_seller_id uuid)
returns table (
  payment_id    uuid,
  paid_at       timestamptz,
  auction_id    uuid,
  property_id   uuid,
  property_title text,
  kind          text,
  gross_amount  numeric,
  commission    numeric,
  net_amount    numeric
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'auth' using errcode = '28000';
  end if;
  if auth.uid() <> p_seller_id and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select
      pay.id,
      pay.created_at,
      pay.auction_id,
      p.id,
      p.title,
      pay.kind::text,
      pay.amount,
      pay.amount * public.batta_commission_rate(),
      pay.amount * (1 - public.batta_commission_rate())
    from public.payments pay
    join public.auctions a on a.id = pay.auction_id
    join public.properties p on p.id = a.property_id
    where pay.status = 'captured'
      and p.owner_id = p_seller_id
      and a.status in ('ended_sold', 'awarded')
      and a.winner_user_id = pay.user_id
      and (
        pay.kind = 'buy_now'
        -- A final_payment counts ONLY if no buy_now already settled this lot for
        -- the same winner. buy_now + final_payment are mutually exclusive
        -- settlements; counting both double-credits the seller a full price.
        or (
          pay.kind = 'final_payment'
          and not exists (
            select 1 from public.payments bn
             where bn.auction_id = a.id
               and bn.user_id    = pay.user_id
               and bn.kind       = 'buy_now'
               and bn.status     = 'captured'
          )
        )
        or (
          pay.kind = 'deposit_lock'
          and not exists (
            select 1 from public.auction_deposits d
             where d.auction_id = a.id
               and d.user_id = pay.user_id
               and d.forfeited_at is not null
          )
          -- Only the latest captured deposit_lock for this auction+user counts,
          -- so a forfeit→re-entry pair (two captured rows) credits once.
          and pay.id = (
            select p2.id
              from public.payments p2
             where p2.auction_id = a.id
               and p2.user_id = pay.user_id
               and p2.kind = 'deposit_lock'
               and p2.status = 'captured'
             order by p2.created_at desc, p2.id desc
             limit 1
          )
          -- CRITICAL (0102): the deposit is seller earnings ONLY once the sale
          -- settles. Require a captured buy_now or final_payment for this
          -- winner+lot; until the balance is paid the deposit is held earnest
          -- money (forfeited on default), never withdrawable seller balance.
          and exists (
            select 1 from public.payments s
             where s.auction_id = a.id
               and s.user_id    = pay.user_id
               and s.kind in ('buy_now', 'final_payment')
               and s.status     = 'captured'
          )
        )
      )
    order by pay.created_at desc;
end;
$$;

grant execute on function public.seller_earnings(uuid) to authenticated;

notify pgrst, 'reload schema';
