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
  const localeTag = locale === "ar" ? "ar-TN" : locale === "en" ? "en-US" : "fr-TN";
  return readableSpaces(
    new Intl.NumberFormat(localeTag, {
      style: "decimal",
      maximumFractionDigits: 0,
      notation: options.compact ? "compact" : "standard",
    }).format(amount),
  );
}

/** A whole number with French digit grouping — 13 000 — for surfaces and counts. */
export function formatNumber(value: number): string {
  return readableSpaces(new Intl.NumberFormat("fr-TN", { maximumFractionDigits: 0 }).format(value));
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

