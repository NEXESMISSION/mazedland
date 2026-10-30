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

// WinSMS "PLAIN" (GSM-7) charset, as far as French needs it: letters, digits,
// the punctuation of a sentence and of a URL, and the accents GSM-7 carries
// (è é à ù É). A message within it bills 160 characters a part; one character
// outside it (Arabic, emoji) makes the operator send the whole message as
// UNICODE, 70 characters a part. We do NOT strip those chars (that silently
// dropped Arabic property titles from outbid/won SMS); instead we detect them
// and tell the caller to send as unicode so the content survives. `\n` is
// GSM-7, so it's allowed.
const HAS_NON_PLAIN = /[^A-Za-z0-9èéàùÉ \n%@"'()_\-.\/:,;<=>?!&$+*#]/;

/** True when `text` has a character outside the plain set — send it with
 *  `unicode: true` (any Arabic text, « », ç…). */
export function needsUnicode(text: string): boolean {
  return HAS_NON_PLAIN.test(text);
}

// What the French templates say with typography, said with the GSM-7 alphabet:
// « » become straight quotes, ’ an apostrophe, the dashes and the middle dot a
// hyphen, a no-break space a space, and the few French letters GSM-7 lacks
// (ç ô ê â î û ë ï œ) lose their mark. Nearly every French notification
// quotes the annonce in « », which alone made it unicode and doubled its
// cost. The bell and the e-mail keep the typography; only the SMS, billed by
// the alphabet, is flattened — and only when flattening makes it plain: an
// Arabic message is unicode whatever we do, so it goes out exactly as written.
const TYPOGRAPHY: [RegExp, string][] = [
  [/«\s?/g, '"'],
  [/\s?»/g, '"'],
  [/[“”„]/g, '"'],
  [/[‘’‚]/g, "'"],
  [/[–—]/g, "-"],
  [/·/g, "-"],
  [/…/g, "..."],
  [/[   ]/g, " "],
];
const LETTERS: Record<string, string> = {
  ç: "c", Ç: "C", ô: "o", Ô: "O", ê: "e", Ê: "E", â: "a", Â: "A", î: "i", Î: "I",
  û: "u", Û: "U", ë: "e", Ë: "E", ï: "i", Ï: "I", œ: "oe", Œ: "OE",
};

/** `text` with the GSM-7 alphabet wherever French typography stood. */
export function toGsmText(text: string): string {
  let out = text;
  for (const [re, to] of TYPOGRAPHY) out = out.replace(re, to);
  return out.replace(/[çÇôÔêÊâÂîÎûÛëËïÏœŒ]/g, (c) => LETTERS[c] ?? c);
}

// The least of a quoted title an SMS keeps before the end of the sentence is
// cut instead.
const TITLE_KEEP = 8;

/**
 * `body` within `room` characters. A quoted annonce title is the one part of
 * the sentence whose length nobody controls, so when the body does not fit
 * the title gives way first — "Appartement S+2 à L..." — and the fact the
 * sentence states (the day of a visit, an expiry date) survives; the end is
 * cut only when even that is not enough. Cutting from the end alone used to
 * lose the visit's day for any title past thirty-five characters.
 */
function fitBody(body: string, room: number): string {
  if (body.length <= room) return body;
  const quoted = /(«\s?|")(.+?)(\s?»|")/.exec(body);
  if (quoted) {
    const [whole, open, inner, close] = quoted;
    const keep = Math.max(TITLE_KEEP, inner.length - (body.length - room) - 3);
    if (keep < inner.length) {
      const short = `${open}${inner.slice(0, keep).trimEnd()}...${close}`;
      body = body.slice(0, quoted.index) + short + body.slice(quoted.index + whole.length);
      if (body.length <= room) return body;
    }
  }
  return body.slice(0, room).trim();
}

/**
 * Build a readable, 4-line SMS for a notification and report whether it must be
 * sent as UNICODE:
 *   {brand}  ← "Mazed Auto" / "Mazed Immo" (sender ID is MAZED for both)
 *   {title}  ← headline ("Identité vérifiée")
 *   {body}   ← detail (the quoted title shortened, then the end cut, to fit)
 *   {url}    ← deep link (kept; body is trimmed first)
 * Length-capped — tighter for unicode, since those bill in 70-char segments.
 */
export function toSmsText(opts: {
  brand: string;
  title: string;
  body?: string | null;
  url?: string | null;
  maxLen?: number;
}): { text: string; unicode: boolean } {
  const { brand, title, body, url, maxLen = 300 } = opts;
  const clean = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();
  const raw = { brand: clean(brand), title: clean(title), body: clean(body), url: clean(url) };
  const flat = { ...raw, brand: toGsmText(raw.brand), title: toGsmText(raw.title), body: toGsmText(raw.body) };
  const unicode = HAS_NON_PLAIN.test(`${flat.brand}\n${flat.title}\n${flat.body}\n${flat.url}`);
  const say = unicode ? raw : flat;
  const cap = unicode ? Math.min(maxLen, 210) : maxLen;
  const tail = say.url ? `\n${say.url}` : "";
  let msg = `${say.brand}\n${say.title}`;
  if (say.body) {
    const room = cap - msg.length - tail.length - 1; // -1 for the body's leading newline
    if (room > 12) msg += `\n${fitBody(say.body, room)}`;
  }
  let out = (msg + tail).trim();
  if (out.length > cap) out = out.slice(0, cap).trim();
  return { text: out, unicode };
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
