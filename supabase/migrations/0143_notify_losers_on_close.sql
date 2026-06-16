-- ============================================================================
-- NOTIFICATIONS — tell losing bidders at close (audit gap, 2026-06-16).
--
-- When an auction reached a terminal state, _release_deposits_on_close (0072 /
-- 0086) unlocked every non-winner's caution but told them NOTHING. The only
-- signal a loser ever received was the later, MANUAL 'deposit_refunded'
-- (possibly days away). This redefines the SAME trigger to ALSO enqueue an
-- 'auction_lost' notification to each bidder whose caution it just released — at
-- the exact moment it becomes refundable — so they hear "the auction ended, you
-- didn't win, your caution will be refunded" on the bell + email + SMS right
-- away.
--
-- The money-release statement is BYTE-IDENTICAL to 0086 (same UPDATE, same
-- WHERE). The ONLY addition is the best-effort enqueue loop over the rows it
-- just released: a notification failure is swallowed so it can NEVER roll back
-- the deposit release.
-- ============================================================================

create or replace function public._release_deposits_on_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid;
  v_title text := 'Enchère terminée';
  v_body  text;
begin
  if new.status in ('ended_unsold', 'awarded', 'ended_sold', 'cancelled')
     and new.status is distinct from old.status then

    -- Outcome-appropriate wording (neutral — identical across both apps).
    v_body := case
      when new.status = 'cancelled'
        then 'L''enchère a été annulée. Votre caution va être remboursée.'
      when new.winner_user_id is null
        then 'L''enchère est terminée sans vente. Votre caution va être remboursée.'
      else 'L''enchère est terminée — vous n''avez pas gagné. Votre caution va être remboursée.'
    end;

    -- Release every non-winner caution (UNCHANGED from 0086) and capture exactly
    -- whom we released, so we can notify those bidders and no one else.
    for v_user in
      update public.auction_deposits
         set released_at = now()
       where auction_id = new.id
         and released_at is null
         and forfeited_at is null
         and (new.winner_user_id is null or user_id <> new.winner_user_id)
      returning user_id
    loop
      -- Best-effort: a notification error must NEVER undo the money release.
      begin
        perform public.enqueue_notification(
          v_user, 'auction_lost', v_title, v_body, '/account/payments'
        );
      exception when others then
        null;
      end;
    end loop;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
