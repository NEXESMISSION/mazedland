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
 *    keeps broken notification links from ever shipping again. The test
 *    beside this file adds the other half: every kind a producer writes
 *    is in NOTIFICATION_KINDS, and every route here is a real page.
 */

export const NOTIFICATION_KINDS = [
  // Auctions — buyer
  "bid_placed", "outbid", "watched_new_bid", "auction_won", "auction_lost", "auction_live",
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
  "listing_unscheduled_reminder",
  // Identity
  "kyc_verified", "kyc_rejected", "kyc_pending_reminder", "welcome",
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
  // Demandes (0168): an annonce answered a buyer's or a tenant's demande
  "request_match",
  // Social Publisher (0170): the seller's promotion, and the admins' queue
  "social_published", "social_rejected", "admin_social_pending", "admin_social_attention",
  // Editing a published annonce (0172): the seller hears the verdict, admins the queue
  "listing_edit_applied", "listing_edit_rejected", "admin_listing_edit_pending",
  // A crash in production (0185): admins only, in the bell
  "admin_site_error",
  // The QA tour (2026-10-28): what was found, then what was fixed — admins only
  "qa_report",
  // An admin took an annonce down (2026-10-29): the seller hears it, with the reason
  "listing_archived",
  // Mazed Immo Pro (0173): the shop hears the verdict and who joined it, admins the queue
  "shop_approved", "shop_rejected", "shop_member_added", "admin_shop_pending",
  // An agence's plan enters its renewal days (0186)
  "plan_expiring",
  // Visits (0174): the seller hears the request and a cancellation, the buyer the answer
  "visit_requested", "visit_confirmed", "visit_declined", "visit_cancelled",
  // A shop answers a demande (P3); the person stays anonymous to the shop
  "request_suggestion",
  // A paid placement ended (0156): written by expire_listing_promotions()
  "promo_expired",
  // Produced for months but never registered (the QA tour, 2026-10-30): an
  // annonce taken offline by reports, a fee captured (_listing_fee_captured),
  // the J-3 expiry warning (expire_listings), a pack or a badge granted by an
  // admin, credits or a badge expiring (0164), and the two drains' alerts.
  "admin_listing_reported", "listing_payment_received", "listing_expiring",
  "pack_purchased", "badge_granted", "credits_expired", "badge_expiring",
  "admin_email_deadletter", "admin_sms_deadletter",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * Closed set of fallback destinations (no entity id). Every value here
 * must be a route that exists under src/app/[locale]/ — a page, not one of
 * next.config's redirects for the retired product (/sell, /kyc, /inspector,
 * /admin/payments…), which the test beside this file checks. `null` = stay
 * non-navigating. Widening this union without a real page is the only way
 * to introduce a dead fallback, so keep it honest.
 */
type FallbackRoute =
  | "/admin"
  | "/account"
  | "/account/activity"
  | "/account/payments"
  | "/account/listings"
  | "/account/requests"
  | "/account/visites"
  | "/admin/annonces"
  | "/admin/paiements"
  | "/admin/social"
  | "/admin/agences"
  | "/admin/activity"
  | "/pro/dashboard"
  | null;

/**
 * Per-kind fallback used when the notification carries no usable link.
 * Exhaustive over NOTIFICATION_KINDS (compile-time guardrail).
 */
