import { NextRequest, NextResponse } from "next/server";
import { secretMatches } from "@/lib/cron/auth";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { log } from "@/lib/log";
import { fail } from "@/lib/http/errors";

export const dynamic = "force-dynamic";
// Give the worker real headroom: a Resend latency spike must not kill the
// run mid-batch under the platform-default timeout (which was leaving rows
// half-processed). 60s is within the Vercel Pro ceiling.
export const maxDuration = 60;

const cLog = log.scope("cron-mail");

/**
 * Emails the high-value notifications a user must act on outside the app
 * (you won / payment due / payment verdict / KYC verdict / your item sold).
 *
 * The notifications table IS the outbox: this worker scans for unsent
 * emailable rows, sends via Resend, and stamps emailed_at. Covers every
 * notification source — SQL triggers and TS routes alike — because they all
 * land in that one table.
 *
 * Auth: shared `CRON_SECRET` (Bearer or ?key=), same as the tick cron.
 * Schedule: Vercel Cron (see vercel.json). Safe before email is configured —
 * it no-ops and leaves rows untouched, so adding the key later only sends the
 * recent backlog (last 24h), never the whole history.
 */

// Kinds worth an email. Deliberately excludes high-frequency noise like
// `outbid` (would spam) and admin broadcast kinds.
const EMAILABLE = new Set([
  "auction_won",
  "auction_sold_seller",
  "final_payment_due_soon",
  "final_payment_due_tomorrow",
  "final_payment_overdue",
  "payment_accepted",
  "payment_rejected",
  "kyc_verified",
  "kyc_rejected",
]);

