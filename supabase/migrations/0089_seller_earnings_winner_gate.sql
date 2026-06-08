-- ============================================================================
-- MONEY (High) — stop a stranded captured buy_now/final_payment over-crediting
-- the seller ledger.
--
-- seller_earnings (0073) counted EVERY captured buy_now/final_payment for the
-- seller's auction with NO check that the payer actually WON. But
-- close_auction_on_purchase (0085) can return a NO-OP (high_bid_exceeds_buynow /
-- already_closed) without raising — and _on_payment_captured discards that
-- result — so a buy_now receipt captured after bids passed the buy-now price
-- stays status='captured' while the auction is awarded to the HIGH bidder. That
-- stranded payment then inflated the seller's withdrawable balance (which they
-- could request_payout against) until a manual out-of-band refund.
--
-- Fix: gate buy_now/final_payment the same way deposit_lock already is — only
-- count them when the payer IS the recorded winner and the auction is
-- terminal (ended_sold/awarded). A stranded buy_now (payer != winner) is then
-- excluded automatically; a normal sale (close sets winner=buyer) still counts.
-- Otherwise identical to 0073.
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
      and a.winner_user_id = pay.user_id   -- only the actual winner's settlement counts
      and (
        pay.kind in ('buy_now', 'final_payment')
        -- Winner's deposit is "part of the purchase" — but ONLY if not forfeited.
        or (
          pay.kind = 'deposit_lock'
          and not exists (
            select 1 from public.auction_deposits d
             where d.auction_id = a.id
               and d.user_id = pay.user_id
               and d.forfeited_at is not null
          )
        )
      )
    order by pay.created_at desc;
end;
$$;

grant execute on function public.seller_earnings(uuid) to authenticated;

notify pgrst, 'reload schema';
