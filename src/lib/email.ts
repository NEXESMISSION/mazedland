import { log } from "@/lib/log";

/**
 * Transactional email — thin Resend REST wrapper, zero npm deps (just fetch).
 *
 * Fully env-gated: with no RESEND_API_KEY / EMAIL_FROM configured, sendEmail()
 * is a silent no-op that reports `skipped: true`. That keeps the build and the
 * cron worker safe before the key is added — nothing throws, nothing sends.
 * Set both env vars (and verify the sender domain in Resend) to go live.
 *
 *   RESEND_API_KEY = re_...               (server-only secret)
 *   EMAIL_FROM     = "Batta.tn <no-reply@batta.tn>"
 */

const eLog = log.scope("email");

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export type SendEmailResult = { ok: boolean; skipped?: boolean; error?: string };

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return { ok: false, skipped: true };
  }
  // Don't waste a send on anonymised (deleted) accounts.
  if (!opts.to || opts.to.endsWith("@deleted.invalid")) {
    return { ok: false, skipped: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        ...(opts.text ? { text: opts.text } : {}),
      }),
      // Never let a slow provider hang the cron worker.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      eLog.warn(`resend ${res.status}: ${body.slice(0, 200)}`);
      return { ok: false, error: `http_${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    eLog.warn(`send failed: ${String((e as Error)?.message ?? e)}`);
    return { ok: false, error: "exception" };
  }
}
