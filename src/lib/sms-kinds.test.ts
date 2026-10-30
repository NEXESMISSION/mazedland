import { describe, it, expect } from "vitest";
import { SMS_KINDS, CAPPED_KINDS, UNCAPPED_KINDS, forSms } from "./sms-kinds";

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

  it("exempts only kinds that are actually SMS-eligible", () => {
    // An exemption for a kind that never goes out as SMS is dead config too.
    const orphans = [...UNCAPPED_KINDS].filter((k) => !SMS_KINDS.has(k));
    expect(orphans).toEqual([]);
  });

  it("never caps a money/outcome-critical kind (those must never be suppressed)", () => {
    // The cap is only allowed to throttle what arrives in bulk. If a critical
    // kind ever ends up capped, a bulk approval could swallow a payment SMS.
    const critical = [
      "auction_won", "auction_lost", "sixth_offer_awarded", "payment_accepted",
      "payment_rejected", "deposit_refunded", "kyc_verified", "kyc_rejected",
      "payout_paid", "final_payment_due_soon", "final_payment_overdue",
      "listing_rejected", "shop_approved", "shop_rejected", "plan_expiring", "visit_confirmed",
    ];
    for (const k of critical) expect(CAPPED_KINDS.has(k)).toBe(false);
  });

  it("caps what the site sends in bulk today", () => {
    // The cap once named six auction kinds that nothing produces any more, so
    // thirty annonces approved at once were thirty SMS. Every kind that can
    // arrive in bulk for one person must be under it.
    const bulk = [
      "listing_published", "listing_approved", "listing_expiring", "listing_expired",
      "visit_requested", "visit_declined", "visit_cancelled",
    ];
    for (const k of bulk) expect(CAPPED_KINDS.has(k)).toBe(true);
    // Every SMS kind is on exactly one side.
    for (const k of SMS_KINDS) expect(CAPPED_KINDS.has(k) !== UNCAPPED_KINDS.has(k)).toBe(true);
  });
});

describe("forSms", () => {
  const visitor = "Un acheteur";

  it("names the buyer generically on a visit request and a cancellation", () => {
    const row = {
      kind: "visit_requested",
      title: "Demande de visite",
      body: "Appelez le 20123456 urgent souhaite visiter « Villa ».",
      payload: { vars: { title: "Villa", name: "Appelez le 20123456 urgent", count: 2 } },
    };
    expect(forSms(row, visitor).payload).toEqual({ vars: { title: "Villa", name: visitor, count: 2 } });
    const cancelled = { ...row, kind: "visit_cancelled" };
    expect((forSms(cancelled, visitor).payload as { vars: { name: string } }).vars.name).toBe(visitor);
  });

  it("drops the body of a row whose stored text is the only place the name is", () => {
    const old = { kind: "visit_requested", title: "Demande de visite", body: "X souhaite visiter « Villa ».", payload: {} };
    expect(forSms(old, visitor)).toEqual({ ...old, body: null });
  });

  it("keeps the seller's note out of the answer", () => {
    const confirmed = {
      kind: "visit_confirmed",
      title: "Visite confirmée",
      body: "x",
      payload: { vars: { title: "Villa", visit_day: "2026-11-02", visit_part: "afternoon", note: "Versez 200 DT", variant: "with_note" } },
    };
    const out = forSms(confirmed, visitor).payload as { vars: Record<string, string> };
    expect(out.vars.variant).toBe("plain");
    expect(out.vars.note).toBe("");
    expect(out.vars.visit_day).toBe("2026-11-02");
    const declined = { ...confirmed, kind: "visit_declined" };
    expect((forSms(declined, visitor).payload as { vars: Record<string, string> }).vars.variant).toBe("plain");
  });

  it("leaves every other kind as it is", () => {
    const published = { kind: "listing_published", title: "x", body: "y", payload: { vars: { title: "Villa", name: "kept" } } };
    expect(forSms(published, visitor)).toBe(published);
    const plain = { kind: "visit_confirmed", title: "x", body: "y", payload: { vars: { title: "Villa", note: "", variant: "plain" } } };
    expect(forSms(plain, visitor)).toBe(plain);
  });
});
