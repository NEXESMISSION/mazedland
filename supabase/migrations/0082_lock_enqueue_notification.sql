-- ============================================================================
-- SECURITY (High) — stop any logged-in user injecting notifications / phishing.
--
-- The 5-arg enqueue_notification (0024) is granted ONLY to service_role.
-- But the 6-arg payload overload (0049:53) was ALSO granted to `authenticated`
-- with NO is_admin()/auth.uid() check and is SECURITY DEFINER, so it bypasses
-- the (intentionally absent) notifications INSERT policy. Any signed-in user
-- could:
--   supabase.rpc('enqueue_notification', { p_user_id:<any/all uids>, p_kind:
--     'payment_accepted', p_title:'...', p_body:'...', p_link:'/...', p_payload:{} })
-- to forge a notification into ANY user's feed — and by choosing an EMAILABLE
-- kind (kyc_verified/payment_accepted/auction_won/...), make the notify-email
-- cron send the forged title/body FROM the real Batta.tn domain (branded
-- phishing + unbounded spam).
--
-- Every legitimate caller of the 6-arg form is server-side: the
-- _on_payment_pending_review trigger (SECURITY DEFINER, runs as owner → not
-- subject to this grant) and service-role admin routes. So revoking it from
-- `authenticated` breaks nothing. Matches the 5-arg overload's posture.
-- ============================================================================

revoke execute on function public.enqueue_notification(uuid, text, text, text, text, jsonb) from authenticated;

-- Belt-and-braces: ensure neither overload is reachable by anon/public either.
revoke execute on function public.enqueue_notification(uuid, text, text, text, text, jsonb) from anon, public;
revoke execute on function public.enqueue_notification(uuid, text, text, text, text) from anon, public, authenticated;

notify pgrst, 'reload schema';
