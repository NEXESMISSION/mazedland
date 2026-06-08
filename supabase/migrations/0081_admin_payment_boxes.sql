-- ============================================================================
-- SCALABILITY (High) — paginate /admin/payments in SQL.
--
-- The page fetched up to 5000 joined payment rows, then grouped/filtered/sorted
-- /sliced them in Node. Past ~3k payments the .limit(5000) silently DROPS rows,
-- so the admin money console shows fewer auctions than exist — the worst kind of
-- bug on a payments surface (missing, not erroring). It also ships thousands of
-- rows over the wire every load.
--
-- Fix: one SECURITY DEFINER RPC that groups payments → one box per auction,
-- applies the status/date/text filters, orders by receipt count, and paginates
-- — all in SQL — returning just the current page plus the true total. Admin-
-- gated (is_admin()); the auctions/properties joins resolve inside the definer
-- so no per-table RLS juggling.
-- ============================================================================

create or replace function public.admin_payment_boxes(
  p_status     text default 'pending_review',
  p_q          text default null,
  p_since_days int  default null,
  p_page       int  default 1,
  p_page_size  int  default 24
) returns json
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_page     int := greatest(coalesce(p_page, 1), 1);
  v_size     int := least(greatest(coalesce(p_page_size, 24), 1), 100);
  v_offset   int := (v_page - 1) * v_size;
  v_since    timestamptz := case
    when p_since_days in (1, 7, 30) then now() - make_interval(days => p_since_days)
    else null
  end;
  v_total    int;
  v_boxes    json;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Single statement so the CTE is in scope for BOTH the total count and the
  -- paginated page (a WITH clause is local to its own statement in PL/pgSQL —
  -- splitting these threw 42P01 "relation filtered does not exist").
  with agg as (
    select
      pay.auction_id,
      max(pr.title)        as title,
      max(pr.governorate)  as gov,
      max(a.status::text)  as status,   -- constant per auction
      count(*)             as cnt,
      sum(pay.amount)      as total,
      min(pay.receipt_uploaded_at) as oldest
    from public.payments pay
    join public.auctions a    on a.id  = pay.auction_id
    join public.properties pr on pr.id = a.property_id
    where pay.kind in ('deposit_lock', 'buy_now', 'final_payment')
      and pay.auction_id is not null
      and (
        case
          when coalesce(p_status, 'pending_review') = 'all'
            then pay.status in ('pending_review', 'captured', 'failed')
          else pay.status::text = coalesce(p_status, 'pending_review')
        end
      )
      and (v_since is null or pay.receipt_uploaded_at >= v_since)
    group by pay.auction_id
  ),
  filtered as (
    select * from agg
    where p_q is null or p_q = ''
       or lower(title) like '%' || lower(p_q) || '%'
       or lower(gov)   like '%' || lower(p_q) || '%'
  )
  select
    (select count(*) from filtered)::int,
    coalesce((
      select json_agg(row_to_json(t))
      from (
        select auction_id, title, gov, status, cnt, total, oldest
        from filtered
        order by cnt desc, oldest asc nulls last
        limit v_size offset v_offset
      ) t
    ), '[]'::json)
  into v_total, v_boxes;

  return json_build_object('total', v_total, 'page', v_page, 'page_size', v_size, 'boxes', v_boxes);
end;
$$;

grant execute on function public.admin_payment_boxes(text, text, int, int, int) to authenticated;

notify pgrst, 'reload schema';
