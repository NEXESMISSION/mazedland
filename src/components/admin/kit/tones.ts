/**
 * The console's status vocabulary — one place that decides what a status
 * means and what colour it wears.
 *
 * Before this, every queue answered both questions for itself: `published`
 * was emerald on one screen and gold on the next, `pending_review` was
 * "En attente" here and "À valider" there, and the colours were raw Tailwind
 * palette classes (`bg-emerald-50`, `bg-red-50`) — light-mode swatches on a
 * near-black ground, which is most of why the console looked broken.
 *
 * Everything that renders a status now goes through `statusTone()` and
 * `statusLabel()`, so a "Publiée" pill is the same pill on the annonces
 * queue, the seller desk and the dashboard.
 */

/** Semantic tones. Deliberately not named after colours — a tone is a
 *  meaning, and the palette behind it is free to change once, here. */
export type Tone = "ok" | "warn" | "bad" | "info" | "neutral";

/**
 * Tailwind classes per tone, every value a theme token.
 *
 * These were inline hex, picked by eye against Auto's near-black ground. That
 * held until the same kit had to render on Mazed Land, which is dark text on
 * white with a navy accent: `#5cc98a` on `#ffffff` is a washed-out green that
 * fails contrast, and a gold-tinted row is simply wrong on a navy product.
 *
 * The class names are now identical in both products and the values come from
 * `globals.css` — the same arrangement that lets `--gold` hold metallic gold
 * here and blue-900 there. Porting the kit is a file copy; the colours follow
 * the theme it lands in.
 */
export const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-[var(--tone-ok-bg)] text-[var(--tone-ok)] ring-[var(--tone-ok-ring)]",
  warn: "bg-[var(--tone-warn-bg)] text-[var(--tone-warn)] ring-[var(--tone-warn-ring)]",
  bad: "bg-[var(--tone-bad-bg)] text-[var(--tone-bad)] ring-[var(--tone-bad-ring)]",
  info: "bg-[var(--gold-faint)] text-[var(--gold)] ring-[var(--tone-info-ring)]",
  neutral: "bg-surface-2 text-muted ring-border",
};

/** Same tones as a bare foreground colour, for numbers and icons. */
export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-[var(--tone-ok)]",
  warn: "text-[var(--tone-warn)]",
  bad: "text-[var(--tone-bad)]",
  info: "text-[var(--gold)]",
  neutral: "text-muted",
};

/**
 * Every status the console can render, across `listing_status`,
 * `payment_status` and `user_role`. Keys are the raw DB values; nothing else
 * in the admin should translate them.
 *
 * The auction-era statuses (`ready`, `ended_sold`, `sixth_offer_window`…) are
 * deliberately absent: their tables hold zero rows, and a label here would be
 * an invitation to build another screen on top of them.
 */
const STATUS_TONE: Record<string, Tone> = {
  // listing_status
  draft: "neutral",
  pending_payment: "warn",
  pending_review: "warn",
  published: "ok",
  rejected: "bad",
  expired: "neutral",
  archived: "neutral",
  sold: "info",

  // payment_status — `pending_review` is shared with listings above and means
  // the same thing to an admin: a human has to look at it.
  pending: "warn",
  authorized: "info",
  captured: "ok",
  refunded: "neutral",
  failed: "bad",

  // user_role — bank / bailiff / inspector are dropped in v3 (PIVOT-PLAN D6).
  individual: "neutral",
  agency: "info",
  admin: "info",
};

/** The `payment_kind` values the console names. The retired auction kinds are
 *  omitted for the same reason as the auction statuses. */
const PAYMENT_KINDS = new Set(["listing_fee", "listing_pack", "subscription", "promo", "badge", "renewal"]);

export function statusTone(status: string | null | undefined): Tone {
  return (status && STATUS_TONE[status]) || "neutral";
}

// ─── Words, in the reader's language ────────────────────────────────────────
//
// Through the `admin` messages (`admin.status.*`, `admin.paymentKind.*`), so an
// Arabic page gets Arabic. "—" for nothing; the raw value for something
// unlabelled — an unlabelled status on screen is a bug report, and hiding it
// makes it unreportable.

/**
 * A translator bound to the `admin` namespace — `useTranslations("admin")` in
 * a component, `await getTranslations("admin")` in an async server component.
 */
export type AdminTranslator = { (key: string): string; has(key: string): boolean };

export function statusText(t: AdminTranslator, status: string | null | undefined): string {
  if (!status) return "—";
  return Object.prototype.hasOwnProperty.call(STATUS_TONE, status) ? t(`status.${status}`) : status;
}

export function paymentKindText(t: AdminTranslator, kind: string | null | undefined): string {
  if (!kind) return "—";
  return PAYMENT_KINDS.has(kind) ? t(`paymentKind.${kind}`) : kind;
}
