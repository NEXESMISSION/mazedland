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
  return new Intl.NumberFormat(localeTag, {
    style: "decimal",
    maximumFractionDigits: 0,
    notation: options.compact ? "compact" : "standard",
  }).format(amount);
}

/**
 * Bid increment ladder from the plan §8 (in TND):
 *   <100k          → 1,000
 *   100k–500k      → 5,000
 *   500k–1M        → 10,000
 *   ≥1M            → 25,000
 */
export function minBidIncrement(currentBid: number): number {
  if (currentBid < 100_000) return 1_000;
  if (currentBid < 500_000) return 5_000;
  if (currentBid < 1_000_000) return 10_000;
  return 25_000;
}

/**
 * Required participation deposit per the Tunisian auction rules baked
 * into the plan: 10% of the opening price, locked before a bidder can
 * place their first bid.
 */
export function depositForOpening(openingPrice: number): number {
  return Math.round(openingPrice * 0.1);
}
