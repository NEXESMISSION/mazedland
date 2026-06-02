import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

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

const MAX_PER_RUN = 50;
const MAX_ATTEMPTS = 5;

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
  if (provided !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // No email provider yet → no-op, leave rows untouched.
  if (!isEmailConfigured()) {
    return NextResponse.json({ ok: true, skipped: "email_not_configured" });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const base = siteUrl();
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const r of rows ?? []) {
    const row = r as {
      id: string;
      user_id: string;
      kind: string;
      title: string | null;
      body: string | null;
      link: string | null;
      email_attempts: number | null;
    };

    // Resolve the recipient's email from auth (profiles doesn't store it).
    const { data: userRes } = await admin.auth.admin.getUserById(row.user_id);
    const to = userRes?.user?.email ?? null;

    if (!to || to.endsWith("@deleted.invalid")) {
      // Recipient gone / anonymised — mark done so we don't retry forever.
      await admin.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", row.id);
      skipped++;
      continue;
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
      await admin.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", row.id);
      sent++;
    } else if (result.skipped) {
      skipped++;
    } else {
      // Best-effort retry counter. Serial loop + 5-min cadence → the simple
      // read+1 is safe here; after MAX_ATTEMPTS the row drops out of the query.
      await admin
        .from("notifications")
        .update({ email_attempts: (row.email_attempts ?? 0) + 1 })
        .eq("id", row.id);
      failed++;
    }
  }

  return NextResponse.json({ ok: true, sent, failed, skipped, scanned: rows?.length ?? 0 });
}

export const GET = run;
export const POST = run;