// Drain a close/broadcast wave fast enough that nothing money-critical ages
// out. 200/run with the */5 cron ≈ 2,400 emails/hr, vs the old 300/hr that
// silently dropped same-day winner/payment emails past the 24h cutoff.
const MAX_PER_RUN = 200;
const MAX_ATTEMPTS = 5;
// Process rows concurrently (each does getUserById + send + stamp); a serial
// loop was the other timeout vector.
const CONCURRENCY = 8;
// Safety net only — bound how far back we look so first-time email enablement
// can't blast ancient history. Far wider than the old 24h so that under
// normal operation a row is bounded by MAX_ATTEMPTS, never by age.
const LOOKBACK_DAYS = 7;

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://batta.tn")
  ).replace(/\/$/, "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(title: string, body: string, href: string | null): string {
  const cta = href
    ? `<a href="${href}" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#c9a227;color:#111;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px">Voir sur Batta.tn</a>`
    : "";
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#0e0e10;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#17171b;border:1px solid #2a2a30;border-radius:16px;padding:28px">
      <div style="font-size:18px;font-weight:800;color:#c9a227;letter-spacing:.5px">Batta.tn</div>
      <h1 style="font-size:18px;color:#f5f5f5;margin:18px 0 8px">${escapeHtml(title)}</h1>
      <p style="font-size:14px;line-height:1.6;color:#c8c8cc;margin:0">${escapeHtml(body)}</p>
      ${cta}
      <p style="font-size:11px;color:#75757c;margin:24px 0 0">Vous recevez cet e-mail car vous avez un compte sur Batta.tn.</p>
    </div></body></html>`;
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
  // Bind the narrowed (non-null) client so the per-row closure below keeps the
  // narrowing — TS drops it for a captured `const` inside a nested function.
  const db = admin;

  // Heartbeat: this worker is the ONLY delivery path for money-critical email
  // (auction_won / final_payment_due / payment & KYC verdicts). Stamp on every
  // successful run so /api/health (per-job budget = 1800s ≈ 3 missed */10 runs)
  // turns a stalled drain — which silently costs a buyer their deposit — into a
  // visible 503. Stamped on SUCCESS paths only: a fetch error returns before the
  // stamp, so the heartbeat correctly ages out and is detected.
  const stampHeartbeat = () =>
    db
      .rpc("stamp_cron_heartbeat", { p_job: "notify_email", p_max_age: 1800 })
      .then(() => {}, () => {});

  // No email provider yet → no-op, but the worker itself is alive.
  if (!isEmailConfigured()) {
    await stampHeartbeat();
    return NextResponse.json({ ok: true, skipped: "email_not_configured" });
  }

  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await admin
    .from("notifications")
    .select("id, user_id, kind, title, body, link, email_attempts")
    .is("emailed_at", null)
    .lt("email_attempts", MAX_ATTEMPTS)
    .gte("created_at", sinceIso)
    .in("kind", Array.from(EMAILABLE))
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);

  if (error) {
    cLog.error(`select failed: ${error.message}`);
    return fail("fetch_failed", 500, error);
  }

  const base = siteUrl();
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let deadLettered = 0;

  type Row = {
    id: string;
    user_id: string;
    kind: string;
    title: string | null;
    body: string | null;
    link: string | null;
    email_attempts: number | null;
  };

  async function processRow(row: Row): Promise<"sent" | "failed" | "skipped" | "deadletter"> {
    // Resolve the recipient's email from auth (profiles doesn't store it).
    const { data: userRes } = await db.auth.admin.getUserById(row.user_id);
    const to = userRes?.user?.email ?? null;

    if (!to || to.endsWith("@deleted.invalid")) {
      // Recipient gone / anonymised — mark done so we don't retry forever.
      await db.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", row.id);
      return "skipped";
    }

    const title = row.title ?? "Notification Batta.tn";
    const body = row.body ?? "";
    const href = row.link ? `${base}/fr${row.link.startsWith("/") ? "" : "/"}${row.link}` : null;

    const result = await sendEmail({
      to,
      subject: title,
      html: renderHtml(title, body, href),
      text: href ? `${body}\n\n${href}` : body,
    });

    if (result.ok) {
      await db.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", row.id);
      return "sent";
    }
    if (result.skipped) return "skipped";

    // Best-effort retry counter; after MAX_ATTEMPTS the row drops out of the
    // query. (Per-row, so concurrent rows never touch the same counter.) When
    // this attempt is the LAST one, the row becomes a dead letter — a
    // money-critical email that will never be retried — so flag it for the
    // aggregated admin alert below.
    const nextAttempts = (row.email_attempts ?? 0) + 1;
    await db
      .from("notifications")
      .update({ email_attempts: nextAttempts })
      .eq("id", row.id);
    return nextAttempts >= MAX_ATTEMPTS ? "deadletter" : "failed";
  }

  // Process in bounded-concurrency chunks, preserving oldest-first ordering
  // across chunks. Sends fan out CONCURRENCY-wide so one slow Resend call
  // can't serialize the whole batch into a timeout.
  const all = (rows ?? []) as Row[];
  for (let i = 0; i < all.length; i += CONCURRENCY) {
    const outcomes = await Promise.all(all.slice(i, i + CONCURRENCY).map(processRow));
    for (const o of outcomes) {
      if (o === "sent") sent++;
      else if (o === "failed") failed++;
      else if (o === "deadletter") { failed++; deadLettered++; }
      else skipped++;
    }
  }

  // Dead-letter alert: a money-critical email that exhausted MAX_ATTEMPTS will
  // never be retried (it drops out of the query). Previously this was silent —
  // the exact failure that costs a buyer their deposit. Raise ONE aggregated
  // admin alert + a loud structured log so the operator can act (check the
  // email provider, contact the affected users out-of-band).
  if (deadLettered > 0) {
    cLog.error(`DEAD_LETTER: ${deadLettered} money-critical email(s) permanently failed (>=${MAX_ATTEMPTS} attempts)`);
    await db
      .rpc("_notify_admins", {
        p_kind: "admin_email_deadletter",
        p_title: "E-mails non délivrés",
        p_body:
          `${deadLettered} e-mail(s) critiques (gagnant d'enchère / paiement / KYC) ont échoué après ` +
          `${MAX_ATTEMPTS} tentatives et ne seront plus réessayés. Vérifiez le fournisseur d'e-mail ` +
          `et contactez les utilisateurs concernés.`,
        p_link: "/admin",
      })
      .then(() => {}, () => {});
  }

  await stampHeartbeat();
  return NextResponse.json({ ok: true, sent, failed, skipped, deadLettered, scanned: all.length });
}

export const GET = run;
export const POST = run;
