-- ============================================================================
-- Batta.tn — LAUNCH BLOCKER FIX: lock down payment capture.
--
-- THE HOLE (pre-existing since 0001):
--   policy payments_self_insert allowed:
--     with check (auth.uid() = user_id)
--   with NO restriction on `status`. Postgres/Supabase grants the
--   `authenticated` role INSERT on public.payments by default, so any
--   logged-in user could POST directly to /rest/v1/payments with
--     { user_id:<self>, kind:'buy_now', amount:<price>, status:'captured' }
--   The AFTER-INSERT trigger `_on_payment_captured` then fired
--   close_auction_on_purchase / materialized an auction_deposit — i.e. a
--   user could WIN ANY AUCTION or gain bid eligibility for FREE, completely
--   bypassing the manual-receipt + admin-review model (the route code was
--   never the real security boundary — the RLS policy was).
--
-- THE FIX (two layers):
--   1. Tighten the insert policy so a user can only ever create a *pending*
--      payment (which is exactly what every /api/* route already does).
--   2. A BEFORE INSERT/UPDATE guard trigger so ANY transition to a
--      non-'pending' status is rejected unless the caller is the service role
--      (admin API routes use getServiceSupabase, which presents
--      auth.role()='service_role') or an admin session (the listing-fee RPCs
--      run on the user client and self-check is_admin()). Defense-in-depth in
--      case a future migration adds a payments UPDATE policy.
--
-- Verified safe: the two legit capture paths
--   - api/admin/payments/[id]   (admin.from('payments').update status=captured)
--   - api/admin/manual-payment  (admin.insert status=captured)
-- both use the SERVICE-ROLE client, which bypasses RLS and satisfies the
-- guard. User-initiated payments (deposit/checkout/buy-now) all insert
-- status='pending'. There is no payments UPDATE policy for normal users.
-- ============================================================================

-- 1. Insert policy: users may only create a PENDING payment for themselves.
drop policy if exists payments_self_insert on public.payments;
create policy payments_self_insert on public.payments for insert
  with check (auth.uid() = user_id and status = 'pending');

-- 2. Defense-in-depth guard: only trusted callers may write a non-pending
--    status (on insert OR update). is_admin() is SECURITY DEFINER so it works
--    inside this trigger; auth.role() reflects the API caller's JWT role
--    regardless of trigger context.
create or replace function public._guard_payment_capture()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT' and new.status is distinct from 'pending')
     or (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() then
      raise exception 'payment_status_forbidden'
        using hint = 'Payment status is captured server-side only after admin review.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists _guard_payment_capture on public.payments;
create trigger _guard_payment_capture
  before insert or update on public.payments
  for each row execute function public._guard_payment_capture();

notify pgrst, 'reload schema';
