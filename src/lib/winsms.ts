import { log } from "@/lib/log";

/**
 * WinSMS.tn SMS client — the same Tunisian gateway used across the group's
 * other app. Zero deps (just fetch). Plain/Unicode auto-detected by the API;
 * pass unicode:true to force it (Arabic).
 *
 * Fully env-gated: with no WINSMS_API_KEY, isSmsConfigured() is false and the
 * phone-OTP flow degrades to "skip verification" so signup keeps working
 * until the key is added. Never hardcode the key — env only.
 *
 *   WINSMS_API_KEY   = <from winsms.tn dashboard>
 *   WINSMS_SENDER_ID = MAZED            (approved alphanumeric sender)
 */

const WINSMS_BASE = "https://www.winsmspro.com/sms/sms/api";
const sLog = log.scope("winsms");

// WinSMS sits behind a WAF (mod_security) that returns 406 to tool/default
// User-Agents (curl, and Node's default fetch UA). Present a browser UA + a
// permissive Accept so our server-side requests are not blocked.
const WINSMS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const WINSMS_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "User-Agent": WINSMS_UA,
} as const;

export function isSmsConfigured(): boolean {
  return Boolean(process.env.WINSMS_API_KEY);
}

export type WinSMSSendResult =
  | { ok: true; ref?: string; message?: string }
  | { ok: false; error: string };

/** Digits only, as WinSMS expects (e.g. 216XXXXXXXX). */
export function phoneToWinSMS(phone: string): string {
  return phone.replace(/\D/g, "");
}

// WinSMS PLAIN charset — anything outside it flips the whole message to costly
// UNICODE segments (70 chars vs 160). Keep accented French (è é à ù); drop
// everything else (emoji, other accents, Arabic) rather than pay for UNICODE.
// (Newlines are added structurally below, after this strip — LF is GSM-7/PLAIN.)
const SMS_PLAIN = /[^A-Za-z0-9èéàù %@"'()_\-.\/:,;<=>?!&$]/g;

/**
 * Build a readable, PLAIN-charset SMS for a notification. Four lines so it's
 * easy to scan and — crucially — identify which app sent it:
 *
 *   {brand}            ← "Mazed Auto" / "Batta" (sender ID is MAZED for both)
 *   {title}            ← the headline ("Identité vérifiée")
 *   {body}             ← the detail (truncated to fit)
 *   {url}              ← deep link (always kept; body is trimmed first)
 *
 * Length-capped so a long body can't balloon the paid segment count.
 */
export function toSmsText(opts: {
  brand: string;
  title: string;
  body?: string | null;
  url?: string | null;
  maxLen?: number;
}): string {
  const { brand, title, body, url, maxLen = 300 } = opts;
  const clean = (s: string) => (s || "").replace(SMS_PLAIN, "").replace(/\s+/g, " ").trim();
  const tail = url ? `\n${clean(url)}` : "";
  let msg = `${clean(brand)}\n${clean(title)}`;
  const b = clean(body ?? "");
  if (b) {
    const room = maxLen - msg.length - tail.length - 1; // -1 for the body's leading newline
    if (room > 12) msg += `\n${b.length > room ? b.slice(0, room).trim() : b}`;
  }
  return (msg + tail).trim();
}

/** Send one SMS via WinSMS. Returns {ok:false} on any provider error. */
export async function sendSms(params: {
  to: string;
  sms: string;
  from?: string;
  unicode?: boolean;
}): Promise<WinSMSSendResult> {
  const apiKey = process.env.WINSMS_API_KEY;
  const senderId = process.env.WINSMS_SENDER_ID || "MAZED";
  if (!apiKey) return { ok: false, error: "sms_not_configured" };

  const search = new URLSearchParams({
    action: "send-sms",
    api_key: apiKey,
    to: phoneToWinSMS(params.to),
    from: params.from ?? senderId,
    sms: params.sms,
    response: "json",
  });
  if (params.unicode === true) search.set("unicode", "1");

  try {
    const res = await fetch(`${WINSMS_BASE}?${search.toString()}`, {
      method: "GET",
      headers: WINSMS_HEADERS,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // API can return plain text ("OK" / error message).
      if (!res.ok) return { ok: false, error: text || `HTTP ${res.status}` };
      if (text.toUpperCase().includes("OK")) return { ok: true, message: text };
      return { ok: false, error: text || "unknown_response" };
    }
    if (!res.ok) {
      const err =
        (data.error as string) || (data.message as string) || (data.msg as string) || `HTTP ${res.status}`;
      sLog.warn(`send failed: ${String(err)}`);
      return { ok: false, error: String(err) };
    }
    const ref = data.ref ?? data.reference ?? data.messageId;
    return { ok: true, ref: ref != null ? String(ref) : undefined };
  } catch (e) {
    sLog.warn(`send exception: ${String((e as Error)?.message ?? e)}`);
    return { ok: false, error: "exception" };
  }
}

/** Account SMS credit balance (admin diagnostics). Rate-limited 1/30s by WinSMS. */
export async function checkBalance(): Promise<{ ok: true; balance: number } | { ok: false; error: string }> {
  const apiKey = process.env.WINSMS_API_KEY;
  if (!apiKey) return { ok: false, error: "sms_not_configured" };
  try {
    const res = await fetch(
      `${WINSMS_BASE}?action=check-balance&api_key=${encodeURIComponent(apiKey)}&response=json`,
      { method: "GET", headers: WINSMS_HEADERS, signal: AbortSignal.timeout(10_000) },
    );
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { ok: false, error: text || `HTTP ${res.status}` };
    }
    if (!res.ok) return { ok: false, error: String((data.error as string) || text) };
    const balance = Number(data.balance ?? data.solde ?? data.credits ?? 0);
    return { ok: true, balance: Number.isNaN(balance) ? 0 : balance };
  } catch {
    return { ok: false, error: "exception" };
  }
}
