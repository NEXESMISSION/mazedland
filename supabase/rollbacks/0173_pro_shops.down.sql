-- Rollback of 0173 (Mazed Immo Pro). Annonces keep existing; they lose their
-- shop link. Shops, members, subscription periods and the documents' rows are
-- lost (the files stay in the shop-documents bucket). The three plans are
-- deactivated, not deleted: payments may point at them.
alter table public.listings drop column if exists shop_id;
drop table if exists public.shop_documents, public.shop_subscriptions, public.shop_members, public.shops;
update public.products set is_active = false where slug in ('pro-starter', 'pro-pro', 'pro-business');
