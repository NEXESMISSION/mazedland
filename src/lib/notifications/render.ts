import { formatTND } from "@/lib/utils";

/**
 * A notification's title and body in the reader's language.
 *
 * Producers store the values their sentence interpolates under
 * `payload.vars` (migration 0164 for the SQL producers; the API routes pass
 * them too). The text itself lives in messages/{fr,ar}.json under
 * `notifications.<kind>` — or `notifications.<kind>.<variant>` when one kind
 * has several wordings — so the bell renders in the language the reader has
 * open and the SMS / e-mail drains in the recipient's profile language.
 *
 * A row written before payloads existed, or of a kind with no template
 * (admin broadcasts are typed by an admin), keeps its stored title and body.
 *
 * `t` is a translator scoped to the `notifications` namespace:
 * `useTranslations("notifications")` in the bell,
 * `getTranslations({ locale, namespace: "notifications" })` on the server.
 */
export type RenderableNotification = {
  kind: string;
  title: string;
  body: string | null;
  payload?: unknown;
};

type StringTranslator = {
  (key: string, values?: Record<string, string | number | Date>): string;
  has(key: string): boolean;
};

/**
 * Any next-intl translator. Typed translators narrow `key` to their literal
 * keys, so they are not assignable to a `(key: string)` signature; `never`
 * accepts all of them, and the keys built below are cast back to strings.
 */
type AnyTranslator = {
  (key: never, values?: never): string;
  has(key: never): boolean;
};

// Dates are shown in Tunisian time whatever the server's clock says (Vercel
// runs in UTC; a 23:30 expiry would otherwise read as the next day).
const TZ = "Africa/Tunis";

function dateParts(iso: string, locale: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const tag = locale === "ar" ? "ar-TN" : "fr-TN";
  return {
    /** 06/10 — what the French notifications have always said. */
    short: d.toLocaleDateString(tag, { day: "2-digit", month: "2-digit", timeZone: TZ }),
    /** 06/10/2026 */
    full: d.toLocaleDateString(tag, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ }),
  };
}

export function renderNotification(
  n: RenderableNotification,
  translator: AnyTranslator,
  locale: string,
): { title: string; body: string | null } {
  const t = translator as unknown as StringTranslator;
  const stored = { title: n.title, body: n.body };
  const payload = n.payload && typeof n.payload === "object" ? (n.payload as Record<string, unknown>) : null;
  const vars = payload?.vars && typeof payload.vars === "object" ? (payload.vars as Record<string, unknown>) : null;
  if (!vars) return stored;

  const variant = typeof vars.variant === "string" ? vars.variant : null;
  const base = variant ? `${n.kind}.${variant}` : n.kind;
  if (!t.has(`${base}.title`)) return stored;

  const values: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (k === "variant" || v === null || v === undefined) continue;
    if (typeof v === "number" || typeof v === "string") values[k] = v;
  }
  if (typeof vars.expires_at === "string") {
    const parts = dateParts(vars.expires_at, locale);
    if (parts) {
      values.date = parts.short;
      values.fullDate = parts.full;
    }
  }
  if (vars.amount !== undefined && vars.amount !== null && Number.isFinite(Number(vars.amount))) {
    values.amount = formatTND(Number(vars.amount), locale);
  }
  if (typeof vars.paymentKind === "string") {
    const key = `paymentKinds.${vars.paymentKind}`;
    values.what = t.has(key) ? t(key) : t("paymentKinds.other");
  }
  for (const k of ["count", "quota", "remaining", "attempts"]) {
    if (values[k] !== undefined) values[k] = Number(values[k]);
  }

  try {
    return {
      title: t(`${base}.title`, values),
      body: t.has(`${base}.body`) ? t(`${base}.body`, values) : stored.body,
    };
  } catch {
    // A template whose placeholder the payload cannot fill: say what was stored.
    return stored;
  }
}
