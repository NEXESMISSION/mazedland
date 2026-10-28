import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a TND amount with locale-correct grouping. The plan caps prices in
 * the millions, so we never need decimals — properties trade in whole dinars.
 *
 * ar-TN groups thousands with a dot, but in Tunisia a dot separates dinars
 * from millimes: "350.000 د.ت" reads as 350 dinars. Arabic amounts keep the
 * ar-TN Latin digits and compact words but group with a space, like French.
 */
export function formatTND(
  amount: number,
  locale: string = "fr-TN",
  options: { compact?: boolean } = {},
) {
  return groupForTunisia(
    intlTag(locale),
    new Intl.NumberFormat(intlTag(locale), {
      style: "decimal",
      maximumFractionDigits: 0,
      notation: options.compact ? "compact" : "standard",
    }),
    amount,
  );
}

/**
 * A whole number grouped with a space — 13 000 in French and in Tunisian
 * Arabic alike (Latin digits either way) — for surfaces and counts. A dot
 * would read as a decimal: « 1.200 م² » looks like one square metre.
 */
export function formatNumber(value: number, locale: string = "fr"): string {
  return groupForTunisia(intlTag(locale), new Intl.NumberFormat(intlTag(locale), { maximumFractionDigits: 0 }), value);
}

/**
 * Format with the locale's words and digits, but group thousands with a
 * no-break space when ar-TN would use a dot: in Tunisia a dot separates
 * dinars from millimes, so « 350.000 د.ت » reads as 350 dinars.
 */
function groupForTunisia(tag: string, format: Intl.NumberFormat, value: number): string {
  const parts = format.formatToParts(value);
  return readableSpaces(parts.map((p) => (tag === "ar-TN" && p.type === "group" ? "\u00a0" : p.value)).join(""));
}

/**
 * The Intl tag for an app locale. Accepts the app's own codes ("fr", "ar") and
 * full tags already in use ("fr-TN", "fr-FR"), so older call sites keep working.
 * ar-TN gives Latin digits and Tunisian month names.
 */
export function intlTag(locale: string): string {
  if (locale === "ar" || locale.startsWith("ar-")) return "ar-TN";
  if (locale === "en" || locale.startsWith("en-")) return "en-US";
  return "fr-TN";
}

/** The site's clock: Tunisia, UTC+1 all year. */
export const SITE_TIME_ZONE = "Africa/Tunis";

const DATE_PRESETS = {
  /** 6 octobre 2026 · 6 أكتوبر 2026 */
  long: { day: "numeric", month: "long", year: "numeric" },
  /** 6 oct. 2026 */
  medium: { day: "numeric", month: "short", year: "numeric" },
  /** 06/10/2026 */
  short: { day: "2-digit", month: "2-digit", year: "numeric" },
  /** 6 oct. · 6 أكتوبر */
  dayMonth: { day: "numeric", month: "short" },
  /** 6 oct. 2026, 15:30 — 24 h: fr-TN and ar-TN default to « 03:30 PM ». */
  dateTime: { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  /** 15:30 */
  time: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  /** mercredi 28 octobre · الأربعاء 28 أكتوبر — a visit day (0174) */
  weekday: { weekday: "long", day: "numeric", month: "long" },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DatePreset = keyof typeof DATE_PRESETS;

/**
 * A date in the reader's language. Use this instead of
 * `toLocaleDateString("fr-FR")`, which printed French on every page.
 */
export function formatDate(
  value: string | number | Date,
  locale: string = "fr",
  preset: DatePreset = "medium",
): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  // Tunis time, wherever it is formatted. Without it the server (UTC on
  // Vercel) printed every time an hour early, a date near midnight on the day
  // before, and a page rendered on both sides disagreed with the browser —
  // React error #418 on /admin/paiements, caught by the error alerts.
  return readableSpaces(d.toLocaleString(intlTag(locale), { ...DATE_PRESETS[preset], timeZone: SITE_TIME_ZONE }));
}

const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/**
 * "il y a 3 heures" / "قبل 3 ساعات" / "hier" / "أمس", and the same forward in
 * time ("dans 2 jours"). Under a minute reads as "now". Replaces the
 * hand-written French "il y a …" helpers.
 */
export function formatRelativeTime(
  value: string | number | Date,
  locale: string = "fr",
  now: number = Date.now(),
): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const rtf = new Intl.RelativeTimeFormat(intlTag(locale), { numeric: "auto" });
  const seconds = Math.round((d.getTime() - now) / 1000);
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(0, "second");
}

/**
 * French grouping uses U+202F, the narrow no-break space. Plus Jakarta Sans
 * draws it about a pixel wide, so 850 000 TND read as 850000 on every price and
 * surface on the site. A regular no-break space still keeps the number on one
 * line and is wide enough to see.
 */
function readableSpaces(s: string): string {
  return s.replace(/\u202f/g, "\u00a0");
}

