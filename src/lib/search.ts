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
 * Diacritic insensitivity (so "Béja" matches "beja") is backed by the
 * Postgres `unaccent` extension + a `search_text` generated column on
 * properties (migration 0062). Callers fold the user's term with
 * `stripAccents` below so both sides are diacritic-free before matching.
 */

const ILIKE_AND_OR_SPECIALS = /[%_,\\()"]/g;

/**
 * Fold accents/diacritics off a string and lower-case it, mirroring the
 * Postgres `f_unaccent(lower(...))` used to build properties.search_text.
 * "Béja" → "beja", "Médenine" → "medenine". Non-Latin scripts (Arabic) are
 * untouched, matching unaccent's behaviour. Use this on the user's search
 * term before an ILIKE against search_text.
 */
export function stripAccents(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function normalizeSearchQuery(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(ILIKE_AND_OR_SPECIALS, "");
}

/**
 * The words a search must match, folded the way `search_text` is stored.
 *
 * `search_text` is `f_unaccent(lower(…))` (0146), and the catalogue only
 * lower-cased the term: "bâtir" matched nothing, and the whole phrase went in
 * as one `%…%`, so "terrain sfax" found nothing while "sfax terrain" found
 * three. Postgres `unaccent` also folds the ligatures, which NFD does not.
 *
 * Capped at six words: past that the extra ILIKEs cost more than they filter.
 */
export function searchTokens(raw: string | null | undefined): string[] {
  const folded = stripAccents(normalizeSearchQuery(raw)).replace(/œ/g, "oe").replace(/æ/g, "ae");
  return [...new Set(folded.split(/[\s-]+/).filter(Boolean))].slice(0, 6);
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
  "address",
] as const;
