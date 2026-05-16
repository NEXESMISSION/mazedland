-- ============================================================================
-- Batta.tn — enable Realtime for the live-bidding tables.
--
-- Supabase's `supabase_realtime` publication is empty by default.
-- Without explicit ALTER PUBLICATION ADD TABLE, client-side
-- channel.on('postgres_changes', ...) silently receives no events —
-- and the bid composer + history list look frozen even though the
-- inserts/updates land correctly server-side.
--
-- We enable it for:
--   - auctions          — current_price + status updates drive the
--                         live ticker, the ended-state banner, and the
--                         sixth-offer transition
--   - bids              — INSERT events drive the leaderboard + the
--                         "X offres" counter on the composer
--   - kyc_submissions   — optional, but the admin queue uses the same
--                         postgres_changes channel pattern
--   - seller_payouts    — admin payout queue benefits from live updates
--                         when a seller submits a withdrawal
--
-- Idempotent: every ALTER is guarded by a pg_publication_tables check
-- so a re-run is a no-op.
-- ============================================================================

do $$
declare
  v_tables text[] := array[
    'auctions',
    'bids',
    'kyc_submissions',
    'seller_payouts'
  ];
  v_table text;
begin
  foreach v_table in array v_tables loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = v_table
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        v_table
      );
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
