-- ============================================================================
-- MONEY/CONCURRENCY (HIGH) — at most ONE captured settlement per winner+lot.
--
-- 0084's unique index keys on (user_id, auction_id, kind), so a `buy_now` and a
-- `final_payment` for the SAME winner+auction are different keys and BOTH can
-- capture. The manual-payment route's cross-kind dedup is a lock-free
-- read-then-write, so two concurrent admin entries (buy_now + final_payment)
-- can both pass the check and both capture → the buyer is charged TWICE for one
-- lot. (0096 stops the seller being over-CREDITED, but not the buyer being
-- double-CHARGED.)
--
-- Fix: a partial unique index that treats buy_now + final_payment as ONE
-- settlement slot per (auction_id, user_id) once captured — an atomic DB-level
-- guard the lock-free route check cannot race past. deposit_lock is excluded
-- (it legitimately co-exists with the settlement, e.g. deposit + final_payment
-- = price), and only `captured` rows are constrained, so a refunded/superseded
-- settlement (status moved off 'captured') correctly frees the slot.
-- ============================================================================

-- Defensive: surface any pre-existing cross-kind double-capture before the
-- unique index creation would fail on it (none expected pre-launch).
do $$
declare v_dupes int;
begin
  select count(*) into v_dupes from (
    select auction_id, user_id
      from public.payments
     where auction_id is not null
       and kind in ('buy_now', 'final_payment')
       and status = 'captured'
     group by auction_id, user_id
    having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise warning '0105: % winner+lot(s) already have a cross-kind double-capture — resolve (refund the duplicate) before this index can enforce.', v_dupes;
  end if;
end $$;

create unique index if not exists payments_one_settlement_per_winner
  on public.payments (auction_id, user_id)
  where auction_id is not null
    and kind in ('buy_now', 'final_payment')
    and status = 'captured';

notify pgrst, 'reload schema';
