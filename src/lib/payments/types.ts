export type PaymentProvider = "konnect" | "paymee" | "flouci" | "d17" | "manual";

export type PaymentKind =
  | "deposit_lock"
  | "deposit_release"
  | "commission"
  | "inspection_fee"
  | "subscription";
