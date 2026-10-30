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
 * (admin broadcasts are typed by an admin), keeps its stored title and body
 * — unless the admin also typed it in the reader's language: a broadcast
 * carries that copy under `payload.i18n.<locale>`, each field falling back
 * to the stored one.
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

/**
 * The title and body an admin typed for this locale, when a broadcast
 * carries them (`payload.i18n.ar.title` …); an empty field is left to the
 * stored one.
 */
function typedCopy(payload: Record<string, unknown> | null, locale: string): { title?: string; body?: string } {
  const i18n = payload?.i18n && typeof payload.i18n === "object" ? (payload.i18n as Record<string, unknown>) : null;
  const mine = i18n?.[locale] && typeof i18n[locale] === "object" ? (i18n[locale] as Record<string, unknown>) : null;
  const out: { title?: string; body?: string } = {};
  if (typeof mine?.title === "string" && mine.title.trim()) out.title = mine.title;
  if (typeof mine?.body === "string" && mine.body.trim()) out.body = mine.body;
  return out;
}

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
  const payload = n.payload && typeof n.payload === "object" ? (n.payload as Record<string, unknown>) : null;
  const stored = { title: n.title, body: n.body, ...typedCopy(payload, locale) };
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
  // A visit (0174): the day and the half-day, in the reader's words —
  // « mercredi 28 octobre · le matin ».
  if (typeof vars.visit_day === "string") {
    const d = new Date(`${vars.visit_day}T12:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      const day = d.toLocaleDateString(locale === "ar" ? "ar-TN" : "fr-TN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: TZ,
      });
      const partKey = `visitParts.${String(vars.visit_part ?? "")}`;
      values.when = t.has(partKey) ? `${day} · ${t(partKey)}` : day;
    }
  }
  if (vars.amount !== undefined && vars.amount !== null && Number.isFinite(Number(vars.amount))) {
    values.amount = formatTND(Number(vars.amount), locale);
  }
  // What was paid for, in the three forms a French sentence needs: the bare
  // noun, « d'abonnement » / « de frais d'annonce », « pour votre abonnement ».
  if (typeof vars.paymentKind === "string") {
    for (const [name, map] of [["what", "paymentKinds"], ["ofWhat", "paymentKindsOf"], ["forWhat", "paymentKindsFor"]]) {
      const key = `${map}.${vars.paymentKind}`;
      values[name] = t.has(key) ? t(key) : t(`${map}.other`);
    }
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
