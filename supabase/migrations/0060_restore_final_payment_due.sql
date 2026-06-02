-- ============================================================================
-- Batta.tn — restore the final-payment deadline stamp (deep-audit regression).
--
-- Migration 0032 stamped auctions.final_payment_due_at when an English/sealed
-- auction transitioned to 'awarded' (= now + 14 days), and
-- notify_final_payment_due fires its T-7d / T-1d / overdue reminders off that
-- column. But 0052_auto_relist_unsold.sql redefined tick_auctions and its
-- sixth-offer→awarded block DROPPED the final_payment_due_at write. Since 0052
-- is the live definition, the column is never set on awarded auctions, so:
--   - winners get no "pay your balance" reminders, and
--   - admins get no overdue signal,
-- even though the UI threatens deposit forfeiture for late payment.
--
-- Rather than re-rewrite the large, working tick_auctions, we stamp the
-- deadline with a small, isolated BEFORE-UPDATE trigger on auctions. 'awarded'
-- is only ever set by tick's sixth-offer finalize, so this catches every case
-- without coupling to the tick body. Idempotent (only stamps when null), so a
-- future tick that sets it explicitly keeps working.
-- ============================================================================

create or replace function public._stamp_final_payment_due()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'awarded'
     and old.status is distinct from 'awarded'
     and new.final_payment_due_at is null then
    new.final_payment_due_at := now() + interval '14 days';
  end if;
  return new;
end;
$$;

drop trigger if exists _stamp_final_payment_due on public.auctions;
create trigger _stamp_final_payment_due
  before update on public.auctions
  for each row execute function public._stamp_final_payment_due();

-- Backfill any auctions already stuck in 'awarded' with a null deadline so
-- their reminders start firing (15-day grace from now, slightly longer for
-- ones that have been waiting).
update public.auctions
set final_payment_due_at = now() + interval '14 days'
where status = 'awarded' and final_payment_due_at is null;

notify pgrst, 'reload schema';
