-- ============================================================================
-- MONEY (Medium) — count the winner's deposit_lock ONCE, even after re-entry.
--
-- 0084's unique index excludes deposit_lock (re-entry after a forfeit must be
-- allowed), and _on_payment_captured's ON CONFLICT collapses auction_deposits
-- to a single active row while un-setting forfeited_at. But the PAYMENTS ledger
-- keeps every captured deposit_lock row, so a winner who forfeited → re-entered
-- → won has TWO captured deposit_lock rows, and seller_earnings (0089) summed
-- BOTH → the seller's gross was inflated by one extra deposit. (Also reachable
-- via two concurrent manual deposit captures.)
--
-- Fix: for deposit_lock, count only the LATEST captured row per (auction,user)
-- — the one that matches the current active deposit. buy_now/final_payment are
-- unchanged (0084's unique index already de-dups them). Otherwise identical to
-- 0089 (winner+terminal-status gate at the top).
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
        pay.kind in ('buy_now', 'final_payment')
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
