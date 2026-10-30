/**
 * What a receipt must cover, before the console accepts it — pure.
 *
 * Until 0191 a signed-in person could write their own pending payment through
 * PostgREST (any kind, any amount, any plan), and « Accepter » granted what the
 * row said: 1 TND bought a Business plan in the QA tour. The policy is gone,
 * and the accept route no longer takes the row's word for it either: the
 * product must be the one the payment's kind sells, and the amount must be
 * what the server quoted for it.
 */
import type { ProductKind } from "@/lib/products";

/** The product kind each payment kind buys. */
export const PRODUCT_KIND_OF: Record<string, ProductKind> = {
  listing_fee: "listing_single",
  renewal: "renewal",
  promo: "promo",
  listing_pack: "listing_pack",
  subscription: "subscription",
  badge: "badge_verified",
};

/** Kinds whose payment must name the product it buys: nothing to grant without it. */
export const PRODUCT_REQUIRED = new Set(["promo", "listing_pack", "subscription", "badge"]);

/** The part of `payments.metadata` the quote was frozen in (subscribe route). */
export type QuoteMeta = { list_price?: unknown; credit?: unknown; change?: unknown };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The amount the payer was asked for: the price frozen in the metadata when
 * the server quoted it (`list_price`, written by the subscribe and promo
 * routes), so a price the console changed while the receipt waited does not
 * void a receipt that matches the quote. A plan's quote is also less the
 * credit of an upgrade (src/lib/pro/planChange.ts). A row from before the
 * freeze carries no list price and is held to the product's current price.
 */
export function expectedAmount(kind: string, meta: QuoteMeta | null | undefined, productPrice: number): number {
  const list = Number(meta?.list_price);
  const price = Number.isFinite(list) && list >= 0 ? list : productPrice;
  if (kind !== "subscription") return round2(price);
  const credit = meta?.change === "upgrade" ? Number(meta?.credit) : 0;
  return Math.max(0, round2(price - (Number.isFinite(credit) && credit > 0 ? credit : 0)));
}

/** Money is compared to the centime: 59 and 59.004 are the same receipt. */
export function amountMatches(amount: number, expected: number): boolean {
  return Number.isFinite(amount) && Math.abs(amount - expected) < 0.005;
}
