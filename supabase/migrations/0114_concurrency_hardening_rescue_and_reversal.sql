-- ============================================================================
-- CONCURRENCY hardening (re-benchmark) — two gaps introduced by recent work.
--
-- 1) tick_auctions_cron's stranded-scheduled rescue (0100) was an UNBOUNDED
--    bulk UPDATE (update ... where status='scheduled' and ends_at<=now()),
--    inconsistent with the bounded FOR UPDATE SKIP LOCKED design used by
--    tick_auctions itself — two overlapping cron/backstop runs could lock-fight
--    over the same rows. Bound it to 500/run with FOR UPDATE SKIP LOCKED so
--    overlapping runs take disjoint rows and any single run does bounded work.
--
-- 2) reverse_settlement (0110) computed the clawback (reads seller_earnings +
--    seller_payouts) WITHOUT the per-seller payout advisory lock that
--    request_payout (0069) and admin_set_payout_status (0059) take — so a
--    reversal could interleave with a concurrent payout transition and the
--    balance/clawback view could race. Take the same hashtext('payout:'||seller)
--    lock so reversals serialize with payouts for that seller.
-- ============================================================================

-- 1) Bounded, skip-locked rescue.
create or replace function public.tick_auctions_cron()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tick json;
  v_rescued int;
begin
  -- Rescue stranded scheduled auctions whose window already elapsed — bounded +
  -- skip-locked so two overlapping runs never fight over the same rows. They
  -- never accepted a bid, so routing them through CLOSE (next line) finalizes
  -- them as ended_unsold and refunds locked deposits.
  update public.auctions
     set status = 'live'
   where id in (
     select id
       from public.auctions
      where status = 'scheduled'
        and ends_at <= now()
      order by ends_at asc
      for update skip locked
      limit 500
   );
  get diagnostics v_rescued = row_count;
  if v_rescued > 0 then
    raise warning 'tick_auctions_cron: rescued % stranded scheduled auction(s) into close path', v_rescued;
  end if;

  v_tick := public.tick_auctions();

  insert into public.cron_heartbeat (job, last_run)
  values ('tick_auctions', now())
  on conflict (job) do update set last_run = excluded.last_run;

  return v_tick;
end;
$$;

revoke all on function public.tick_auctions_cron() from public;
grant execute on function public.tick_auctions_cron() to service_role;

-- 2) reverse_settlement under the per-seller payout advisory lock.
create or replace function public.reverse_settlement(
  p_payment_id uuid,
  p_reason     text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay      public.payments%rowtype;
  v_seller   uuid;
  v_net      numeric := 0;
  v_paid     numeric := 0;
  v_clawback numeric := 0;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'payment_not_found'; end if;
  if v_pay.kind not in ('buy_now', 'final_payment') then
    raise exception 'not_a_settlement';
  end if;
  if v_pay.status <> 'captured' then raise exception 'not_captured'; end if;

  -- Resolve the seller FIRST, then serialize the whole reversal + clawback
  -- recompute against concurrent payouts for that seller.
  select pr.owner_id into v_seller
    from public.auctions a
    join public.properties pr on pr.id = a.property_id
   where a.id = v_pay.auction_id;
  if v_seller is not null then
    perform pg_advisory_xact_lock(hashtext('payout:' || v_seller::text));
  end if;

  update public.payments
     set status = 'refunded',
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'reversed_by', auth.uid(),
           'reversed_at', now(),
           'reverse_reason', p_reason
         )
   where id = p_payment_id;

  if v_seller is not null then
    select coalesce(sum(net_amount), 0) into v_net from public.seller_earnings(v_seller);
    select coalesce(sum(amount), 0) into v_paid
      from public.seller_payouts where seller_id = v_seller and status = 'paid';
    v_clawback := greatest(0, v_paid - v_net);
    if v_clawback > 0 then
      begin
        perform public._notify_admins(
          'admin_clawback_owed',
          'Récupération de fonds requise',
          'Un règlement encaissé a été annulé après un versement au vendeur. ' ||
            'Clawback dû : ' || to_char(v_clawback, 'FM999G999G990D00') ||
            ' TND. Récupérez le trop-perçu auprès du vendeur.',
          '/admin/payouts'
        );
      exception when others then
        raise warning 'reverse_settlement: clawback alert failed for %: %', p_payment_id, sqlerrm;
      end;
    end if;
  end if;

  return json_build_object('ok', true, 'payment_id', p_payment_id, 'clawback_owed', v_clawback);
end;
$$;

revoke all on function public.reverse_settlement(uuid, text) from public;
grant execute on function public.reverse_settlement(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
