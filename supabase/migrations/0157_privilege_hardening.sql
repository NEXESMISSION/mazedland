-- ============================================================================
-- 0157 · Privilege hardening
--
-- Measured against the live database on 2026-09-11 (read-only catalog queries
-- plus an anonymous PostgREST probe). Four things, all of them the same
-- mistake: Supabase grants the client roles broad privileges by DEFAULT, and a
-- narrower grant written later does not take those defaults away.
--
-- 1. SELLER PHONE NUMBERS WERE PUBLIC.
--    0146 granted `listings` columns to anon/authenticated one by one and left
--    contact_phone / contact_whatsapp out, so the number could only be reached
--    through /api/annonces/[id]/contact — logged, and rate-limited per IP. But
--    both roles also held TABLE-level SELECT (the platform default), and a
--    table grant covers every column. With the public anon key that ships in
--    every page, one request returned the phone number of every published
--    annonce: 12 of 12 when this was written. Any free account could do the
--    same. The reveal endpoint's protections were decorative.
--
--    Fix: take the table grant away and grant the columns explicitly, without
--    the two contact numbers. Every read of those columns in the app goes
--    through the service role, so nothing legitimate loses access.
--
-- 2. SIXTEEN SECURITY DEFINER FUNCTIONS WERE CALLABLE BY ANYONE.
--    Functions are EXECUTE-able by PUBLIC unless revoked, and a later
--    `grant execute ... to service_role` does not revoke it. Among those with
--    no auth check of their own:
--      · claim_smsable_notifications / claim_emailable_notifications — an
--        anonymous caller could CLAIM the notification queue: read the rows,
--        and mark them taken so the real SMS / e-mail never went out.
--      · _notify_admins — write arbitrary notifications (title, body, link)
--        into every admin's console: a phishing channel aimed at the people
--        with the most access.
--      · check_auth_ratelimit(p_ip) / check_rate_limit — burn someone else's
--        rate-limit budget and lock them out of login or password reset.
--      · stamp_cron_heartbeat — forge the dead-man's switch, so a stalled
--        scheduler reads healthy.
--      · prune_* / cleanup_* — run the retention deletes on demand.
--    Every app caller uses the service role (optimize-image was switched in
--    the same change), and definer-to-definer calls and pg_cron run as the
--    function owner, so revoking from the client roles breaks none of them.
--
-- 3. The client roles held TRUNCATE, TRIGGER and REFERENCES on every public
--    table. PostgREST cannot issue a TRUNCATE, which is the only reason that
--    was not exploitable; it is removed rather than relied on.
--
-- 4. Four `cron_heartbeat` rows belong to auction jobs that no longer run, and
--    kept /api/health at 503. The route now ignores them; the rows go too.
--
-- Future functions: default privileges are changed so a NEW function is not
-- executable by the client roles until a migration grants it on purpose. A
-- client-callable RPC added later must say so explicitly — which is the point.
-- ============================================================================

begin;

-- ── 1. listings: every column except the contact numbers ────────────────────
revoke all on table public.listings from anon, authenticated;

grant select (
  id, seller_id, category_id, title, description, price, negotiable,
  price_on_request, governorate, delegation, address, lat, lng, attributes,
  contact_name, show_phone, status, rejection_reason, reviewed_by, reviewed_at,
  fee_payment_id, seller_credit_id, fee_waived_by, published_at, expires_at,
  renewed_count, seller_attestation_version, seller_attestation_at, view_count,
  contact_reveal_count, search_text, created_at, updated_at, reference,
  promo_home_featured, promo_top_listed, promo_banner, promo_expires_at,
  promo_manual
) on public.listings to anon, authenticated;

-- Writes stay as 0146 defined them; RLS decides whose rows.
grant insert, update on public.listings to authenticated;

-- ── 2. service-only definer functions ───────────────────────────────────────
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public._is_banned(uuid)',
    'public._notify_admins(text, text, text, text)',
    'public.check_auth_ratelimit(text)',
    'public.check_rate_limit(text, integer, integer)',
    'public.claim_emailable_notifications(integer, text[], timestamp with time zone, integer)',
    'public.claim_smsable_notifications(integer, text[], timestamp with time zone, integer)',
    'public.cleanup_old_notifications()',
    'public.cleanup_phone_otps()',
    'public.enqueue_waitlist(text, text, text, inet)',
    'public.final_payment_interval()',
    'public.notify_kyc_pending_reminder()',
    'public.prune_activity_log()',
    'public.prune_read_notifications()',
    'public.record_listing_view(uuid, text, uuid)',
    'public.stamp_cron_heartbeat(text, integer)',
    'public.update_inspection_status(uuid, public.inspection_status, text)'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', fn);
      execute format('grant execute on function %s to service_role', fn);
    else
      raise notice '0157: % not found, skipped', fn;
    end if;
  end loop;
end
$$;

-- New functions are not client-callable until granted on purpose.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- ── 3. privileges PostgREST never needs ─────────────────────────────────────
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

-- ── 4. heartbeats of retired jobs ───────────────────────────────────────────
delete from public.cron_heartbeat
 where job in ('tick_auctions', 'process_bid_events',
               'notify_auctions_ending_soon', 'notify_final_payment_due');

commit;
