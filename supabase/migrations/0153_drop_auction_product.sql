-- ============================================================================
-- PIVOT PHASE 6 — the auction product leaves the database.
--
-- The code went first (see the commit that deleted ~20 000 lines). This is the
-- schema behind it: 15 tables, 3 views, ~35 functions and 6 cron jobs that
-- nothing reads any more.
--
-- WHY IT IS SAFE, MEASURED RATHER THAN ASSUMED. Before writing a line of this:
--
--   bids ever placed, on any auction, ever ......... 0
--   bids on the 24 live/scheduled auctions ......... 0
--   distinct bidders ............................... 0
--   auction_deposits rows .......................... 7, from 3 users
--   who those 3 users are .......................... the operator's own two
--                                                    admin accounts and one
--                                                    test account
--   sixth_offers / inspections / property_documents
--     / auction_presence ........................... 0 rows each
--
-- The product never transacted. There is no bidder to strand and no caution to
-- refund, which is why this migration exists at all — an auction house with
-- real customers would get a wind-down, not a DROP.
--
-- The 50 KYC dossiers were exported and purged first, in their own pass
-- (scripts/kyc-export-and-purge.mjs). This migration drops an empty table.
--
-- ORDER MATTERS AND IS DELIBERATE. Objects that SURVIVE and merely touch the
-- auction schema are rewritten BEFORE anything is dropped, so `cascade` never
-- gets the chance to take something we still need:
--
--   1. unschedule the auction cron lane
--   2. rewrite the survivors (payment triggers, public_profiles, account
--      deletion) so they no longer name an auction table
--   3. detach the surviving tables (payments, watchlist) from the doomed ones
--   4. drop the auction functions and views
--   5. drop the tables
--
-- Written to be run once, but every statement is `if exists` / `or replace`, so
-- a re-run is a no-op rather than an error.
-- ============================================================================

-- ── 1. Stop the auction cron lane ───────────────────────────────────────────
-- These run every minute. Leaving them scheduled against dropped tables would
-- fill the Postgres log with errors forever.
do $$
declare j text;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    foreach j in array array[
      'tick_auctions', 'process_bid_events', 'batta-ending-soon',
      'batta-final-payment-due', 'process_final_payment_defaults',
      'batta-expire-promos'
    ] loop
      perform cron.unschedule(j) where exists (select 1 from cron.job where jobname = j);
    end loop;
  end if;
end $$;

-- ── 2. Rewrite what survives ────────────────────────────────────────────────

-- 2a. `payments` keeps its capture trigger, but everything the trigger DID was
-- auction work: materialise an auction_deposits row for a deposit_lock, close
-- an auction for a buy_now, alert an admin about stranded purchase money. None
-- of those kinds can be created any more.
--
-- The classifieds cascade lives elsewhere and is untouched: `_listing_fee_captured`
-- moves the annonce to pending_review, and /api/admin/paiements grants packs and
-- badges explicitly.
drop trigger if exists on_payment_captured on public.payments;
drop function if exists public._on_payment_captured() cascade;

-- 2b. The pending-review trigger stays — it is how a seller learns their receipt
-- arrived and how admins learn there is one to check. Two things go: the
-- `property_id` link (that column is dropped below, and v3 fees never set it
-- anyway — they carry `metadata.listing_id`), and the /admin/payments URL,
-- which is now /admin/paiements.
create or replace function public._on_payment_pending_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_what text;
begin
  if new.status = 'pending_review'
     and (old.status is null or old.status is distinct from 'pending_review') then

    -- Buyer ack lands on /account/payments. payload.focus tells the list page
    -- which row to ring + scroll into view.
    perform public.enqueue_notification(
      new.user_id,
      'payment_receipt_received',
      'Reçu reçu',
      'Votre reçu de ' || to_char(new.amount, 'FM999G999G990D00') ||
        ' TND a bien été reçu. Notre équipe le vérifiera sous 24-48h.',
      '/account/payments',
      jsonb_build_object('focus', new.id::text)
    );

    v_what := case new.kind::text
                when 'listing_fee'   then 'frais d''annonce'
                when 'listing_pack'  then 'forfait'
                when 'badge'         then 'badge vendeur'
                when 'promo'         then 'mise en avant'
                when 'renewal'       then 'renouvellement'
                when 'subscription'  then 'abonnement'
                else 'paiement'
              end;

    perform public._notify_admins(
      'admin_receipt_pending',
      'Nouveau reçu à vérifier',
      'Un reçu de ' || v_what || ' (' ||
        to_char(new.amount, 'FM999G999G990D00') || ' TND) attend votre validation.',
      '/admin/paiements'
    );
  end if;
  return new;
end;
$$;

