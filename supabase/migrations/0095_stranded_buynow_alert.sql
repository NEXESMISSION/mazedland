-- ============================================================================
-- MONEY/RESILIENCE (Medium) — surface a stranded buy-now so the buyer's money
-- isn't a silent liability.
--
-- close_auction_on_purchase (0085) returns a NO-OP {ok:false,
-- high_bid_exceeds_buynow / already_closed} (it does NOT raise) when a standing
-- bid passed buy_now_price (or another buyer closed first). 0089 correctly
-- stops the SELLER over-credit (payer != winner), but the BUYER's payment was
-- still captured and is owed back — and nothing surfaced it ("refunded
-- out-of-band" with no signal).
--
-- Fix: _on_payment_captured now inspects the RPC result and, for a buy_now that
-- no-op'd where the buyer did NOT become the winner, alerts admins so the
-- refund is actioned. The alert is wrapped in BEGIN/EXCEPTION so it can NEVER
-- roll back the capture; the CLOSE itself stays fail-loud (unchanged) so an
-- unclosed legit sale still can't sit behind a captured payment. final_payment
-- is excluded — its payer IS the winner, so its no-op (auction already awarded)
-- is normal, not a stranded payment.
-- ============================================================================

create or replace function public._on_payment_captured()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res json;
begin
  if new.status = 'captured'
     and (old.status is null or old.status is distinct from 'captured') then

    -- Deposit lock — materialize the auction_deposits row.
    if new.kind = 'deposit_lock' and new.auction_id is not null then
      insert into public.auction_deposits (auction_id, user_id, amount, payment_id)
      values (new.auction_id, new.user_id, new.amount, new.id)
      on conflict (auction_id, user_id) do update
        set amount      = excluded.amount,
            payment_id  = excluded.payment_id,
            released_at = null,
            forfeited_at = null;
    end if;

    -- Buy-now / final payment — close the auction atomically. The RPC is
    -- idempotent on already-closed auctions. We DO let real errors propagate
    -- (fail-loud) so an unclosed sale never sits behind a 'captured' payment.
    if new.kind in ('buy_now', 'final_payment') and new.auction_id is not null then
      v_res := public.close_auction_on_purchase(
        new.auction_id, new.user_id, new.amount
      );

      -- Stranded-money guard (buy_now only): the RPC no-op'd AND the buyer did
      -- NOT become the winner → money captured for a purchase that never
      -- happened. Alert admins to refund. Best-effort (wrapped) — must never
      -- roll back the capture.
      if new.kind = 'buy_now'
         and coalesce((v_res ->> 'ok')::boolean, true) = false
         and not exists (
           select 1 from public.auctions a
            where a.id = new.auction_id and a.winner_user_id = new.user_id
         ) then
        begin
          perform public._notify_admins(
            'admin_refund_due',
            'Remboursement à effectuer',
            'Un achat immédiat de ' || to_char(new.amount, 'FM999G999G990D00') ||
              ' TND a été encaissé mais l''enchère a été attribuée à un autre enchérisseur. ' ||
              'Remboursez l''acheteur.',
            '/admin/payments'
          );
        exception when others then
          raise warning 'stranded buy_now admin alert failed for payment %: %', new.id, sqlerrm;
        end;
      end if;
    end if;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
