-- ============================================================================
-- PAYMENTS (Medium) — stop counting a FORFEITED winner deposit as seller
-- earnings.
--
-- seller_earnings (0043) credits the winner's captured deposit_lock toward
-- earnings whenever a.winner_user_id = pay.user_id and the auction is
-- ended_sold/awarded — to keep gross = winner_amount once the final/buy-now
-- payment is netted. But if the winner WALKS (final payment never paid), their
-- deposit is forfeited (auction_deposits.forfeited_at set) and the lot is
-- relisted. The deposit_lock payment row stays status='captured', so the
-- collapsed sale still inflated the seller's withdrawable balance — and when
-- the relist sells, the property earns a SECOND time. Double credit.
--
-- Fix: only count the winner's deposit_lock when its auction_deposits row is
-- NOT forfeited. Everything else identical to 0043.
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
      and (
        pay.kind in ('buy_now', 'final_payment')
        -- Winner's deposit is "part of the purchase" — but ONLY if they did
        -- not forfeit it. A forfeited deposit = collapsed sale (relisted),
        -- so it must not credit the seller.
        or (
          pay.kind = 'deposit_lock'
          and a.winner_user_id = pay.user_id
          and a.status in ('ended_sold', 'awarded')
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
