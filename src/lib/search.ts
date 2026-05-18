/**
 * Search-input helpers shared by HomeSearch + /properties + /auctions.
 *
 * Two jobs:
 *
 *   1. `normalizeSearchQuery` cleans up what the user typed so the same
 *      intent ("Sfax  apartment", "sfax,apartment") always produces the
 *      same query — trim outer space, collapse interior space, strip
 *      characters that would either confuse PostgREST's `or()` parser
 *      or act as wildcards under `ilike`.
 *
 *   2. `buildIlikeOrClause` produces the comma-joined PostgREST filter
 *      string for an `.or()` call — one ilike per searchable field so
 *      a single keyword can match against title/description/location.
 *      Without this users would search "Sfax" and miss every listing
 *      titled "1BR apartment" with `governorate = "Sfax"`.
 *
 * Diacritic insensitivity (so "Béja" matches "beja") still needs the
 * Postgres `unaccent` extension and a migration to back it. Kept out
 * of this util for now so it can land later without touching callers.
 */

const ILIKE_AND_OR_SPECIALS = /[%_,\\()"]/g;

export function normalizeSearchQuery(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(ILIKE_AND_OR_SPECIALS, "");
}

export function buildIlikeOrClause(query: string, fields: readonly string[]): string {
  return fields.map((f) => `${f}.ilike.%${query}%`).join(",");
}

/**
 * Fields we search across for a property. Title alone is too narrow —
 * a buyer typing "Sfax" expects to hit listings whose title is generic
 * ("Bel appartement, 3 pièces") but whose governorate/address has the
 * city.
 */
export const PROPERTY_SEARCH_FIELDS = [
  "title",
  "description",
  "governorate",
  "delegation",
  "address",
] as const;
