-- ============================================================================
-- 0198 · shop_subscriptions.replaced_by keeps its value, not its constraint.
--
-- 0193 declared replaced_by as a foreign key to payments — a second one
-- between the two tables (payment_id is the first). PostgREST then refused
-- the embed `payment:payments (status)` as ambiguous (PGRST201), the plan
-- loader swallowed the error and read no period at all: for an hour on
-- 2026-10-30 every plan card said « Du <today> au <+1 month> », the running
-- plan could be bought again and an upgrade was quoted at full price (the
-- regression run of the QA tour caught it). The code now names the
-- relationship it embeds; the constraint goes too, so an older build never
-- meets the ambiguity again. Payments are never deleted (invoices point at
-- them), so « on delete set null » protected nothing.
--
-- Rollback: supabase/rollbacks/0198_replaced_by_without_fk.down.sql.
-- ============================================================================

alter table public.shop_subscriptions
  drop constraint if exists shop_subscriptions_replaced_by_fkey;

notify pgrst, 'reload schema';
