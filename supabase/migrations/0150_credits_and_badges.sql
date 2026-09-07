-- ============================================================================
-- PIVOT PHASE 3 -- prepaid credits, the ledger, and the paid badge.
--
-- Ported from Mazed Auto's 0158. 0148 gave Land a `products` table with
-- `listing_pack`, `subscription` and `badge_verified` rows in it; nothing yet
-- records what a seller actually OWNS once they have paid for one. This is
-- that half.
--
-- A seller buys a pack of 5 annonces. That is prepaid money: they hold a claim
-- on us until they have published five times. Three things follow, and this
-- migration is all three.
--
-- 1. A LEDGER, NOT A COUNTER. `quota_used` alone cannot answer "ou sont passees
--    mes 5 annonces ?" -- and that question always gets asked. Every movement is
--    an append-only row naming the listing it went to.
--
-- 2. CONSUMPTION IS A DATABASE FUNCTION. Two tabs hitting "publier" at the same
--    moment must not spend the same credit twice. `SELECT ... FOR UPDATE` inside
--    one transaction is the only way that holds; a read-then-write from the app
--    is a race with money on the other side of it.
--
-- 3. THE BADGE IS SOLD, BUT GRANTED BY HAND. Payment does not grant it -- an
--    admin does, after checking the seller. On Land that human step replaces
--    something concrete: `kyc_submissions` held 50 identity dossiers for the
--    auction product. The classifieds product does not verify identity to let
--    someone publish, so the check that remains is a person who can also
--    revoke -- not a selfie-liveness pipeline holding CIN photographs.
--
-- `listings.seller_credit_id` already exists (0146 added the column without the
-- foreign key, because the table it points at did not exist yet). The
-- constraint is added below now that it does.
-- ============================================================================

-- ── Payment kinds for the new products ──────────────────────────────────────
-- ('listing_fee' and 'subscription' already exist.) Revenue stays queryable by
-- line: pack sales are not listing fees, badges are not promos.
alter type public.payment_kind add value if not exists 'listing_pack';
alter type public.payment_kind add value if not exists 'promo';
alter type public.payment_kind add value if not exists 'badge';
alter type public.payment_kind add value if not exists 'renewal';

-- ── What a seller owns right now ────────────────────────────────────────────
create table if not exists public.seller_credits (
  id           uuid primary key default gen_random_uuid(),
  seller_id    uuid not null references public.profiles(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete restrict,
  payment_id   uuid references public.payments(id) on delete set null,

  quota_total  int not null check (quota_total > 0),
  quota_used   int not null default 0 check (quota_used >= 0),
  expires_at   timestamptz not null,            -- D9: 12 months

  status       text not null default 'active'
                 check (status in ('active', 'exhausted', 'expired', 'revoked')),
  granted_by   uuid references public.profiles(id),   -- set when an admin gifts one
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint seller_credits_not_overspent check (quota_used <= quota_total)
);

create index if not exists seller_credits_seller_idx on public.seller_credits(seller_id, status);
-- The consumption query: oldest usable credit first, so nothing expires unused.
create index if not exists seller_credits_usable_idx
  on public.seller_credits(seller_id, expires_at)
  where status = 'active';

drop trigger if exists _touch_seller_credits on public.seller_credits;
create trigger _touch_seller_credits before update on public.seller_credits
  for each row execute function public._touch_updated_at();

-- ── Every movement, append-only ─────────────────────────────────────────────
create table if not exists public.credit_ledger (
  id               uuid primary key default gen_random_uuid(),
  seller_credit_id uuid not null references public.seller_credits(id) on delete cascade,
  listing_id       uuid references public.listings(id) on delete set null,
  delta            int not null,                  -- -1 consumed, +1 returned
  reason           text not null,                 -- 'publish' | 'return' | 'admin_adjust' | 'expire'
  actor_id         uuid references public.profiles(id),
  created_at       timestamptz not null default now()
);
create index if not exists credit_ledger_credit_idx on public.credit_ledger(seller_credit_id, created_at desc);
create index if not exists credit_ledger_listing_idx on public.credit_ledger(listing_id);

-- Append-only for real: a ledger you can edit is not a ledger. Corrections are
-- new rows with the opposite delta.
create or replace function public._credit_ledger_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'credit_ledger_is_append_only'
    using hint = 'Correct a mistake with a compensating row, never by editing history.';
end;
$$;

drop trigger if exists _credit_ledger_no_update on public.credit_ledger;
create trigger _credit_ledger_no_update before update or delete on public.credit_ledger
  for each row execute function public._credit_ledger_append_only();

-- listings.seller_credit_id can now point at a real row (column added in 0154).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'listings_seller_credit_fk'
  ) then
    alter table public.listings
      add constraint listings_seller_credit_fk
      foreign key (seller_credit_id) references public.seller_credits(id) on delete set null;
  end if;
