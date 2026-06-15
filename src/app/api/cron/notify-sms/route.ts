import { NextRequest, NextResponse } from "next/server";
import { secretMatches } from "@/lib/cron/auth";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { sendSms, isSmsConfigured, toSmsText } from "@/lib/winsms";
import { log } from "@/lib/log";
import { fail } from "@/lib/http/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const cLog = log.scope("cron-sms");

/**
 * Sends an SMS for the IMPORTANT notifications a user must act on quickly
 * (you won / payment due / outbid / a rejection) — IN ADDITION to the in-app
 * bell + email. The notifications table is the shared outbox; this worker
 * claims unsent SMS-eligible rows via claim_smsable_notifications (which also
 * skips opted-out / phoneless recipients), sends via WinSMS, and stamps
 * sms_sent_at. Twin of /api/cron/notify-email.
 *
 * Auth: shared CRON_SECRET (Bearer or ?key=). Safe before WinSMS is configured —
 * it no-ops and leaves rows untouched, so enabling it later only sends the
 * recent backlog (LOOKBACK_DAYS), never the whole history.
 */

// SMS the full user lifecycle — every step a user would want to hear about even
// when not on the site (good news + bad). DELIBERATELY EXCLUDED: high-frequency
// per-bid pings (bid_placed, watched_new_bid, seller_received_bid,
// seller_sixth_offer_received, sixth_offer_placed) — they'd spam; the `welcome`
// kind (the signup OTP SMS already reached them); admin-queue alerts (admin_*,
// the operator dashboard's job); and broadcasts (announcement/promo/maintenance/
// system_alert — a mass campaign is a deliberate action, not a per-user step).
// The per-user daily cap below still bounds an outbid storm.
const SMS_KINDS = new Set([
  // KYC / identity
  "kyc_verified", "kyc_rejected", "kyc_pending_reminder",
  // Auction went live (watchers/depositors + the seller)
  "auction_live", "auction_live_seller",
  // Bidding & buy-now (buyer)
  "outbid", "auction_outbid", "sixth_offer_outbid", "auction_ending_soon",
  "auction_won", "sixth_offer_awarded", "buy_now_initiated",
  // Auction outcome (seller)
  "auction_sold_seller", "auction_finalized_seller", "reserve_not_met",
  "auction_ended_unsold", "auction_cancelled",
  // Payments (buyer)
  "payment_accepted", "payment_rejected", "payment_receipt_received",
  "deposit_refunded",
  // Final payment (buyer + seller)
  "final_payment_due_soon", "final_payment_due_tomorrow",
  "final_payment_overdue", "final_payment_overdue_seller",
  "final_payment_defaulted",
  // Listings (seller)
  "listing_submitted", "listing_published", "listing_approved",
  "listing_rejected", "listing_payment_rejected", "listing_expired",
  "listing_unscheduled_reminder",
  // Payouts (seller)
  "payout_processing", "payout_paid", "payout_rejected",
  // Inspections
  "inspection_requested", "inspection_assigned", "inspection_scheduled",
  "inspection_completed",
  // Inspector onboarding
  "inspector_application_received", "inspector_approved",
]);

// SMS-tuned, tighter than email (each message costs real operator money).
const MAX_PER_RUN = 100;
const MAX_ATTEMPTS = 3;
const CONCURRENCY = 4;
const LOOKBACK_DAYS = 2; // stale SMS is pointless; never blast old rows
const PER_USER_DAILY = 6; // cap SMS per user / 24h (anti-spam + cost)