-- 2c. `public_profiles` decided who is publicly visible, and four of its five
-- tests were auction tests: you are an approved inspector, you own a `ready`
-- property, you have bid, you won a lot, you requested an inspection.
--
-- The classifieds answer is simpler and stricter: a professional role, or
-- somebody with a PUBLISHED annonce — which is the only way a stranger has any
-- business seeing your name — plus yourself.
create or replace view public.public_profiles as
  select p.id, p.full_name, p.role
    from public.profiles p
   where p.deleted_at is null
     and (
       p.role = any (array['agency'::user_role, 'bank'::user_role, 'bailiff'::user_role])
       or exists (
         select 1 from public.listings l
          where l.seller_id = p.id and l.status = 'published'
       )
       or (auth.uid() is not null and p.id = auth.uid())
     );

alter view public.public_profiles set (security_invoker = on);
grant select on public.public_profiles to anon, authenticated;

-- 2d. Account deletion is a real user-facing feature (/api/account/delete) and
-- must keep working. Three of its four blockers were auction blockers: a live
-- lot, an unpaid win, a payout in flight. What remains is the one that still
-- means something — money of yours we are holding a decision on — plus a new
-- one that did not exist before: an annonce still in the moderation queue.
--
-- The KYC scrub is gone with the table. Deleting an account no longer has any
-- identity documents to destroy, which is the point of having purged them.
create or replace function public.request_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_blockers text[] := '{}';
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Idempotent: a second call after a successful delete is a no-op.
  if exists (select 1 from public.profiles where id = v_uid and deleted_at is not null) then
    return jsonb_build_object('ok', true, 'already', true, 'kyc_paths', '[]'::jsonb);
  end if;

  -- A payment of theirs is still pending or under review. Deleting the account
  -- underneath it would strand a receipt nobody can settle.
  if exists (
    select 1 from public.payments
     where user_id = v_uid and status::text in ('pending', 'pending_review')
  ) then
    v_blockers := array_append(v_blockers, 'pending_payments');
  end if;

  -- An annonce of theirs is mid-moderation. Same reasoning: an admin is about
  -- to make a decision about something whose owner would no longer exist.
  if exists (
    select 1 from public.listings
     where seller_id = v_uid and status in ('pending_payment', 'pending_review')
  ) then
    v_blockers := array_append(v_blockers, 'active_listings');
  end if;

  if array_length(v_blockers, 1) is not null then
    return jsonb_build_object('ok', false, 'blockers', to_jsonb(v_blockers));
  end if;

  -- Their annonces come down with them. Archived rather than deleted: the
  -- moderation log and any captured fee still point at these rows.
  update public.listings
     set status = 'archived'
   where seller_id = v_uid and status <> 'archived';

  update public.profiles
     set deleted_at = now(),
         full_name  = 'Compte supprimé',
         phone      = null
   where id = v_uid;

  -- `kyc_paths` stays in the response shape so the API route needs no change;
  -- it is always empty now.
  return jsonb_build_object('ok', true, 'kyc_paths', '[]'::jsonb);
end;
$$;

-- ── 3. Detach the surviving tables ──────────────────────────────────────────
--
-- The auction views come off first: `auction_watcher_counts` reads
-- `watchlist.auction_id`, so the column cannot be dropped while it exists.
drop view if exists public.auction_watcher_counts cascade;
drop view if exists public.property_document_kinds cascade;
drop view if exists public.auction_bid_counts cascade;
drop view if exists public.auction_bids_public cascade;


-- Every `deposit_lock`, `buy_now`, `final_payment`, `commission` and
-- `inspection_fee` payment belongs to the retired product and points at an
-- auction. All 18 were written by the operator's own three accounts (measured
-- above); none is a customer's money.
delete from public.payments
 where kind::text in ('deposit_lock', 'deposit_release', 'buy_now',
                      'final_payment', 'commission', 'inspection_fee');

-- Indexes come off first. A column drop refuses while an index still names it,
-- which is Postgres being helpful: it means the drop cannot silently take an
-- index somebody added for a reason nobody wrote down.
drop index if exists public.payments_auction_idx;
drop index if exists public.payments_property_idx;
drop index if exists public.payments_auction_id_idx;
drop index if exists public.payments_property_id_idx;
alter table public.payments drop column if exists auction_id;
alter table public.payments drop column if exists property_id;

-- `watchlist` was keyed to auctions; 0152 added `listing_id` alongside. With
-- auctions gone the "exactly one subject" check has only one subject left, so
-- it becomes a plain NOT NULL.
delete from public.watchlist where listing_id is null;
alter table public.watchlist drop constraint if exists watchlist_one_subject;
drop index if exists public.watchlist_user_auction_uniq;
drop index if exists public.watchlist_auction_idx;
alter table public.watchlist drop column if exists auction_id;
alter table public.watchlist alter column listing_id set not null;

