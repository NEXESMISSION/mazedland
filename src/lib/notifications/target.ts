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
  | "/kyc/status"
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
  // Identity — kyc_verified/rejected land on the status page (shows verdict +
  // next step); welcome routes new users into the start of the KYC flow.
  kyc_verified: "/kyc/status",
  kyc_rejected: "/kyc/status",
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
const KYC_SUBROUTES = new Set([
  "/kyc/start",
  "/kyc/status",
  "/kyc/processing",
  "/kyc/selfie",
  "/kyc/id-front",
  "/kyc/id-back",
]);

export function normalizeLink(link: string): string {
  if (link === "/account/payouts") return "/sell#payouts";
  // Real /kyc/<step> routes pass through; anything else (e.g. /kyc/<uuid>)
  // collapses to the entry page.
  if (link.startsWith("/kyc/")) {
    return KYC_SUBROUTES.has(link.split(/[?#]/)[0]) ? link : "/kyc";
  }
  if (link.startsWith("/properties/")) return "/sell";
  // /inspections/<id> has no public route — handled per-kind in resolve;
  // this is the catch-all for any that slip through to the explicit-link tier.
  if (link.startsWith("/inspections/")) return "/account/inspections";
  return link;
}

/** Kinds whose fallback hub is a list page that can scroll-to-row when
 *  a focus id is supplied. We append `?focus=<id>` only for these — other
 *  fallbacks (a wizard, the seller dashboard) don't have a row to find. */
const FALLBACK_SUPPORTS_FOCUS: Record<NotificationKind, boolean> = {
  bid_placed: false, outbid: false, watched_new_bid: false, auction_won: false,
  auction_live: false, auction_ending_soon: false, auction_ended_unsold: false,
  reserve_not_met: false, buy_now_initiated: false, sixth_offer_placed: false,
  sixth_offer_outbid: false, sixth_offer_awarded: false,
  // Payment notifications fall back to /account/payments — that list shows
  // each row, so ?focus=<payment_id> can ring the right one.
  final_payment_due_soon: true, final_payment_due_tomorrow: true,
  final_payment_overdue: true,
  seller_received_bid: false, seller_sixth_offer_received: false,
  auction_live_seller: false, auction_sold_seller: false,
  auction_finalized_seller: false, auction_cancelled: false,
  final_payment_overdue_seller: false,
  payment_accepted: true, payment_rejected: true,
  payment_receipt_received: true, deposit_refunded: true,
  listing_submitted: false, listing_published: false, listing_approved: false,
  listing_rejected: false, listing_payment_rejected: false, listing_expired: false,
  kyc_verified: false, kyc_rejected: false, welcome: false,
  payout_processing: false, payout_paid: false, payout_rejected: false,
  inspection_requested: false, inspection_assigned: false,
  inspection_scheduled: false, inspection_completed: false,
  inspector_approved: false, inspector_application_received: false,
  admin_kyc_pending: false, admin_receipt_pending: false,
  admin_payout_pending: false, admin_listing_pending: false,
  admin_inspector_pending: false, admin_final_payment_overdue: false,
  announcement: false, promo: false, maintenance: false, system_alert: false,
};

/** Pull a string `focus` id out of the notification payload, if present.
 *  We never propagate non-string values — the only consumer is a query
 *  param the row-finder reads as a string. */
function focusIdFromPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload || typeof payload !== "object") return null;
  const f = (payload as { focus?: unknown }).focus;
  return typeof f === "string" && f.length > 0 ? f : null;
}

/**
 * Resolve the destination for a notification tap.
 *   1. Kind-first overrides — for kinds whose baked link is broken or
 *      points at the wrong audience (inspections, welcome). Owner-facing
 *      inspection updates deep-link to the specific inspection by lifting
 *      the id out of the /inspections/<id> link.
 *   2. A valid explicit link (entity-specific), repaired via normalizeLink.
 *   3. Per-kind hub fallback. Unknown kinds → null (non-navigating).
 *
 * If `payload.focus` is present AND the fallback hub supports row-focus
 * (FALLBACK_SUPPORTS_FOCUS), we append `?focus=<id>` so the list page can
 * scroll/ring the row this notification was about.
 */
export function resolveNotificationLink(
  kind: string,
  link: string | null,
  payload: Record<string, unknown> | null = null,
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
    // Auction-outcome notifications previously baked a /auctions/<id>
    // link — the same surface the user just came from. Land them on
    // their result hub (Mes activités → won / closed tabs) instead, so
    // they actually see "you won this, next step is X", not yet another
    // auction-detail render. ?focus=<id> rings the matching row.
    case "auction_won":
    case "sixth_offer_awarded": {
      const id = link ? lastSegment(link) : null;
      const base = "/account/activity?tab=gagnees";
      return id ? `${base}&focus=${encodeURIComponent(id)}` : base;
    }
    case "auction_ended_unsold":
    case "reserve_not_met":
    case "sixth_offer_outbid": {
      const id = link ? lastSegment(link) : null;
      const base = "/account/activity?tab=terminees";
      return id ? `${base}&focus=${encodeURIComponent(id)}` : base;
    }
  }

  if (link && link.startsWith("/")) return normalizeLink(link);

  const hub = KIND_FALLBACK[kind as NotificationKind] ?? null;
  if (!hub) return null;

  const focus = focusIdFromPayload(payload);
  if (focus && FALLBACK_SUPPORTS_FOCUS[kind as NotificationKind]) {
    // Hash routes (e.g. /sell#payouts) keep the hash; query goes before it.
    const [base, hash] = hub.split("#");
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}focus=${encodeURIComponent(focus)}${hash ? "#" + hash : ""}`;
  }
  return hub;
}
