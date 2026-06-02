-- ============================================================================
-- Batta.tn — close the payout double-pay race (deep-audit HIGH finding).
--
-- The admin payout route re-validated the seller's balance before marking a
-- payout 'paid', but the read-compute-write happened on the user client with
-- NO lock and allowed requested→paid directly. Two admins (or two tabs)
-- marking two different payouts 'paid' at the same instant both read
-- paid_out=0 / reserved=0, both pass the balance check, and the seller is
-- OVER-PAID real money.
--
-- This RPC makes the transition atomic and serialized PER SELLER:
--   1. is_admin() self-guard (defence in depth alongside requireAdmin()).
--   2. pg_advisory_xact_lock on the seller — concurrent payout transitions for
--      the same seller now run strictly one-at-a-time (mirrors request_payout).
--   3. Locks the payout row FOR UPDATE and asserts a valid transition (can't
--      re-pay an already paid/rejected row).
--   4. On 'paid', recomputes payable = lifetime_net − paid_out − other-in-flight
--      UNDER the lock, so the second admin sees the first payout already
--      counted and is correctly blocked if the balance can't cover it.
-- ============================================================================

create or replace function public.admin_set_payout_status(
  p_payout_id uuid,
  p_status    text,
  p_notes     text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller   uuid;
  v_amount   numeric;
  v_iban     text;
  v_prev     text;
  v_bal      json;
  v_net      numeric;
  v_paid     numeric;
  v_reserved numeric;
  v_payable  numeric;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('processing', 'paid', 'rejected') then
    raise exception 'invalid_status' using hint = p_status;
  end if;

  -- Lock the row first to read its current state + owner.
  select seller_id, amount, iban, status
    into v_seller, v_amount, v_iban, v_prev
  from public.seller_payouts
  where id = p_payout_id
  for update;

  if v_seller is null then
    raise exception 'payout_not_found' using errcode = 'P0002';
  end if;

  -- Serialize ALL payout transitions for this seller (same key family as
  -- request_payout) so the balance recheck below can't race another admin.
  perform pg_advisory_xact_lock(hashtext('payout:' || v_seller::text));

  -- Valid transitions only. requested → processing|paid|rejected;
  -- processing → paid|rejected. paid/rejected are terminal for this row.
  if v_prev not in ('requested', 'processing') then
    raise exception 'payout_terminal'
      using hint = format('cannot move from %s', v_prev);
  end if;

  if p_status = 'paid' then
    v_bal  := public.seller_balance(v_seller);
    v_net  := coalesce((v_bal ->> 'lifetime_net')::numeric, 0);
    v_paid := coalesce((v_bal ->> 'paid_out')::numeric, 0);
    -- Other in-flight ('processing') payouts for this seller, excluding this row.
    select coalesce(sum(amount), 0) into v_reserved
    from public.seller_payouts
    where seller_id = v_seller and status = 'processing' and id <> p_payout_id;

    v_payable := round((v_net - v_paid - v_reserved)::numeric, 2);
    if v_amount > v_payable + 0.001 then
      raise exception 'balance_insufficient'
        using hint = format('payable: %s, payout: %s', v_payable, v_amount);
    end if;
  end if;

  update public.seller_payouts
  set status        = p_status,
      reviewer_id   = auth.uid(),
      reviewer_notes = p_notes,
      processed_at  = case when p_status = 'paid' then now() else processed_at end
  where id = p_payout_id;

  return json_build_object(
    'id', p_payout_id,
    'seller_id', v_seller,
    'amount', v_amount,
    'iban', v_iban,
    'prev_status', v_prev,
    'status', p_status
  );
end;
$$;

grant execute on function public.admin_set_payout_status(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
