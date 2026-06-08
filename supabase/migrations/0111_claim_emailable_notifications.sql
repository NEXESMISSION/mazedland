-- ============================================================================
-- OBSERVABILITY / CORRECTNESS — atomic claim for the email outbox drain.
--
-- The notify-email worker did SELECT unsent rows, then per-row UPDATE emailed_at
-- in separate statements. Two overlapping runs (a slow run still going when the
-- next */10 cron or a manual trigger fires) could SELECT the same rows and send
-- the same money-critical email twice. This RPC makes the claim atomic: it
-- SELECT … FOR UPDATE SKIP LOCKED and increments email_attempts in ONE
-- statement, so concurrent runs grab DISJOINT rows (no double-send) and a run
-- that crashes after claiming leaves the row reclaimable up to p_max_attempts.
-- Returns the CLAIMED rows (email_attempts already incremented). The canonical
-- Postgres job-queue pattern.
-- ============================================================================

create or replace function public.claim_emailable_notifications(
  p_limit        int,
  p_kinds        text[],
  p_since        timestamptz,
  p_max_attempts int
)
returns setof public.notifications
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.notifications n
     set email_attempts = n.email_attempts + 1
   where n.id in (
     select id
       from public.notifications
      where emailed_at is null
        and email_attempts < p_max_attempts
        and kind = any (p_kinds)
        and created_at >= p_since
      order by created_at asc
      for update skip locked
      limit greatest(p_limit, 0)
   )
   returning n.*;
end;
$$;

revoke all on function public.claim_emailable_notifications(int, text[], timestamptz, int) from public;
grant execute on function public.claim_emailable_notifications(int, text[], timestamptz, int) to service_role;

notify pgrst, 'reload schema';
