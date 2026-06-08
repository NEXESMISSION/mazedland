-- ============================================================================
-- SECURITY (HIGH) — take the crown-jewel PII off the realtime wire AND close
-- the direct-INSERT bypass on seller_payouts.
--
-- 1) REALTIME PII. 0021 published seller_payouts (IBAN = bank PII) and
--    kyc_submissions (identity PII) to supabase_realtime "because the admin
--    queues might use postgres_changes". They DON'T — every admin queue is a
--    server-rendered .from().select(); the only realtime subscriptions in the
--    app are to auctions, bids, and notifications. So these two tables sit on
--    the websocket boundary protected ONLY by RLS-on-realtime, an unverified
--    assumption: one Realtime-authorization regression would broadcast IBANs.
--    The robust pattern (a non-published table, cf. bid_private) is to simply
--    not publish them. Drop both from the publication — zero feature impact.
--
-- 2) PAYOUT INSERT BYPASS. 0020's payouts_self_insert lets any authenticated
--    user INSERT a seller_payouts row via PostgREST with an ARBITRARY amount,
--    bypassing request_payout()'s balance check — forging 'requested' rows that
--    pollute the admin queue and inflate the seller's pending reservation. The
--    app never inserts directly (POST /api/seller/payouts calls the
--    request_payout RPC, which is SECURITY DEFINER and bypasses RLS), so
--    dropping the INSERT policy closes the bypass with no functional change.
--    (Same hardening 0043 applied to sixth_offers via `revoke insert`.)
-- Idempotent.
-- ============================================================================

-- 1) Remove IBAN/KYC tables from the realtime publication.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
     where pubname='supabase_realtime' and schemaname='public' and tablename='seller_payouts'
  ) then
    alter publication supabase_realtime drop table public.seller_payouts;
  end if;
  if exists (
    select 1 from pg_publication_tables
     where pubname='supabase_realtime' and schemaname='public' and tablename='kyc_submissions'
  ) then
    alter publication supabase_realtime drop table public.kyc_submissions;
  end if;
end $$;

-- 2) Force payout creation through request_payout() only.
drop policy if exists payouts_self_insert on public.seller_payouts;
-- Belt-and-suspenders: also revoke the table-level INSERT grant from the
-- client roles so a future re-added permissive policy can't reopen the bypass.
revoke insert on public.seller_payouts from authenticated, anon;

notify pgrst, 'reload schema';
