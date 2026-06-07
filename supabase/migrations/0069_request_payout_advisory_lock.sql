-- ============================================================================
-- CONCURRENCY (Medium) — close the seller payout over-reservation race.
--
-- request_payout (0020) reads available balance (= net − paid − pending) and
-- inserts a new 'requested' row WITHOUT any lock. Two concurrent requests
-- from the same seller both read the same `available`, both pass the check,
-- and both insert — reserving MORE than the seller actually has. 0059's
-- comment even claims request_payout already serializes "same key family",
-- but it never took the lock. Add it.
--
-- Same per-seller advisory key family as admin_set_payout_status (0059):
--   hashtext('payout:' || seller)
-- so a request and an admin transition for the same seller also serialize
-- against each other — the balance read below now always sees prior in-flight
-- rows. Only request_payout changes; everything else is identical to 0020.
-- ============================================================================

create or replace function public.request_payout(
  p_amount numeric,
  p_iban   text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user      uuid := auth.uid();
  v_balance   json;
  v_available numeric;
  v_payout_id uuid;
begin
  if v_user is null then
    raise exception 'auth' using errcode = '28000';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;

  -- Serialize all payout activity for this seller BEFORE reading the balance,
  -- so two concurrent requests can't both reserve the same available funds.
  perform pg_advisory_xact_lock(hashtext('payout:' || v_user::text));

  v_balance := public.seller_balance(v_user);
  v_available := (v_balance ->> 'available')::numeric;

  if v_available < p_amount then
    raise exception 'insufficient_balance'
      using errcode = 'P0001',
            detail  = format('available: %s, requested: %s', v_available, p_amount);
  end if;

  insert into public.seller_payouts (seller_id, amount, iban, status)
  values (v_user, p_amount, p_iban, 'requested')
  returning id into v_payout_id;

  return json_build_object('ok', true, 'payout_id', v_payout_id);
end;
$$;

grant execute on function public.request_payout(numeric, text) to authenticated;

notify pgrst, 'reload schema';
