/**
 * Single source of truth for "where does a notification go when tapped".
 *
 * Design:
 *  - The notification `kind` already encodes the recipient role
 *    (auction_won vs auction_sold_seller, *_seller, admin_*), so the
 *    destination is a pure function of kind (+ the entity id baked into
 *    the creator's `link`). No viewer-role guessing needed.
 *  - `link` is the canonical deep target. resolveNotificationLink trusts
 *    a valid link (after repairing legacy/broken paths), and only falls
 *    back to a per-kind hub when no link was set.
 *  - KIND_FALLBACK is an exhaustive Record over NOTIFICATION_KINDS typed
 *    to a closed set of real routes — so adding a kind without a target,
 *    or a typo'd route, is a COMPILE error. That's the guardrail that
 *    keeps broken notification links from ever shipping again.
 */

export const NOTIFICATION_KINDS = [
  // Auctions — buyer
  "bid_placed", "outbid", "watched_new_bid", "auction_won", "auction_live",
  "auction_ending_soon", "auction_ended_unsold", "reserve_not_met",
  "buy_now_initiated", "sixth_offer_placed", "sixth_offer_outbid",
  "sixth_offer_awarded",
  "final_payment_due_soon", "final_payment_due_tomorrow", "final_payment_overdue",
  // Auctions — seller
  "seller_received_bid", "seller_sixth_offer_received", "auction_live_seller",
  "auction_sold_seller", "auction_finalized_seller", "auction_cancelled",
  "final_payment_overdue_seller",
  // Payments
  "payment_accepted", "payment_rejected", "payment_receipt_received",
  "deposit_refunded",
  // Listings (seller)
  "listing_submitted", "listing_published", "listing_approved",
  "listing_rejected", "listing_payment_rejected", "listing_expired",
  // Identity
  "kyc_verified", "kyc_rejected", "welcome",
  // Payouts (seller)
  "payout_processing", "payout_paid", "payout_rejected",
  // Inspections
  "inspection_requested", "inspection_assigned", "inspection_scheduled",
  "inspection_completed", "inspector_approved", "inspector_application_received",
  // Admin queues
  "admin_kyc_pending", "admin_receipt_pending", "admin_payout_pending",
  "admin_listing_pending", "admin_inspector_pending", "admin_final_payment_overdue",
  // Broadcasts
  "announcement", "promo", "maintenance", "system_alert",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * Closed set of fallback destinations (no entity id). Every value here
 * must be a route that exists under src/app/[locale]/. `null` = stay
 * non-navigating. Widening this union without a real page is the only way
 * to introduce a dead fallback, so keep it honest.
 */
type FallbackRoute =
  | "/properties"
  | "/account/activity"
  | "/account"
  | "/account/payments"
  | "/account/inspections"
  | "/sell"
  | "/sell#payouts"
  | "/inspector"
  | "/kyc"
  | "/admin/properties"
  | "/admin/payments"
  | "/admin/payouts"
  | "/admin/kyc-queue"
  | "/admin/inspectors"
  | null;

/**
 * Per-kind fallback used when the notification carries no usable link.
 * Exhaustive over NOTIFICATION_KINDS (compile-time guardrail).
 */
const KIND_FALLBACK: Record<NotificationKind, FallbackRoute> = {
  // Auctions — buyer → their unified activity hub
  bid_placed: "/account/activity",
  outbid: "/account/activity",
  watched_new_bid: "/account/activity",
  auction_won: "/account/activity",
  auction_live: "/account/activity",
  auction_ending_soon: "/account/activity",
  auction_ended_unsold: "/account/activity",
  reserve_not_met: "/account/activity",
  buy_now_initiated: "/account/activity",
  sixth_offer_placed: "/account/activity",
  sixth_offer_outbid: "/account/activity",
  sixth_offer_awarded: "/account/activity",
  final_payment_due_soon: "/account/payments",
  final_payment_due_tomorrow: "/account/payments",
  final_payment_overdue: "/account/payments",
  // Auctions — seller → seller dashboard
  seller_received_bid: "/sell",
  seller_sixth_offer_received: "/sell",
  auction_live_seller: "/sell",
  auction_sold_seller: "/sell",
  auction_finalized_seller: "/sell",
  auction_cancelled: "/sell",
  final_payment_overdue_seller: "/sell",
  // Payments → payment history
  payment_accepted: "/account/payments",
  payment_rejected: "/account/payments",
  payment_receipt_received: "/account/payments",
  deposit_refunded: "/account/payments",
  // Listings (seller)
  listing_submitted: "/sell",
  listing_published: "/sell",
  listing_approved: "/sell",
  listing_rejected: "/sell",
  listing_payment_rejected: "/sell",
  listing_expired: "/sell",
  // Identity
  kyc_verified: "/properties",
  kyc_rejected: "/kyc",
  welcome: "/kyc",
  // Payouts → seller dashboard payouts section
  payout_processing: "/sell#payouts",
  payout_paid: "/sell#payouts",
  payout_rejected: "/sell#payouts",
  // Inspections (also handled by kind-first overrides below)
  inspection_requested: "/account/inspections",
  inspection_assigned: "/inspector",
  inspection_scheduled: "/account/inspections",
  inspection_completed: "/account/inspections",
  inspector_approved: "/inspector",
  inspector_application_received: "/inspector",
  // Admin queues
  admin_kyc_pending: "/admin/kyc-queue",
  admin_receipt_pending: "/admin/payments",
  admin_payout_pending: "/admin/payouts",
  admin_listing_pending: "/admin/properties",
  admin_inspector_pending: "/admin/inspectors",
  admin_final_payment_overdue: "/admin/payments",
  // Broadcasts — admin supplies a link; no entity fallback
  announcement: null,
  promo: null,
  maintenance: null,
  system_alert: null,
};

/** Last non-empty path segment, ignoring query/hash. */
function lastSegment(path: string): string | null {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "");
  const seg = clean.split("/").pop();
  return seg && seg.length > 0 ? seg : null;
}

