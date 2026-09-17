/**
 * The home page's "browse by type" tiles and its search box speak in PROPERTY
 * TYPES — apartment, villa, land — the vocabulary of the auction-era explore
 * page. The catalogue filters by CATEGORY slug. This is the one place the two
 * are reconciled, so a tile and the search box cannot disagree about where
 * « Terrain » lands.
 *
 * Until this existed both sent `/properties?types=villa`: a 302 to /annonces
 * that dropped the parameter on the floor, so every tile opened the same
 * unfiltered catalogue.
 *
 * Slugs are the live LEAF categories (`categories.slug` with a parent). A type
 * without a mapping falls back to the unfiltered catalogue, never to a filter
 * that matches nothing.
 */
export const TYPE_TO_CATEGORY: Readonly<Record<string, string>> = {
  apartment: "appartements",
  villa: "villas",
  house: "maisons",
  land: "terrain",
  farm: "fermes",
  commercial: "locaux-commerciaux",
  office: "bureaux",
  warehouse: "depots",
};

/**
 * Budget brackets, in TND.
 *
 * The home page has offered these three as entry points since it was built;
 * the catalogue honoured `min`/`max` but had no control to set them, so a
 * buyer who arrived from the nav, a search engine or a shared link could
 * filter by type and by governorate and not by price — the first question
 * anyone asks about a property. Same boundaries in both places, so a bracket
 * chosen on the home page is the bracket highlighted in the catalogue.
 *
 * `1M et plus` is open-ended and only exists here: the home tiles are for
 * getting started, and an unbounded bracket is not a starting point.
 */
export type PriceBucket = { key: string; label: string; min?: number; max?: number };

export const PRICE_BUCKETS: readonly PriceBucket[] = [
  { key: "under-100k", label: "Moins de 100k", max: 99_999 },
  { key: "100k-500k", label: "100k – 500k", min: 100_000, max: 499_999 },
  { key: "500k-1m", label: "500k – 1M", min: 500_000, max: 999_999 },
  { key: "1m-plus", label: "1M et plus", min: 1_000_000 },
];

/** Catalogue URL for a property-type tile. */
export function catalogueHrefForType(type: string): string {
  const slug = TYPE_TO_CATEGORY[type];
  return slug ? `/annonces?cat=${slug}` : "/annonces";
}
