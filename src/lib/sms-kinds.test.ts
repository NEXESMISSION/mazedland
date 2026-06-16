import { describe, it, expect } from "vitest";
import { SMS_KINDS, CAPPED_KINDS } from "./sms-kinds";

// These guard the SMS-eligibility list against the two ways it silently breaks:
// (1) an admin/queue/broadcast kind leaking in (the user gets operator spam, or
// we burn SMS credit on a mass campaign), and (2) a money/outcome-critical kind
// getting dropped (a buyer never hears they won / must pay / were refunded).
describe("SMS_KINDS", () => {
  it("never SMSes admin/operator kinds", () => {
    const admin = [...SMS_KINDS].filter((k) => k.startsWith("admin_"));
    expect(admin).toEqual([]);
  });

  it("excludes high-frequency pings and broadcasts (would spam / cost)", () => {
    // Per-bid pings, the welcome OTP echo, and mass-campaign kinds must stay out
    // — sending these as SMS would flood users and drain credit.
    const mustNotSms = [
      "bid_placed", "watched_new_bid", "seller_received_bid",
      "seller_sixth_offer_received", "sixth_offer_placed", "welcome",
      "announcement", "promo", "maintenance", "system_alert",
      // on-site acknowledgements — each is followed by a real verdict SMS, so
      // SMSing the ack too = two SMS for one thing. Kept in-app + email only.
      "payment_receipt_received", "listing_submitted", "inspector_application_received",
    ];
    for (const k of mustNotSms) expect(SMS_KINDS.has(k)).toBe(false);
  });

  it("always SMSes the money / outcome-critical kinds", () => {
    // A regression tripwire: if anyone removes one of these from the list, a
    // user stops getting an SMS for something they must act on quickly.
    const mustSms = [
      "kyc_verified", "kyc_rejected",
      "auction_won", "auction_lost", "sixth_offer_awarded",
      "payment_accepted", "payment_rejected", "deposit_refunded",
      "final_payment_due_soon", "final_payment_overdue", "final_payment_defaulted",
      "payout_paid", "payout_rejected",
      "auction_sold_seller", "auction_cancelled",
    ];
    for (const k of mustSms) expect(SMS_KINDS.has(k)).toBe(true);
  });

  it("only caps kinds that are actually SMS-eligible", () => {
    // A capped kind that isn't in SMS_KINDS is dead config (likely a typo) — the
    // cap would never fire for it. CAPPED_KINDS must be a subset of SMS_KINDS.
    const orphans = [...CAPPED_KINDS].filter((k) => !SMS_KINDS.has(k));
    expect(orphans).toEqual([]);
  });

  it("never caps a money/outcome-critical kind (those must never be suppressed)", () => {
    // The cap is only allowed to throttle high-frequency noise. If a critical
    // kind ever ends up capped, an outbid storm could swallow a "you won" SMS.
    const critical = [
      "auction_won", "auction_lost", "sixth_offer_awarded", "payment_accepted",
      "payment_rejected", "deposit_refunded", "kyc_verified", "kyc_rejected",
      "payout_paid", "final_payment_due_soon", "final_payment_overdue",
    ];
    for (const k of critical) expect(CAPPED_KINDS.has(k)).toBe(false);
  });
});
