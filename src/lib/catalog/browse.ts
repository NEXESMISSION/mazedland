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
  commercial: "locaux-commerciaux",
  office: "bureaux",
};

/** Catalogue URL for a property-type tile. */
export function catalogueHrefForType(type: string): string {
  const slug = TYPE_TO_CATEGORY[type];
  return slug ? `/annonces?cat=${slug}` : "/annonces";
}
