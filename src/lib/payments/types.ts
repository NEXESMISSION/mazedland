// Tunisia-only manual payment methods. Both flows are offline (the payer sends
// the money outside the site, then uploads a receipt for admin review). The
// difference is purely the instructions shown at checkout — bank wire vs. D17
// mobile wallet number.
export type PaymentProvider = "bank_transfer" | "d17";

// `PaymentKind` used to live here and listed the auction product's kinds —
// deposit_lock, buy_now, final_payment, inspection_fee… Its only consumer was
// /api/payments/initiate, which created inspection-fee payments against the
// retired `inspections` table and had no caller left. Both are gone; the kinds
// a payment can have today are the DB enum's (listing_fee, listing_pack,
// promo, badge, renewal).

// Receipt-flow payment statuses (DB enum payment_status):
//   - `pending`         : payment row created, no receipt yet
//   - `pending_review`  : receipt uploaded, awaiting admin review
//   - `captured`        : admin accepted the receipt; downstream effects fired
//   - `failed`          : admin rejected the receipt (reason in admin_notes)
//   - `refunded`        : money returned by an admin
export type PaymentStatus =
  | "pending"
  | "pending_review"
  | "captured"
  | "failed"
  | "refunded";