export const KIND_FALLBACK: Record<NotificationKind, FallbackRoute> = {
  // Auctions — buyer → their unified activity hub
  bid_placed: "/account/activity",
  outbid: "/account/activity",
  watched_new_bid: "/account/activity",
  auction_won: "/account/activity",
  // Loser at close → their caution-refund page (where the refund status shows).
  auction_lost: "/account/payments",
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
  // Auctions — seller → their annonces (the seller dashboard went with the
  // auctions; /sell is a redirect to the publish form now)
  seller_received_bid: "/account/listings",
  seller_sixth_offer_received: "/account/listings",
  auction_live_seller: "/account/listings",
  auction_sold_seller: "/account/listings",
  auction_finalized_seller: "/account/listings",
  auction_cancelled: "/account/listings",
  final_payment_overdue_seller: "/account/listings",
  // Payments → payment history
  payment_accepted: "/account/payments",
  payment_rejected: "/account/payments",
  payment_receipt_received: "/account/payments",
  deposit_refunded: "/account/payments",
  listing_payment_received: "/account/listings",
  // Listings (seller) → « Mes annonces », where each row shows its state
  listing_submitted: "/account/listings",
  listing_published: "/account/listings",
  listing_approved: "/account/listings",
  listing_rejected: "/account/listings",
  listing_payment_rejected: "/account/listings",
  listing_expiring: "/account/listings",
  listing_expired: "/account/listings",
  listing_unscheduled_reminder: "/account/listings",
  listing_archived: "/account/listings",
  // Publications and the seller badge (0150): credits are spent from « Mes
  // annonces »; the badge shows on the account.
  pack_purchased: "/account/listings",
  credits_expired: "/account/listings",
  badge_granted: "/account",
  badge_expiring: "/account",
  // Identity — the KYC flow is retired; its pages redirect to the account.
  kyc_verified: "/account",
  kyc_rejected: "/account",
  kyc_pending_reminder: "/account",
  welcome: "/account",
  // Payouts → the person's payments (the payout section went with /sell)
  payout_processing: "/account/payments",
  payout_paid: "/account/payments",
  payout_rejected: "/account/payments",
  // Inspections — retired with the auctions; the account is where their
  // redirects land (also handled by kind-first overrides below)
  inspection_requested: "/account",
  inspection_assigned: "/account",
  inspection_scheduled: "/account",
  inspection_completed: "/account",
  inspector_approved: "/account",
  inspector_application_received: "/account",
  // Admin queues — each on the console page that still holds the queue
  admin_kyc_pending: "/admin",
  admin_receipt_pending: "/admin/paiements",
  admin_payout_pending: "/admin/paiements",
  admin_listing_pending: "/admin/annonces",
  admin_inspector_pending: "/admin",
  admin_final_payment_overdue: "/admin/paiements",
  admin_listing_reported: "/admin/annonces",
  // The drains' dead-letter alerts link /admin themselves; the same here.
  admin_email_deadletter: "/admin",
  admin_sms_deadletter: "/admin",
  // Broadcasts — admin supplies a link; no entity fallback
  announcement: null,
  promo: null,
  maintenance: null,
  system_alert: null,
  // The link is the annonce; without one, the person's demandes.
  request_match: "/account/requests",
  // The link is the annonce's promotion page; without one, the seller's annonces.
  social_published: "/account/listings",
  social_rejected: "/account/listings",
  admin_social_pending: "/admin/social",
  admin_social_attention: "/admin/social",
  listing_edit_applied: "/account/listings",
  listing_edit_rejected: "/account/listings",
  admin_listing_edit_pending: "/admin/annonces",
  admin_site_error: "/admin/activity",
  qa_report: "/admin",
  shop_approved: "/pro/dashboard",
  plan_expiring: "/pro/dashboard",
  shop_rejected: "/pro/dashboard",
  shop_member_added: "/pro/dashboard",
  admin_shop_pending: "/admin/agences",
  visit_requested: "/account/visites",
  visit_confirmed: "/account/visites",
  visit_declined: "/account/visites",
  visit_cancelled: "/account/visites",
  request_suggestion: "/account/requests",
  promo_expired: "/account/listings",
};

/** Last non-empty path segment, ignoring query/hash. */
function lastSegment(path: string): string | null {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "");
  const seg = clean.split("/").pop();
  return seg && seg.length > 0 ? seg : null;
}

/**
 * A path of this site, and nothing that only looks like one: `//host/x` and
 * `/\host/x` start with a slash too, and a browser follows both off the site.
 * The broadcast API refuses any other link; the bell falls back to the
 * kind's hub for one that slipped in another way.
 */
export function isInternalLink(link: string): boolean {
  return /^\/(?![/\\])/.test(link);
}

