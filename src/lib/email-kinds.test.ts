import { describe, it, expect } from "vitest";
import { EMAIL_KINDS } from "./email-kinds";
import { SMS_KINDS } from "./sms-kinds";

/**
 * Every step of a seller's annonce that the product can actually produce.
 * `enqueue_notification` is called with these kinds from the admin moderation
 * route, the submit/renew routes and `expire_listings()`.
 *
 * The point of pinning them here: the drain's allow-list is easy to leave
 * behind when the product changes, and when it is left behind nothing fails —
 * the cron returns 200, the queue drains, and the mail is silently never sent.
 */
const LISTING_LIFECYCLE = [
  "listing_published",
  "listing_rejected",
  "listing_expiring",
  "listing_expired",
  "listing_payment_received",
];

/** Retired with the auction product (0153). None can be produced. */
const AUCTION_ONLY = [
  "auction_won",
  "auction_lost",
  "auction_sold_seller",
  "outbid",
  "final_payment_due_soon",
  "final_payment_overdue",
  "kyc_verified",
  "kyc_rejected",
  "deposit_refunded",
  "payout_paid",
];

describe("EMAIL_KINDS", () => {
  it("e-mails every step of an annonce a seller needs to act on", () => {
    for (const k of LISTING_LIFECYCLE) expect(EMAIL_KINDS.has(k)).toBe(true);
  });

  it("e-mails the money verdicts", () => {
    for (const k of ["payment_accepted", "payment_rejected"]) {
      expect(EMAIL_KINDS.has(k)).toBe(true);
    }
  });

  it("does not e-mail on-site acknowledgements or broadcasts", () => {
    for (const k of [
      "listing_submitted",
      "payment_receipt_received",
      "announcement",
      "promo",
      "maintenance",
      "system_alert",
    ]) {
      expect(EMAIL_KINDS.has(k)).toBe(false);
    }
  });

  it("carries no kind the auction product took with it", () => {
    expect(AUCTION_ONLY.filter((k) => EMAIL_KINDS.has(k))).toEqual([]);
  });
});

describe("the two channels together", () => {
  it("reach the seller about their annonce by at least one route", () => {
    for (const k of LISTING_LIFECYCLE) {
      expect(EMAIL_KINDS.has(k) || SMS_KINDS.has(k)).toBe(true);
    }
  });

  it("SMS the J-3 warning — the one message that stops a paid annonce going dark", () => {
    expect(SMS_KINDS.has("listing_expiring")).toBe(true);
  });

  it("never SMS an admin kind that e-mail already carries", () => {
    const admin = [...EMAIL_KINDS].filter((k) => k.startsWith("admin_"));
    expect(admin.length).toBeGreaterThan(0);
    expect(admin.filter((k) => SMS_KINDS.has(k))).toEqual([]);
  });
});