end $$;

-- ── The badge ───────────────────────────────────────────────────────────────
create table if not exists public.seller_badges (
  id            uuid primary key default gen_random_uuid(),
  seller_id     uuid not null references public.profiles(id) on delete cascade,
  kind          text not null default 'verified' check (kind in ('verified')),
  product_id    uuid references public.products(id) on delete set null,
  payment_id    uuid references public.payments(id) on delete set null,

  granted_by    uuid not null references public.profiles(id),
  granted_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  revoke_reason text,
  note          text,                              -- what we actually checked
  created_at    timestamptz not null default now()
);
create index if not exists seller_badges_seller_idx on public.seller_badges(seller_id, expires_at desc);
-- One live badge per seller: a second grant renews rather than duplicates.
create unique index if not exists seller_badges_one_active
  on public.seller_badges(seller_id, kind) where revoked_at is null;

-- Read live, never cached on the profile: a revocation must disappear from
-- every listing the moment it happens.
create or replace function public.has_verified_badge(p_seller uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.seller_badges b
     where b.seller_id = p_seller
       and b.kind = 'verified'
       and b.revoked_at is null
       and b.expires_at > now()
  );
$$;

grant execute on function public.has_verified_badge(uuid) to anon, authenticated, service_role;

-- ── Consumption: the one place a credit is spent ────────────────────────────
create or replace function public.consume_listing_credit(
  p_seller  uuid,
  p_listing uuid,
  p_actor   uuid default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credit public.seller_credits%rowtype;
begin
  -- Oldest usable credit first (FIFO) so a pack about to expire is spent
  -- before a fresh one. FOR UPDATE + SKIP LOCKED: a concurrent publish takes
  -- the next credit instead of blocking or double-spending this one.
  select * into v_credit
    from public.seller_credits
   where seller_id = p_seller
     and status = 'active'
     and expires_at > now()
     and quota_used < quota_total
   order by expires_at asc, created_at asc
   for update skip locked
   limit 1;

  if not found then
    return json_build_object('ok', false, 'reason', 'no_credit');
  end if;

  update public.seller_credits
     set quota_used = quota_used + 1,
         status = case when quota_used + 1 >= quota_total then 'exhausted' else status end
   where id = v_credit.id;

  insert into public.credit_ledger (seller_credit_id, listing_id, delta, reason, actor_id)
  values (v_credit.id, p_listing, -1, 'publish', coalesce(p_actor, p_seller));

  update public.listings
     set seller_credit_id = v_credit.id
   where id = p_listing;

  return json_build_object(
    'ok', true,
    'credit_id', v_credit.id,
    'remaining', v_credit.quota_total - v_credit.quota_used - 1
  );
end;
$$;

revoke all on function public.consume_listing_credit(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.consume_listing_credit(uuid, uuid, uuid) to service_role;

-- Giving a credit back (a listing rejected in moderation shouldn't cost one).
create or replace function public.return_listing_credit(
  p_listing uuid,
  p_actor   uuid default null,
  p_reason  text default 'return'
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credit_id uuid;
begin
  select seller_credit_id into v_credit_id from public.listings where id = p_listing;
  if v_credit_id is null then
    return json_build_object('ok', false, 'reason', 'no_credit_on_listing');
  end if;

  update public.seller_credits
     set quota_used = greatest(0, quota_used - 1),
         status = case when status = 'exhausted' then 'active' else status end
   where id = v_credit_id;

  insert into public.credit_ledger (seller_credit_id, listing_id, delta, reason, actor_id)
  values (v_credit_id, p_listing, 1, p_reason, p_actor);

  update public.listings set seller_credit_id = null where id = p_listing;

  return json_build_object('ok', true, 'credit_id', v_credit_id);
end;
$$;

revoke all on function public.return_listing_credit(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.return_listing_credit(uuid, uuid, text) to service_role;

-- ── Expiry ──────────────────────────────────────────────────────────────────
-- Credits (D9) and badges (D10) both die on a date. Sellers hear about it
-- before it happens — an expired pack discovered at publish time is a support
-- ticket and a refund argument.
create or replace function public.expire_credits_and_badges()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits int := 0;
  v_badges  int := 0;
  r record;
begin
  for r in
    select id, seller_id, quota_total - quota_used AS left_over
      from public.seller_credits
     where status = 'active' and expires_at <= now()
     for update skip locked
  loop
    update public.seller_credits set status = 'expired' where id = r.id;
    insert into public.credit_ledger (seller_credit_id, delta, reason)
    values (r.id, -r.left_over, 'expire');
    perform public.enqueue_notification(
      r.seller_id, 'credits_expired', 'Forfait expiré',
      format('Vos %s publication(s) restantes ont expiré.', r.left_over),
      '/account/listings');
    v_credits := v_credits + 1;
  end loop;

  -- J-7 warning on a badge about to lapse. Marked in `note` so it fires once.
  for r in
    select id, seller_id, expires_at
      from public.seller_badges
     where revoked_at is null
       and expires_at between now() and now() + interval '7 days'
       and coalesce(note, '') not like '%[warned]%'
     for update skip locked
  loop
    perform public.enqueue_notification(
      r.seller_id, 'badge_expiring', 'Votre badge expire bientôt',
      format('Le badge « Vendeur vérifié » expire le %s. Renouvelez-le pour le garder.',
             to_char(r.expires_at, 'DD/MM')),
      '/account');
    update public.seller_badges set note = coalesce(note, '') || ' [warned]' where id = r.id;
    v_badges := v_badges + 1;
  end loop;

  return json_build_object('ok', true, 'credits_expired', v_credits, 'badges_warned', v_badges);
end;
$$;

revoke all on function public.expire_credits_and_badges() from public, anon, authenticated;
grant execute on function public.expire_credits_and_badges() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('expire_credits_and_badges')
      where exists (select 1 from cron.job where jobname = 'expire_credits_and_badges');
    perform cron.schedule('expire_credits_and_badges', '23 4 * * *',
                          'select public.expire_credits_and_badges();');
  end if;
end $$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.seller_credits enable row level security;
alter table public.credit_ledger  enable row level security;
alter table public.seller_badges  enable row level security;

-- A seller sees their own forfait and its history; nobody else's.
drop policy if exists seller_credits_own_read on public.seller_credits;
create policy seller_credits_own_read on public.seller_credits
  for select using (seller_id = auth.uid() or public.is_admin());

drop policy if exists seller_credits_admin_write on public.seller_credits;
create policy seller_credits_admin_write on public.seller_credits
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists credit_ledger_own_read on public.credit_ledger;
create policy credit_ledger_own_read on public.credit_ledger
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.seller_credits c
       where c.id = seller_credit_id and c.seller_id = auth.uid()
    )
  );

-- Badges are PUBLIC: the badge is a claim we make to buyers, so anyone may
-- verify it. Only admins create or revoke.
drop policy if exists seller_badges_public_read on public.seller_badges;
create policy seller_badges_public_read on public.seller_badges
  for select using (true);

drop policy if exists seller_badges_admin_write on public.seller_badges;
create policy seller_badges_admin_write on public.seller_badges
  for all using (public.is_admin()) with check (public.is_admin());

grant select on public.seller_credits, public.credit_ledger to authenticated;
grant select on public.seller_badges to anon, authenticated;
grant all on public.seller_credits, public.credit_ledger, public.seller_badges to service_role;

notify pgrst, 'reload schema';
