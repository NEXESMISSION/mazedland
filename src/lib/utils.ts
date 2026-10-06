import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a TND amount with locale-correct grouping. The plan caps prices in
 * the millions, so we never need decimals — properties trade in whole dinars.
 */
export function formatTND(
  amount: number,
  locale: string = "fr-TN",
  options: { compact?: boolean } = {},
) {
  return readableSpaces(
    new Intl.NumberFormat(intlTag(locale), {
      style: "decimal",
      maximumFractionDigits: 0,
      notation: options.compact ? "compact" : "standard",
    }).format(amount),
  );
}

/**
 * A whole number with the locale's digit grouping — 13 000 in French, 13.000 in
 * Tunisian Arabic (Latin digits either way) — for surfaces and counts.
 */
export function formatNumber(value: number, locale: string = "fr"): string {
  return readableSpaces(new Intl.NumberFormat(intlTag(locale), { maximumFractionDigits: 0 }).format(value));
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

const DATE_PRESETS = {
  /** 6 octobre 2026 · 6 أكتوبر 2026 */
  long: { day: "numeric", month: "long", year: "numeric" },
  /** 6 oct. 2026 */
  medium: { day: "numeric", month: "short", year: "numeric" },
  /** 06/10/2026 */
  short: { day: "2-digit", month: "2-digit", year: "numeric" },
  /** 6 oct. · 6 أكتوبر */
  dayMonth: { day: "numeric", month: "short" },
  /** 6 oct. 2026, 15:30 */
  dateTime: { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" },
  /** 15:30 */
  time: { hour: "2-digit", minute: "2-digit" },
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
  return readableSpaces(d.toLocaleString(intlTag(locale), DATE_PRESETS[preset]));
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