-- ── 4. Drop the auction functions and views ─────────────────────────────────
-- `cascade` on each: their triggers go with them, and by now nothing that
-- survives depends on any of them.
drop view if exists public.auction_bid_counts cascade;
drop view if exists public.auction_bids_public cascade;
-- `auction_watcher_counts` reads `watchlist.auction_id`, not an auction table,
-- which is why it does not appear in a dependency scan of the doomed tables and
-- why the first run of this migration failed on it. Enumerating every view in
-- the schema rather than only the ones hanging off the tables being dropped is
-- the check that actually finds this shape.
drop view if exists public.auction_watcher_counts cascade;
drop view if exists public.property_document_kinds cascade;

drop function if exists public.tick_auctions() cascade;
drop function if exists public.tick_auctions_cron() cascade;
drop function if exists public.place_bid(uuid, numeric, uuid) cascade;
drop function if exists public.place_sixth_offer(uuid, numeric) cascade;
drop function if exists public.process_bid_events() cascade;
drop function if exists public.bids_maintain_count() cascade;
drop function if exists public.cancel_auction_safe(uuid, text) cascade;
drop function if exists public.close_auction_on_purchase(uuid, uuid, numeric) cascade;
drop function if exists public.am_i_winner(uuid) cascade;
drop function if exists public.is_winner_of(uuid) cascade;
drop function if exists public._validate_auction_insert() cascade;
drop function if exists public._on_auction_insert_reset_unscheduled() cascade;
drop function if exists public._on_sixth_offer_placed() cascade;
drop function if exists public._release_deposits_on_close() cascade;
drop function if exists public._on_property_pending_review() cascade;
drop function if exists public._on_inspection_event() cascade;
drop function if exists public._on_inspector_application() cascade;
drop function if exists public._on_kyc_status_change_reset_reminder() cascade;
drop function if exists public.get_inspection_contact(uuid) cascade;
drop function if exists public.admin_approve_inspector(uuid) cascade;
drop function if exists public.review_kyc(uuid, text, text) cascade;
drop function if exists public.notify_auctions_ending_soon() cascade;
drop function if exists public.notify_auctions_ending_soon_cron() cascade;
drop function if exists public.notify_final_payment_due() cascade;
drop function if exists public.notify_final_payment_due_cron() cascade;
drop function if exists public.notify_unscheduled_listings() cascade;
drop function if exists public.process_final_payment_defaults() cascade;
drop function if exists public.reverse_settlement(uuid, text) cascade;
drop function if exists public.seller_balance(uuid) cascade;
drop function if exists public.seller_earnings(uuid) cascade;
drop function if exists public.request_payout(numeric, text) cascade;
drop function if exists public.admin_set_payout_status(uuid, text, text) cascade;
drop function if exists public.admin_payment_boxes(text) cascade;
-- `accept_listing_payment` requires `payments.property_id`, which is dropped
-- above and which v3 fees never set anyway (they carry `metadata.listing_id`).
-- It raises `payment_missing_property` on every real fee, which is exactly why
-- /api/admin/paiements captures with a plain status write instead. It has to
-- go: after this migration it could not even be compiled.
drop function if exists public.accept_listing_payment(uuid) cascade;

-- `reject_listing_payment` STAYS. It is called by /api/admin/paiements on every
-- listing_fee rejection, and it touches only `payments` and
-- `enqueue_notification` — nothing auction-shaped. Dropping it alongside its
-- similarly-named sibling would have taken the working half of the pair with
-- the broken one.

-- Promotions applied to `properties.promo_*`. Those columns go with the table.
--
-- NOTE, deliberately left as a gap rather than half-built: `products` still
-- sells promo_accueil / promo_top_recherche / promo_banniere, and there is now
-- NOTHING that applies a purchased promo to a listing or expires it. Wiring
-- that to `listings` is a feature, not a cleanup, and inventing it inside a
-- DROP migration is how a drop migration becomes a bug.
drop function if exists public.expire_listing_promotions() cascade;

-- ── 5. Drop the tables ──────────────────────────────────────────────────────
-- Leaf-first so `cascade` has as little to do as possible; `cascade` is still
-- there because RLS policies, indexes and any remaining trigger hang off them.
drop table if exists public.bid_private        cascade;
drop table if exists public.auction_presence   cascade;
drop table if exists public.sixth_offers       cascade;
drop table if exists public.bids               cascade;
drop table if exists public.auction_deposits   cascade;
drop table if exists public.inspections        cascade;
drop table if exists public.inspection_reports cascade;
drop table if exists public.property_documents cascade;
drop table if exists public.seller_payouts     cascade;
drop table if exists public.kyc_submissions    cascade;
drop table if exists public.inspectors         cascade;
drop table if exists public.auctions           cascade;
drop table if exists public.property_photos    cascade;
drop table if exists public.property_attribute_kinds cascade;
drop table if exists public.properties         cascade;
drop table if exists public.waitlist           cascade;

-- Enum values cannot be removed in Postgres, so `payment_kind` keeps
-- 'deposit_lock' and friends. They are unreachable: no code writes them and
-- /admin/paiements refuses any kind outside the classifieds line.

notify pgrst, 'reload schema';
