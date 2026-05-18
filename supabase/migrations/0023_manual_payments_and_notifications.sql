-- ============================================================================
-- Batta.tn — Manual-only payments + in-app notifications.
--
-- Drops API-gateway integrations (Konnect/Paymee/Flouci) and pivots to a
-- manual receipt-upload flow:
--
--   1. Buyer picks `bank_transfer` or `d17` at checkout.
--   2. Sees the payee details (IBAN, D17 number, reference).
--   3. Pays externally, uploads a photo / PDF of the receipt.
--   4. Payment row enters `pending_review`.
--   5. Admin reviews on /admin/payments → accepts (status='captured', downstream
--      effects fire) OR rejects with a reason (status='failed').
--   6. Notification inserted for the buyer either way.
--
-- Also adds the `notifications` table — generic in-app message bus used by KYC
-- and payments. Buyers see them via the bell in the TopBar.
-- ============================================================================

-- ─── 1. Payment receipt columns ─────────────────────────────────────────────

alter table public.payments
  add column if not exists receipt_url          text,
  add column if not exists receipt_uploaded_at  timestamptz,
  add column if not exists admin_notes          text,
  add column if not exists reviewer_id          uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at          timestamptz;

-- Add 'pending_review' to payment_status if missing. Receipt-flow uses it
-- to differentiate "user has uploaded proof, admin queue" from the legacy
-- `pending` state ("payment row created but no action yet").
alter type payment_status add value if not exists 'pending_review';

-- Index for the admin queue — pending_review payments sorted by upload time.
create index if not exists payments_pending_review_idx
  on public.payments(receipt_uploaded_at desc)
  where status = 'pending_review';

-- ─── 2. Notifications table ─────────────────────────────────────────────────

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  -- Free-form tag so the UI can pick an icon ('kyc_verified', 'kyc_rejected',
  -- 'payment_accepted', 'payment_rejected', 'auction_won', etc).
  kind        text not null,
  title       text not null,
  body        text,
  -- In-app path the bell-row links to (e.g. '/kyc/status'). May be null.
  link        text,
  -- Null while unread; set when the user opens the dropdown / clicks the row.
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- Unread feed lookup: per-user, newest first, partial index keeps it tiny.
create index if not exists notifications_user_unread_idx
  on public.notifications(user_id, created_at desc)
  where read_at is null;

-- Full history for the dropdown's "show all" view.
create index if not exists notifications_user_recent_idx
  on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;

-- Read: only the recipient sees their own notifications.
drop policy if exists notifications_self_read on public.notifications;
create policy notifications_self_read on public.notifications
  for select using (auth.uid() = user_id);

-- Update: only the recipient can mark their own rows read. Restricting WITH
-- CHECK to the same user_id prevents reassigning a notification to someone
-- else via UPDATE.
drop policy if exists notifications_self_mark_read on public.notifications;
create policy notifications_self_mark_read on public.notifications
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Inserts are server-side only (via service-role in API routes), so no
-- policy is needed — RLS default-denies INSERT for everyone else.

-- ─── 3. Realtime publication — buyers want the bell to update live ──────────

do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;

-- ─── 4. Receipts storage bucket — private, owner write + admin read ────────

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists "receipts_owner_read" on storage.objects;
create policy "receipts_owner_read"
on storage.objects for select
using (
  bucket_id = 'receipts'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

drop policy if exists "receipts_owner_insert" on storage.objects;
create policy "receipts_owner_insert"
on storage.objects for insert
with check (
  bucket_id = 'receipts'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ─── 5. RPC: enqueue_notification — convenience used by triggers + APIs ────

create or replace function public.enqueue_notification(
  p_user_id  uuid,
  p_kind     text,
  p_title    text,
  p_body     text default null,
  p_link     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.notifications (user_id, kind, title, body, link)
  values (p_user_id, p_kind, p_title, p_body, p_link)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.enqueue_notification(uuid, text, text, text, text) from public;
grant execute on function public.enqueue_notification(uuid, text, text, text, text) to service_role;

notify pgrst, 'reload schema';
