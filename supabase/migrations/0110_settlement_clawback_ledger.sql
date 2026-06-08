-- ============================================================================
-- MONEY (HIGH) — settlement reversal / clawback ledger.
--
-- Gap (re-benchmark): there was NO way to reverse a captured buy_now/
-- final_payment, and if a settled sale was unwound AFTER the seller was paid
-- out, the over-payment was invisible (seller_balance.available clamps at 0 and
-- nothing flagged the negative position). This adds the missing pieces:
--
--   1. reverse_settlement(payment_id, reason) — admin RPC that flips a captured
--      buy_now/final_payment to 'refunded'. seller_earnings (0102) filters
--      status='captured', so the credit (and, via 0102, the lot's deposit
--      credit) drops out of the seller's lifetime net IMMEDIATELY — the ledger
--      self-corrects. If the seller was already paid out beyond their new net,
--      it alerts admins that a clawback is owed (real cash to recover).
--   2. seller_balance gains `clawback_owed` = max(0, paid_out − net), so a
--      negative position is surfaced instead of silently clamped to 0.
--   3. forfeit_policy app_setting (default {"dest":"platform"}) — a forfeited
--      deposit is retained by the platform (current seller_earnings behavior:
--      forfeited deposits are excluded from the seller's net). Parametrable per
--      the monetization rule; 'seller'/'split' destinations are a follow-up.
--
-- reverse_settlement is admin-only and operates on already-captured rows, so it
-- never touches the live capture path. _on_payment_captured fires only on
-- →'captured', so flipping to 'refunded' triggers no side effects.
-- ============================================================================

-- 3) Parametrable forfeit destination (default: platform keeps it).
insert into public.app_settings (key, value)
values ('forfeit_policy', '{"dest":"platform"}'::jsonb)
on conflict (key) do nothing;

-- 2) Surface the negative position in seller_balance.
create or replace function public.seller_balance(p_seller_id uuid)
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_gross      numeric := 0;
  v_net        numeric := 0;
  v_commission numeric := 0;
  v_paid_out   numeric := 0;
  v_pending    numeric := 0;
  v_available  numeric := 0;
begin
  if auth.uid() is null then
    raise exception 'auth' using errcode = '28000';
  end if;
  if auth.uid() <> p_seller_id and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select
    coalesce(sum(gross_amount), 0),
    coalesce(sum(net_amount), 0),
    coalesce(sum(commission), 0)
  into v_gross, v_net, v_commission
  from public.seller_earnings(p_seller_id);

  select coalesce(sum(amount), 0) into v_paid_out
    from public.seller_payouts
    where seller_id = p_seller_id and status = 'paid';

  select coalesce(sum(amount), 0) into v_pending
    from public.seller_payouts
    where seller_id = p_seller_id and status in ('requested', 'processing');

  v_available := greatest(0, v_net - v_paid_out - v_pending);

  return json_build_object(
    'lifetime_gross', v_gross,
    'lifetime_net', v_net,
    'lifetime_commission', v_commission,
    'paid_out', v_paid_out,
    'pending_payout', v_pending,
    'available', v_available,
    -- Cash paid to the seller beyond their (post-reversal) lifetime net. >0
    -- means a settlement was reversed after payout → recover it out-of-band.
    'clawback_owed', greatest(0, v_paid_out - v_net),
    'commission_rate', public.batta_commission_rate()
  );
end;
$$;

grant execute on function public.seller_balance(uuid) to authenticated;

-- 1) The reversal path.
create or replace function public.reverse_settlement(
  p_payment_id uuid,
  p_reason     text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay      public.payments%rowtype;
  v_seller   uuid;
  v_net      numeric := 0;
  v_paid     numeric := 0;
  v_clawback numeric := 0;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'payment_not_found'; end if;
  if v_pay.kind not in ('buy_now', 'final_payment') then
    raise exception 'not_a_settlement';
  end if;
  if v_pay.status <> 'captured' then raise exception 'not_captured'; end if;

  update public.payments
     set status = 'refunded',
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'reversed_by', auth.uid(),
           'reversed_at', now(),
           'reverse_reason', p_reason
         )
   where id = p_payment_id;

  select pr.owner_id into v_seller
    from public.auctions a
    join public.properties pr on pr.id = a.property_id
   where a.id = v_pay.auction_id;

  if v_seller is not null then
    select coalesce(sum(net_amount), 0) into v_net from public.seller_earnings(v_seller);
    select coalesce(sum(amount), 0) into v_paid
      from public.seller_payouts where seller_id = v_seller and status = 'paid';
    v_clawback := greatest(0, v_paid - v_net);
    if v_clawback > 0 then
      begin
        perform public._notify_admins(
          'admin_clawback_owed',
          'Récupération de fonds requise',
          'Un règlement encaissé a été annulé après un versement au vendeur. ' ||
            'Clawback dû : ' || to_char(v_clawback, 'FM999G999G990D00') ||
            ' TND. Récupérez le trop-perçu auprès du vendeur.',
          '/admin/payouts'
        );
      exception when others then
        raise warning 'reverse_settlement: clawback alert failed for %: %', p_payment_id, sqlerrm;
      end;
    end if;
  end if;

  return json_build_object('ok', true, 'payment_id', p_payment_id, 'clawback_owed', v_clawback);
end;
$$;

-- Granted to authenticated but the body self-checks is_admin() (same pattern as
-- broadcast_notification / admin_set_payout_status), so it's called via the
-- admin's own signed-in client (after requireAdmin); non-admins get 'forbidden'.
revoke all on function public.reverse_settlement(uuid, text) from public;
grant execute on function public.reverse_settlement(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
