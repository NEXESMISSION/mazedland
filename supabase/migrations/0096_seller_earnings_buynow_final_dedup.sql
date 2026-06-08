-- ============================================================================
-- MONEY (High) — a winner with BOTH a captured buy_now AND a captured
-- final_payment must credit the seller only ONCE.
--
-- 0084's unique index keys on (user_id, auction_id, kind), so a `buy_now` row
-- and a `final_payment` row are treated as DIFFERENT settlements and BOTH may
-- exist for the same winner+auction. But economically they are mutually
-- exclusive: a buy-now IS the full settlement (there is no separate balance to
-- pay), and a final_payment settles an auction WIN — never both for one lot.
--
-- seller_earnings (0089/0094) summed every captured buy_now/final_payment for
-- the winner with no cross-kind de-dup, so once both rows exist the seller's
-- gross — and therefore their withdrawable balance via seller_balance →
-- request_payout — is inflated by a full hammer price. Real money over-pays.
--
-- Reachable today: a buy-now capture closes the lot (status=ended_sold,
-- winner_user_id=buyer). The manual-payment route then accepts a `final_payment`
-- for that same winner (its only gate is winner_user_id = userId, and the
-- 0084 index does not collide a different kind). The companion route change
-- adds a friendly 409; THIS migration is the hard, self-healing backstop so the
-- ledger is correct regardless of how the second row was created (admin PATCH,
-- manual-payment, or a future online final_payment path).
--
-- Fix: when a winner+auction has a captured buy_now, EXCLUDE that auction's
-- final_payment rows from the seller's earnings (buy_now is the canonical close
-- that set the winner/price). deposit_lock handling is verbatim from 0094.
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
        )
      )
    order by pay.created_at desc;
end;
$$;

grant execute on function public.seller_earnings(uuid) to authenticated;

notify pgrst, 'reload schema';