// First line of every SMS so the user can tell which app sent it (the sender ID
// is MAZED for both apps, so the body must carry the brand).
const BRAND = "Batta";

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://batta.tn")
  ).replace(/\/$/, "");
}

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron_secret_not_set" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : key;
  if (!secretMatches(provided, secret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }
  // Bind the narrowed (non-null) client so the per-row closure keeps narrowing.
  const db = admin;

  // Heartbeat: stamp on every successful run so /api/health surfaces a stalled
  // SMS drain. SMS is additive (email + in-app remain), so a stale SMS heartbeat
  // is a warning, not a money-critical outage like the email drain.
  const stampHeartbeat = () =>
    db.rpc("stamp_cron_heartbeat", { p_job: "notify_sms", p_max_age: 1800 }).then(() => {}, () => {});

  // No WinSMS key yet → no-op, but the worker itself is alive.
  if (!isSmsConfigured()) {
    await stampHeartbeat();
    return NextResponse.json({ ok: true, skipped: "sms_not_configured" });
  }

  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  // Atomic claim (twin of claim_emailable_notifications): SELECT … FOR UPDATE
  // SKIP LOCKED + sms_attempts++ in ONE statement, so overlapping runs grab
  // DISJOINT rows (no double-send / double-charge). The RPC also filters to
  // recipients who have a phone and haven't opted out.
  const { data: rows, error } = await db.rpc("claim_smsable_notifications", {
    p_limit: MAX_PER_RUN,
    p_kinds: Array.from(SMS_KINDS),
    p_since: sinceIso,
    p_max_attempts: MAX_ATTEMPTS,
  });
  if (error) {
    cLog.error(`claim failed: ${error.message}`);
    return fail("fetch_failed", 500, error);
  }

  type Row = {
    id: string;
    user_id: string;
    kind: string;
    title: string | null;
    body: string | null;
    link: string | null;
    sms_attempts: number | null;
  };
  const all = (rows ?? []) as Row[];

  // Batch-resolve phones for the claimed rows. Every claimed row has a phone +
  // opt-in (the claim's EXISTS gate), but the claim returns the notification
  // row, not the phone — so one IN(...) query, mapped by user.
  const userIds = Array.from(new Set(all.map((r) => r.user_id)));
  const phoneByUser = new Map<string, string>();
  if (userIds.length) {
    const { data: profs } = await db.from("profiles").select("id, phone").in("id", userIds);
    for (const p of profs ?? []) if (p.phone) phoneByUser.set(p.id as string, p.phone as string);
  }

  const base = siteUrl();
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let deadLettered = 0;

  async function processRow(row: Row): Promise<"sent" | "failed" | "skipped" | "deadletter"> {
    const phone = phoneByUser.get(row.user_id);
    if (!phone) {
      // Phone vanished between claim and send (opt-out / deletion race) — mark
      // done so we don't retry forever.
      await db.from("notifications").update({ sms_sent_at: new Date().toISOString() }).eq("id", row.id);
      return "skipped";
    }

    // Per-user daily cap (anti-spam + cost). check_rate_limit records a hit when
    // under the cap and returns true once over it. On cap-hit we SUPPRESS (stamp
    // sms_sent_at) rather than retry: the user still has the in-app bell + email,
    // and an outbid storm can't burn the SMS credit.
    const { data: capped } = await db.rpc("check_rate_limit", {
      p_key: `sms:${row.user_id}`,
      p_max: PER_USER_DAILY,
      p_window_secs: 86400,
    });
    if (capped === true) {
      await db.from("notifications").update({ sms_sent_at: new Date().toISOString() }).eq("id", row.id);
      return "skipped";
    }

    const url = row.link ? `${base}/fr${row.link.startsWith("/") ? "" : "/"}${row.link}` : null;
    const result = await sendSms({
      to: phone,
      sms: toSmsText({ brand: BRAND, title: row.title ?? BRAND, body: row.body, url }),
    });

    if (result.ok) {
      await db.from("notifications").update({ sms_sent_at: new Date().toISOString() }).eq("id", row.id);
      return "sent";
    }
    // Already claimed (sms_attempts incremented atomically by the claim RPC), so
    // we do NOT bump it again. If the claimed value hit the cap, this row will
    // never be re-claimed → dead letter; otherwise it stays for a later retry.
    return (row.sms_attempts ?? 0) >= MAX_ATTEMPTS ? "deadletter" : "failed";
  }

  // Bounded-concurrency chunks, oldest-first preserved across chunks.
  for (let i = 0; i < all.length; i += CONCURRENCY) {
    const outcomes = await Promise.all(all.slice(i, i + CONCURRENCY).map(processRow));
    for (const o of outcomes) {
      if (o === "sent") sent++;
      else if (o === "failed") failed++;
      else if (o === "deadletter") { failed++; deadLettered++; }
      else skipped++;
    }
  }

  // Dead-letter alert: an important SMS that exhausted MAX_ATTEMPTS will never be
  // retried. Raise ONE aggregated admin notification + a loud log so an operator
  // can check the WinSMS credit/provider.
  if (deadLettered > 0) {
    cLog.error(`DEAD_LETTER: ${deadLettered} important SMS permanently failed (>=${MAX_ATTEMPTS} attempts)`);
    await db
      .rpc("_notify_admins", {
        p_kind: "admin_sms_deadletter",
        p_title: "SMS non délivrés",
        p_body:
          `${deadLettered} SMS important(s) (gagnant / paiement / surenchère) ont échoué après ` +
          `${MAX_ATTEMPTS} tentatives et ne seront plus réessayés. Vérifiez le crédit et le fournisseur WinSMS.`,
        p_link: "/admin",
      })
      .then(() => {}, () => {});
  }

  await stampHeartbeat();
  return NextResponse.json({ ok: true, sent, failed, skipped, deadLettered, scanned: all.length });
}

export const GET = run;
export const POST = run;
