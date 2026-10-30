// Which notification kinds also go out as SMS — the single source of truth for
// the SMS drain (/api/cron/notify-sms). Kept in its own pure module (no server
// deps) so it can be unit-tested: see sms-kinds.test.ts, which guards the
// invariants that matter (admin kinds never SMS, the money/outcome-critical
// kinds are always present, broadcasts/high-frequency pings stay out).

// SMS the full user lifecycle — every step a user would want to hear about even
// when not on the site (good news + bad). DELIBERATELY EXCLUDED: high-frequency
// per-bid pings (bid_placed, watched_new_bid, seller_received_bid,
// seller_sixth_offer_received, sixth_offer_placed) — they'd spam; the `welcome`
// kind (the signup OTP SMS already reached them); admin-queue alerts (admin_*,
// the operator dashboard's job); and broadcasts (announcement/promo/maintenance/
// system_alert — a mass campaign is a deliberate action, not a per-user step);
// and on-site ACKNOWLEDGEMENTS of an action the user just performed on the site
// (payment_receipt_received, listing_submitted, inspector_application_received) —
// each is shortly followed by a real verdict (accepted / approved / rejected), so
// SMSing the ack too made the user get TWO SMS for one thing. Acks stay in-app +
// email; SMS carries the verdict only.
// The per-user daily cap (CAPPED_KINDS) bounds what arrives in bulk.
export const SMS_KINDS = new Set<string>([
  // KYC / identity
  "kyc_verified", "kyc_rejected", "kyc_pending_reminder",
  // Auction went live (watchers/depositors + the seller)
  "auction_live", "auction_live_seller",
  // Bidding & buy-now (buyer)
  "outbid", "auction_outbid", "sixth_offer_outbid", "auction_ending_soon",
  "auction_won", "auction_lost", "sixth_offer_awarded", "buy_now_initiated",
  // Auction outcome (seller)
  "auction_sold_seller", "auction_finalized_seller", "reserve_not_met",
  "auction_ended_unsold", "auction_cancelled",
  // Payments (buyer) — verdicts only; "payment_receipt_received" is an on-site ack.
  "payment_accepted", "payment_rejected",
  "deposit_refunded",
  // Final payment (buyer + seller)
  "final_payment_due_soon", "final_payment_due_tomorrow",
  "final_payment_overdue", "final_payment_overdue_seller",
  "final_payment_defaulted",
  // Listings (seller) — outcomes only; "listing_submitted" is an on-site ack.
  // `listing_expiring` is the J-3 warning: once per annonce per cycle, and the
  // one message that can stop a paid annonce going dark unnoticed. It was
  // in-app only, which is where a seller is least likely to be.
  "listing_published", "listing_approved",
  "listing_rejected", "listing_payment_rejected",
  "listing_expiring", "listing_expired",
  // An agence's plan ends in a few days (0186): renewing keeps its annonces online.
  "plan_expiring",
  "listing_unscheduled_reminder",
  // Payouts (seller)
  "payout_processing", "payout_paid", "payout_rejected",
  // Inspections
  "inspection_requested", "inspection_assigned", "inspection_scheduled",
  "inspection_completed",
  // Inspector onboarding — approval only; "inspector_application_received" is an on-site ack.
  "inspector_approved",
  // Mazed Immo Pro (0173) — the verdict on a shop; joining a team stays in-app.
  "shop_approved", "shop_rejected",
  // Visits (0174) — each one moves a date in somebody's diary, so each goes out.
  "visit_requested", "visit_confirmed", "visit_declined", "visit_cancelled",
]);

// The kinds the per-user daily cap (`sms_daily_cap` in the console) never
// suppresses: a verdict on money or on a thing the person asked for, and a
// date in their diary. Each arrives once per thing and never in bulk, and
// each is something the person must act on — so it goes out even when the
// day's quota is spent on the rest.
//
// The cap used to name the kinds it throttled instead — six auction kinds,
// none produced since the product was dropped — so for every SMS the site
// really sends (thirty annonces approved at once, twenty visit requests on
// a popular annonce) it never fired. It is defined the other way round now:
// everything is capped except this list, and a kind added to SMS_KINDS is
// capped the day it is added.
export const UNCAPPED_KINDS = new Set<string>([
  // Money verdicts
  "payment_accepted", "payment_rejected", "deposit_refunded",
  // The verdict on an annonce or an agence the person submitted; the plan
  // that keeps an agence's annonces online.
  "listing_rejected", "listing_payment_rejected",
  "shop_approved", "shop_rejected",
  "plan_expiring",
  // The buyer must turn up: the day and half-day of a visit.
  "visit_confirmed",
  // Retired with the auction product and the identity checks; a row of one
  // of these, should any remain, still bypasses the cap as it always did.
  "kyc_verified", "kyc_rejected",
  "auction_won", "auction_lost", "sixth_offer_awarded",
  "auction_sold_seller", "auction_finalized_seller", "auction_cancelled",
  "final_payment_due_soon", "final_payment_due_tomorrow", "final_payment_overdue",
  "final_payment_overdue_seller", "final_payment_defaulted",
  "payout_processing", "payout_paid", "payout_rejected",
  "inspector_approved",
]);

// The per-user daily cap applies to every other SMS kind: once over it, the
// notification stays in the bell and the e-mail, as the console's hint says.
export const CAPPED_KINDS = new Set<string>([...SMS_KINDS].filter((k) => !UNCAPPED_KINDS.has(k)));

/** What a notification carries under `payload.vars`, if anything. */
type Vars = Record<string, unknown>;

export type SmsSource = {
  kind: string;
  title: string;
  body: string | null;
  payload?: unknown;
};

/**
 * The notification as an SMS may say it. An SMS leaves under the platform's
 * sender name, so free text typed by another user must not be its first
 * line: a buyer's name on a visit request could read « Appelez le 20 123 456
 * urgent », a seller's note could ask the buyer for a deposit. The bell and
 * the e-mail keep the name and the note (the recipient opens them inside the
 * site); the SMS names the buyer with `visitor` (« Un acheteur ») and drops
 * the seller's note, which the link shows. A row from before payloads carried
 * variables keeps the name in its stored body, so that body is not sent.
 */
export function forSms<T extends SmsSource>(row: T, visitor: string): T {
  const payload = row.payload && typeof row.payload === "object" ? (row.payload as Record<string, unknown>) : null;
  const vars = payload?.vars && typeof payload.vars === "object" ? (payload.vars as Vars) : null;
  switch (row.kind) {
    case "visit_requested":
    case "visit_cancelled":
      return vars
        ? { ...row, payload: { ...payload, vars: { ...vars, name: visitor } } }
        : { ...row, body: null };
    case "visit_confirmed":
    case "visit_declined":
      return vars && typeof vars.note === "string" && vars.note !== ""
        ? { ...row, payload: { ...payload, vars: { ...vars, note: "", variant: "plain" } } }
        : row;
    default:
      return row;
  }
}
