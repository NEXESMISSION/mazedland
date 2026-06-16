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
// The per-user daily cap (CAPPED_KINDS) still bounds an outbid storm.
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
  "listing_published", "listing_approved",
  "listing_rejected", "listing_payment_rejected", "listing_expired",
  "listing_unscheduled_reminder",
  // Payouts (seller)
  "payout_processing", "payout_paid", "payout_rejected",
  // Inspections
  "inspection_requested", "inspection_assigned", "inspection_scheduled",
  "inspection_completed",
  // Inspector onboarding — approval only; "inspector_application_received" is an on-site ack.
  "inspector_approved",
]);

// The per-user daily cap applies ONLY to these higher-frequency kinds (so an
// "outbid storm" can't burn credit). Every other kind — the money/outcome/
// account-critical ones (won, payment/KYC/payout verdicts, final-payment,
// deposit refunded, …) — BYPASSES the cap and is never suppressed.
export const CAPPED_KINDS = new Set<string>([
  "outbid", "auction_outbid", "sixth_offer_outbid",
  "auction_ending_soon", "auction_live", "auction_live_seller",
]);