/**
 * Repair links baked by notification creators that point at routes which
 * don't exist. Each maps to its closest real page. The /properties list
 * (with or without ?query) is left intact — only the non-existent
 * /properties/<id> detail route is rewritten.
 */
export function normalizeLink(link: string): string {
  if (link === "/account/payouts") return "/sell#payouts";
  if (link.startsWith("/kyc/")) return "/kyc";
  if (link.startsWith("/properties/")) return "/sell";
  // /inspections/<id> has no public route — handled per-kind in resolve;
  // this is the catch-all for any that slip through to the explicit-link tier.
  if (link.startsWith("/inspections/")) return "/account/inspections";
  return link;
}

/**
 * Resolve the destination for a notification tap.
 *   1. Kind-first overrides — for kinds whose baked link is broken or
 *      points at the wrong audience (inspections, welcome). Owner-facing
 *      inspection updates deep-link to the specific inspection by lifting
 *      the id out of the /inspections/<id> link.
 *   2. A valid explicit link (entity-specific), repaired via normalizeLink.
 *   3. Per-kind hub fallback. Unknown kinds → null (non-navigating).
 */
export function resolveNotificationLink(
  kind: string,
  link: string | null,
): string | null {
  switch (kind) {
    // Inspector-facing → their work queue (link was /inspections/<id>).
    case "inspection_assigned":
    case "inspector_approved":
    case "inspector_application_received":
      return "/inspector";
    // Owner-facing inspection updates → the specific inspection detail.
    case "inspection_requested":
    case "inspection_scheduled":
    case "inspection_completed": {
      const id = link ? lastSegment(link) : null;
      return id ? `/account/inspections/${id}` : "/account/inspections";
    }
    // New users verify identity first.
    case "welcome":
      return "/kyc";
  }

  if (link && link.startsWith("/")) return normalizeLink(link);

  return KIND_FALLBACK[kind as NotificationKind] ?? null;
}
