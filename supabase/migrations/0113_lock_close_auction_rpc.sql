-- ============================================================================
-- AUCTION / MONEY (CRITICAL) — close_auction_on_purchase must NOT be directly
-- callable by clients.
--
-- 0019/0079/0085 granted close_auction_on_purchase(uuid,uuid,numeric) to
-- `authenticated`. It is designed to be invoked ONLY by the
-- _on_payment_captured trigger AFTER a payment row reaches status='captured' —
-- it closes the auction and sets winner_user_id = p_buyer_id. Granted to
-- authenticated, any logged-in user could call it directly via PostgREST with
-- an attacker-controlled p_buyer_id + p_amount and WIN AN AUCTION FOR FREE
-- (no payment capture), or set a victim as winner to deny/grief a sale.
--
-- No app code calls it directly (only the trigger does — every src reference is
-- a comment). The trigger is SECURITY DEFINER, so it runs as the function owner
-- and is unaffected by this revoke. Revoke from public/anon/authenticated; keep
-- service_role for server-side/ops use.
-- ============================================================================

revoke all on function public.close_auction_on_purchase(uuid, uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.close_auction_on_purchase(uuid, uuid, numeric)
  to service_role;

notify pgrst, 'reload schema';