/**
 * Repair links baked by notification creators that point at routes which
 * don't exist: the pages of the auction product (/sell, /kyc, /properties/<id>,
 * /inspections/<id>, /account/payouts). Each maps to the live page that
 * answers the same intent. The /annonces list (with or without ?query) is
 * left intact.
 */
export function normalizeLink(link: string): string {
  if (link === "/account/payouts" || link.startsWith("/sell#payouts")) return "/account/payments";
  // The KYC flow is retired; every /kyc path redirects to the account.
  if (link === "/kyc" || link.startsWith("/kyc/") || link.startsWith("/kyc?")) return "/account";
  // A lot's page: the catalogue is the closest surface.
  if (link.startsWith("/properties/")) return "/annonces";
  // The seller dashboard and its /sell/<id>/… subpages went with the
  // auctions; a seller's annonces are at « Mes annonces ».
  if (link === "/sell" || link.startsWith("/sell/") || link.startsWith("/sell?")) return "/account/listings";
  // /inspections/<id> has no route; inspections are gone with the auctions.
  if (link.startsWith("/inspections/")) return "/account";
  return link;
}

/** Kinds whose fallback hub is a list page that can scroll-to-row when
 *  a focus id is supplied. We append `?focus=<id>` only for these — other
 *  fallbacks (a wizard, the seller dashboard) don't have a row to find. */
const FALLBACK_SUPPORTS_FOCUS: Record<NotificationKind, boolean> = {
  bid_placed: false, outbid: false, watched_new_bid: false, auction_won: false,
  auction_lost: false,
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
  listing_payment_received: false,
  listing_submitted: false, listing_published: false, listing_approved: false,
  listing_rejected: false, listing_payment_rejected: false, listing_expiring: false,
  listing_expired: false, listing_unscheduled_reminder: false,
  pack_purchased: false, credits_expired: false, badge_granted: false, badge_expiring: false,
  kyc_verified: false, kyc_rejected: false, kyc_pending_reminder: false,
  welcome: false,
  payout_processing: false, payout_paid: false, payout_rejected: false,
  inspection_requested: false, inspection_assigned: false,
  inspection_scheduled: false, inspection_completed: false,
  inspector_approved: false, inspector_application_received: false,
  admin_kyc_pending: false, admin_receipt_pending: false,
  admin_payout_pending: false, admin_listing_pending: false,
  admin_inspector_pending: false, admin_final_payment_overdue: false,
  admin_listing_reported: false, admin_email_deadletter: false, admin_sms_deadletter: false,
  announcement: false, promo: false, maintenance: false, system_alert: false,
  request_match: false,
  social_published: false, social_rejected: false,
  admin_social_pending: false, admin_social_attention: false,
  listing_edit_applied: false, listing_edit_rejected: false, admin_listing_edit_pending: false,
  admin_site_error: false,
  qa_report: false,
  listing_archived: false,
  shop_approved: false, shop_rejected: false, shop_member_added: false, admin_shop_pending: false,
  plan_expiring: false,
  visit_requested: false, visit_confirmed: false, visit_declined: false, visit_cancelled: false,
  request_suggestion: false,
  promo_expired: false,
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
 *      points at the wrong audience (inspections, welcome).
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
    // Inspections and the inspector network went with the auctions; their
    // baked /inspections/<id> links have nowhere to go but the account.
    case "inspection_assigned":
    case "inspector_approved":
    case "inspector_application_received":
    case "inspection_requested":
    case "inspection_scheduled":
    case "inspection_completed":
      return "/account";
    // New users used to verify their identity first; that flow is retired.
    case "welcome":
      return "/account";
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

  if (link && isInternalLink(link)) return normalizeLink(link);

  const hub = KIND_FALLBACK[kind as NotificationKind] ?? null;
  if (!hub) return null;

  const focus = focusIdFromPayload(payload);
  if (focus && FALLBACK_SUPPORTS_FOCUS[kind as NotificationKind]) {
    // Hash routes keep the hash; query goes before it.
    const [base, hash] = hub.split("#");
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}focus=${encodeURIComponent(focus)}${hash ? "#" + hash : ""}`;
  }
  return hub;
}
