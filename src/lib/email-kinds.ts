// Which notification kinds also go out as e-mail — the single source of truth
// for the e-mail drain (/api/cron/notify-email). Kept in its own pure module
// (no server deps) so it can be unit-tested, exactly like sms-kinds.ts.
//
// This set used to live inside the route, and every kind in it was an auction
// kind: a win, a loss, a final payment, a KYC verdict. Not one of them can be
// produced since the pivot, and the kinds that ARE produced — an annonce
// published, refused, about to come down — were not listed. The pipeline ran
// every five minutes with nothing it was allowed to send, and a seller heard
// about their own annonce only by opening the app. The test beside this file
// is what stops that happening again.
//
// Deliberately excluded: on-site acknowledgements the user just triggered
// (`listing_submitted`, `payment_receipt_received` — each is shortly followed
// by a real verdict), broadcasts (announcement / promo / maintenance /
// system_alert — a mass campaign is a deliberate action, not a per-user step),
// and admin queue kinds other than the ones below.
export const EMAIL_KINDS = new Set<string>([
  // A seller's annonce, at every step that changes what they should do.
  "listing_published",
  "listing_approved",
  "listing_rejected",
  "listing_expiring",
  "listing_expired",
  "listing_payment_received",
  "listing_payment_rejected",
  // Money verdicts.
  "payment_accepted",
  "payment_rejected",
  // OPERATIONAL admin alerts — out-of-band delivery (not just the in-app bell)
  // so a receipt waiting in the queue is actioned even when nobody is looking
  // at the dashboard. Low volume.
  "admin_receipt_pending",  // 0032 · a seller sent a receipt
  "admin_email_deadletter", // notify-email exhausted MAX_ATTEMPTS
  "admin_sms_deadletter",   // notify-sms did the same
]);
