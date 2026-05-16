-- ============================================================================
-- Batta.tn — seller payouts + earnings model.
--
-- Until now, money flowing through Batta lived in the `payments` table
-- with no aggregation: a seller couldn't see what they'd earned, what
-- the platform had withheld as commission, or how to withdraw it. This
-- migration introduces the missing financial model.
--
--   * `batta_commission_rate()` — single source of truth for the cut
--     (5%, hardcoded; can move to a settings table later).
--
--   * `seller_earnings(seller_id)` — SECURITY DEFINER function returning
--     the per-payment earnings for a seller's auctions (gross / net /
--     commission split). Bypasses payments RLS so the seller sees their
--     own earnings without being able to read other buyers' payments.
--
--   * `seller_payouts` — withdrawal requests. Self-insert by sellers
--     against their available balance; admin updates status.
--
--   * `seller_balance(seller_id)` — JSON aggregate (lifetime gross,
--     lifetime net, commission, paid-out, pending, available). The
--     value the dashboard needs in one call.
--
--   * `request_payout(amount, iban)` — guarded insert that checks the
--     amount doesn't exceed available balance.
-- ============================================================================

-- ─── 1. Commission rate ────────────────────────────────────────────────────
-- 5% to start, matching the typical Tunisian luxury-auction house cut.
-- Marked IMMUTABLE so the planner can fold it into expressions.

create or replace function public.batta_commission_rate()
returns numeric
language sql
immutable
as $$
  select 0.05::numeric
$$;

-- ─── 2. seller_payouts table ───────────────────────────────────────────────

create table if not exists public.seller_payouts (
  id              uuid primary key default gen_random_uuid(),
  seller_id       uuid not null references public.profiles(id) on delete cascade,
  amount          numeric(14,2) not null check (amount > 0),
  -- Lifecycle:
  --   requested  → submitted, awaiting admin review
  --   processing → admin acknowledged, bank transfer initiated
  --   paid       → transfer confirmed, ledger settled
  --   rejected   → admin declined (with notes); seller can resubmit
  status          text not null default 'requested'
                  check (status in ('requested', 'processing', 'paid', 'rejected')),
  -- IBAN snapshotted at request time. We never read it back from a
  -- live profile field, so changing the bank account later doesn't
  -- silently redirect an in-flight payout.
  iban            text,
  payment_method  text not null default 'bank_transfer',
  -- Admin audit
  reviewer_id     uuid references public.profiles(id),
  reviewer_notes  text,
  processed_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists seller_payouts_seller_idx
  on public.seller_payouts(seller_id, created_at desc);
create index if not exists seller_payouts_status_idx
  on public.seller_payouts(status)
  where status in ('requested', 'processing');

alter table public.seller_payouts enable row level security;

drop policy if exists payouts_self_read on public.seller_payouts;
create policy payouts_self_read on public.seller_payouts
  for select using (auth.uid() = seller_id or public.is_admin());

-- Sellers insert via the RPC (which sets seller_id = auth.uid()). The
-- with-check enforces that even if someone bypasses the RPC and POSTs
-- via PostgREST, they can only insert their own row.
drop policy if exists payouts_self_insert on public.seller_payouts;
create policy payouts_self_insert on public.seller_payouts
  for insert with check (auth.uid() = seller_id);

-- Only admins can update — sellers must wait for the verdict.
drop policy if exists payouts_admin_update on public.seller_payouts;
create policy payouts_admin_update on public.seller_payouts
  for update using (public.is_admin())
  with check (public.is_admin());

-- ─── 3. seller_earnings(seller_id) — per-payment line items ───────────────
-- SECURITY DEFINER bypasses RLS on `payments` (which a seller can't read
-- directly — those rows belong to buyers). The caller check below
-- prevents one seller from spying on another's earnings.

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
      and pay.kind in ('buy_now', 'final_payment')
      and p.owner_id = p_seller_id
    order by pay.created_at desc;
end;
$$;

grant execute on function public.seller_earnings(uuid) to authenticated;

-- ─── 4. seller_balance(seller_id) — aggregate JSON ────────────────────────
-- Returns {lifetime_gross, lifetime_net, lifetime_commission, paid_out,
-- pending_payout, available}. `available` clamps at 0 so a misconfigured
-- payout (paid more than earned, manual admin adjustment) never appears
-- as a negative withdrawable balance.

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
    'commission_rate', public.batta_commission_rate()
  );
end;
$$;

grant execute on function public.seller_balance(uuid) to authenticated;

-- ─── 5. request_payout(amount, iban) — guarded insert ─────────────────────
-- Validates: caller is signed in, amount positive, amount ≤ available
-- balance. Inserts the row at status='requested' for admin to process.

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
