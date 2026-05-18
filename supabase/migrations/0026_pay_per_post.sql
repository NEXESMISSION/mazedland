-- ============================================================================
-- Batta.tn — Pay-per-post: schema + RPCs.
--
-- Builds on 0025 (enum values) to wire up:
--   1. `app_settings`     — admin-tunable prices + payee details.
--   2. properties promo_* — paid placement flags + expiry timestamp.
--   3. payments.property_id — polymorphic FK so a listing fee links to its
--                             property the way deposits link to auctions.
--   4. RPCs
--        public.accept_listing_payment(payment_id, durations_days jsonb)
--        public.reject_listing_payment(payment_id, reason)
--        public.expire_listing_promotions()
--      All security definer; only admin/service-role callable.
--
-- Listing lifecycle:
--   draft (form opened) → pending_review (seller submitted + uploaded receipt)
--   → on payment captured by admin → ready (and promo flags + expiry applied)
--   → admin can still reject the listing itself (rejected) — the captured
--     payment stays valid so the seller doesn't pay again to re-submit (per
--     product rule "no re-pay on listing rejection").
-- ============================================================================

-- ─── 1. app_settings — single source of truth for tunable money + payee ───

create table if not exists public.app_settings (
  key         text primary key,
  -- jsonb so we can store numbers, text, or richer shapes (no schema churn).
  value       jsonb not null,
  -- Free-form description shown next to the field in /admin/settings.
  description text,
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Read: ANY authenticated user can read non-secret keys (prices). Secret
-- keys (payee_iban, payee_d17) only readable by admin/service-role — the
-- checkout page fetches them server-side and renders without exposing
-- them in client RSC payloads when the user has no authorized session.
drop policy if exists app_settings_public_read on public.app_settings;
create policy app_settings_public_read on public.app_settings
  for select
  using (
    key in (
      'listing_fee_tnd',
      'promo_home_featured_tnd',
      'promo_top_listed_tnd',
      'promo_banner_tnd'
    )
  );

drop policy if exists app_settings_admin_all on public.app_settings;
create policy app_settings_admin_all on public.app_settings
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- Seed sensible defaults so the form has a price to show on day one.
insert into public.app_settings (key, value, description) values
  ('listing_fee_tnd',         to_jsonb(20::numeric), 'Frais de base par annonce (TND).'),
  ('promo_home_featured_tnd', to_jsonb(15::numeric), 'Supplément pour figurer dans le carrousel d''accueil.'),
  ('promo_top_listed_tnd',    to_jsonb(10::numeric), 'Supplément pour apparaître en haut de la recherche.'),
  ('promo_banner_tnd',        to_jsonb(30::numeric), 'Supplément pour figurer dans la bannière d''accueil.'),
  ('payee_name',              to_jsonb('Batta Tunisia SARL'::text), 'Bénéficiaire affiché au vendeur.'),
  ('payee_bank',              to_jsonb('Société Tunisienne de Banque (STB)'::text), 'Banque du compte.'),
  ('payee_rib',               to_jsonb('07 003 0001234567890 78'::text), 'RIB affiché pour le virement.'),
  ('payee_iban',              to_jsonb('TN59 0700 3000 0123 4567 8907 8'::text), 'IBAN affiché pour le virement.'),
  ('payee_d17',               to_jsonb('55 123 456'::text), 'Numéro D17 affiché au vendeur.')
on conflict (key) do nothing;

create or replace function public.touch_app_settings()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_app_settings on public.app_settings;
create trigger trg_touch_app_settings
  before update on public.app_settings
  for each row execute function public.touch_app_settings();

-- ─── 2. properties promo flags ─────────────────────────────────────────────

alter table public.properties
  add column if not exists promo_home_featured boolean not null default false,
  add column if not exists promo_top_listed    boolean not null default false,
  add column if not exists promo_banner        boolean not null default false,
  -- A single expiry timestamp covers all flags set on this row in the same
  -- accept action. Admin picks a duration per accept; cron unsets every
  -- flag once now() > promo_expires_at.
  add column if not exists promo_expires_at    timestamptz;

create index if not exists properties_promo_home_featured_idx
  on public.properties(promo_home_featured)
  where promo_home_featured = true and status = 'ready';

create index if not exists properties_promo_top_listed_idx
  on public.properties(promo_top_listed)
  where promo_top_listed = true and status = 'ready';

create index if not exists properties_promo_banner_idx
  on public.properties(promo_banner)
  where promo_banner = true and status = 'ready';

-- ─── 3. payments.property_id (polymorphic FK, same pattern as auction_id) ──

alter table public.payments
  add column if not exists property_id uuid references public.properties(id) on delete set null;

create index if not exists payments_property_idx
  on public.payments(property_id)
  where property_id is not null;

-- ─── 4. RPCs ───────────────────────────────────────────────────────────────

-- accept_listing_payment(payment_id, durations jsonb)
--   * durations is shaped like
--       { "home_featured": 30, "top_listed": 0, "banner": 7 }
--   * a value of 0 (or missing key) leaves that flag false.
--   * a positive integer N applies the flag and sets promo_expires_at to
--       now() + N days. If multiple flags are applied in one accept, the
--       MAX duration wins (single column).
--   * payment row is flipped to 'captured' + reviewer fields stamped.
--   * property is promoted from pending_review → ready.
--   * notification enqueued for the seller.
create or replace function public.accept_listing_payment(
  p_payment_id  uuid,
  p_durations   jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_pay      record;
  v_admin_id uuid;
  v_max_days int := 0;
  v_d        int;
  v_expires  timestamptz := null;
  v_promo_home   boolean := false;
  v_promo_top    boolean := false;
  v_promo_banner boolean := false;
begin
  -- Caller must be an admin.
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_admin_id := auth.uid();

  -- Load payment.
  select id, user_id, kind, amount, status, property_id, metadata
    into v_pay
  from public.payments
  where id = p_payment_id
  for update;

  if v_pay.id is null then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;
  if v_pay.kind <> 'listing_fee' then
    raise exception 'wrong_kind' using errcode = '22023';
  end if;
  if v_pay.status not in ('pending', 'pending_review') then
    raise exception 'already_resolved' using errcode = '22023';
  end if;
  if v_pay.property_id is null then
    raise exception 'payment_missing_property' using errcode = '22023';
  end if;

  -- Resolve durations. Defensive parsing — any non-integer / negative
  -- coerces to 0 so a malformed admin POST can't poison a row.
  if (p_durations ? 'home_featured') then
    begin v_d := (p_durations->>'home_featured')::int; exception when others then v_d := 0; end;
    if v_d > 0 then v_promo_home := true; v_max_days := greatest(v_max_days, v_d); end if;
  end if;
  if (p_durations ? 'top_listed') then
    begin v_d := (p_durations->>'top_listed')::int; exception when others then v_d := 0; end;
    if v_d > 0 then v_promo_top := true; v_max_days := greatest(v_max_days, v_d); end if;
  end if;
  if (p_durations ? 'banner') then
    begin v_d := (p_durations->>'banner')::int; exception when others then v_d := 0; end;
    if v_d > 0 then v_promo_banner := true; v_max_days := greatest(v_max_days, v_d); end if;
  end if;

  if v_max_days > 0 then
    v_expires := now() + make_interval(days => v_max_days);
  end if;

  -- Flip the payment row.
  update public.payments
     set status      = 'captured',
         reviewer_id = v_admin_id,
         reviewed_at = now(),
         admin_notes = null,
         metadata    = coalesce(metadata, '{}'::jsonb)
                       || jsonb_build_object('accepted_durations', p_durations)
   where id = p_payment_id;

  -- Promote the property + apply promo flags. We OR with existing flags
  -- so an admin re-running accept on a renewal payment can keep prior
  -- placements intact.
  update public.properties
     set status              = case when status in ('draft','pending_review') then 'ready'::property_status else status end,
         rejection_reason    = null,
         promo_home_featured = promo_home_featured or v_promo_home,
         promo_top_listed    = promo_top_listed    or v_promo_top,
         promo_banner        = promo_banner        or v_promo_banner,
         promo_expires_at    = case
           when v_expires is null then promo_expires_at
           when promo_expires_at is null then v_expires
           else greatest(promo_expires_at, v_expires)
         end,
         updated_at          = now()
   where id = v_pay.property_id;

  -- Notify the seller.
  perform public.enqueue_notification(
    v_pay.user_id,
    'listing_published',
    'Annonce publiée',
    'Votre paiement a été validé. Votre annonce est désormais visible sur Batta.tn.',
    '/sell'
  );
end;
$$;

revoke all on function public.accept_listing_payment(uuid, jsonb) from public;
grant execute on function public.accept_listing_payment(uuid, jsonb) to service_role;
grant execute on function public.accept_listing_payment(uuid, jsonb) to authenticated;

-- reject_listing_payment(payment_id, reason)
--   * flips payment → 'failed' with admin_notes = reason.
--   * property stays in pending_review so the seller can re-pay (this is the
--     payment getting rejected, NOT the listing).
--   * notification points back to the checkout page for re-upload.
create or replace function public.reject_listing_payment(
  p_payment_id uuid,
  p_reason     text
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_pay      record;
  v_admin_id uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_admin_id := auth.uid();

  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'reason_too_short' using errcode = '22023';
  end if;

  select id, user_id, kind, status into v_pay
  from public.payments where id = p_payment_id for update;
  if v_pay.id is null then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;
  if v_pay.kind <> 'listing_fee' then
    raise exception 'wrong_kind' using errcode = '22023';
  end if;
  if v_pay.status not in ('pending', 'pending_review') then
    raise exception 'already_resolved' using errcode = '22023';
  end if;

  update public.payments
     set status      = 'failed',
         admin_notes = p_reason,
         reviewer_id = v_admin_id,
         reviewed_at = now()
   where id = p_payment_id;

  perform public.enqueue_notification(
    v_pay.user_id,
    'listing_payment_rejected',
    'Reçu refusé',
    'Motif : ' || p_reason || '. Vous pouvez téléverser un nouveau reçu.',
    '/payment/checkout?payment=' || p_payment_id::text
  );
end;
$$;

revoke all on function public.reject_listing_payment(uuid, text) from public;
grant execute on function public.reject_listing_payment(uuid, text) to service_role;
grant execute on function public.reject_listing_payment(uuid, text) to authenticated;

-- expire_listing_promotions()
--   * Called by pg_cron (every 15 min). Idempotent — sets all promo flags
--     back to false on any property whose promo_expires_at has elapsed.
create or replace function public.expire_listing_promotions()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_count int;
begin
  update public.properties
     set promo_home_featured = false,
         promo_top_listed    = false,
         promo_banner        = false,
         promo_expires_at    = null,
         updated_at          = now()
   where promo_expires_at is not null
     and promo_expires_at <= now()
     and (promo_home_featured or promo_top_listed or promo_banner);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_listing_promotions() from public;
grant execute on function public.expire_listing_promotions() to service_role;

-- Schedule via pg_cron if the extension exists. Wrapped in an EXCEPTION block
-- so the migration still applies on environments without pg_cron installed
-- (e.g. local supabase preview projects).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'batta-expire-promos') then
      perform cron.unschedule('batta-expire-promos');
    end if;
    perform cron.schedule(
      'batta-expire-promos',
      '*/15 * * * *',
      $cron$ select public.expire_listing_promotions(); $cron$
    );
  end if;
exception when others then
  -- If pg_cron isn't reachable for any reason, leave the function in place
  -- (admin can invoke it manually) and don't fail the migration.
  raise notice 'pg_cron schedule skipped: %', sqlerrm;
end;
$$;

notify pgrst, 'reload schema';
