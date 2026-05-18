// Tunisia-only manual payment methods. Both flows are offline (user
// pays externally, then uploads a receipt for admin review). The
// difference is purely the instructions shown at checkout — bank wire
// vs. D17 mobile wallet number.
export type PaymentProvider = "bank_transfer" | "d17";

export type PaymentKind =
  | "deposit_lock"
  | "deposit_release"
  | "commission"
  | "inspection_fee"
  | "subscription"
  | "buy_now"
  | "final_payment";

// Receipt-flow payment statuses (DB enum payment_status):
//   - `pending`         : payment row created, no receipt yet
//   - `pending_review`  : buyer uploaded a receipt, awaiting admin
//   - `captured`        : admin accepted the receipt; downstream effects fired
//   - `failed`          : admin rejected the receipt (reason in admin_notes)
//   - `refunded`        : deposit released after auction close
export type PaymentStatus =
  | "pending"
  | "pending_review"
  | "captured"
  | "failed"
  | "refunded";
