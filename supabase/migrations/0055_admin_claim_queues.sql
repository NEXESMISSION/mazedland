-- ============================================================================
-- Batta.tn — "Claim / assigned-to-me" for the admin work queues.
--
-- Problem: the KYC and seller-payout queues are FIFO lists worked by more
-- than one admin. With no ownership marker, two admins open the same queue
-- and race on the same rows (double-review, conflicting decisions).
--
-- Fix: a lightweight, advisory claim. An admin "claims" a row (claimed_by =
-- them, claimed_at = now). Other admins see "Réservé par X" and can still
-- take over after the claim goes stale (TTL enforced in the API, not here).
-- Claims are cleared automatically when the row leaves the work queue
-- (a decision sets status away from submitted/requested).
--
-- The columns are nullable + default null, so existing rows are simply
-- "unclaimed". FK is ON DELETE SET NULL so deleting an admin profile never
-- blocks. Named FK constraints so PostgREST can embed the claimer profile.
-- ============================================================================

-- ─── KYC submissions ───────────────────────────────────────────────────────
alter table public.kyc_submissions
  add column if not exists claimed_by uuid,
  add column if not exists claimed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'kyc_submissions_claimed_by_fkey'
  ) then
    alter table public.kyc_submissions
      add constraint kyc_submissions_claimed_by_fkey
      foreign key (claimed_by) references public.profiles(id) on delete set null;
  end if;
end$$;

create index if not exists kyc_submissions_claimed_by_idx
  on public.kyc_submissions(claimed_by);

-- Clear the claim whenever a decision moves the row out of the work queue.
create or replace function public._on_kyc_decision_clear_claim()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and new.status not in ('submitted', 'pending')
     and (new.claimed_by is not null or new.claimed_at is not null) then
    new.claimed_by := null;
    new.claimed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists kyc_decision_clear_claim on public.kyc_submissions;
create trigger kyc_decision_clear_claim
  before update of status on public.kyc_submissions
  for each row execute function public._on_kyc_decision_clear_claim();

-- ─── Seller payouts ──────────────────────────────────────────────────────────
alter table public.seller_payouts
  add column if not exists claimed_by uuid,
  add column if not exists claimed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'seller_payouts_claimed_by_fkey'
  ) then
    alter table public.seller_payouts
      add constraint seller_payouts_claimed_by_fkey
      foreign key (claimed_by) references public.profiles(id) on delete set null;
  end if;
end$$;

create index if not exists seller_payouts_claimed_by_idx
  on public.seller_payouts(claimed_by);

create or replace function public._on_payout_decision_clear_claim()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and new.status in ('paid', 'rejected')
     and (new.claimed_by is not null or new.claimed_at is not null) then
    new.claimed_by := null;
    new.claimed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists payout_decision_clear_claim on public.seller_payouts;
create trigger payout_decision_clear_claim
  before update of status on public.seller_payouts
  for each row execute function public._on_payout_decision_clear_claim();

notify pgrst, 'reload schema';
