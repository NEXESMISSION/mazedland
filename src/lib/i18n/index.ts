/**
 * Locale helpers shared by server and client code. Nothing here imports
 * next-intl, so it is safe in route handlers, lib code and SQL-adjacent code.
 *
 * Formatting lives in src/lib/utils.ts (formatTND, formatNumber, formatDate,
 * formatRelativeTime); governorate and dial-code labels in src/lib/tunisia.ts.
 */

export type AppLocale = "fr" | "ar";

export function isRtl(locale: string): boolean {
  return locale === "ar";
}

/** Narrow anything (a route param, a cookie) to a supported locale. */
export function asAppLocale(value: string | null | undefined): AppLocale {
  return value === "ar" ? "ar" : "fr";
}

/**
 * A category's name in the reader's language. Categories carry `label_ar` in
 * the database (0145); fall back to French when a category has none yet.
 */
export function categoryLabel(
  category: { label_fr: string; label_ar?: string | null } | null | undefined,
  locale: string,
): string {
  if (!category) return "";
  return locale === "ar" && category.label_ar ? category.label_ar : category.label_fr;
}
