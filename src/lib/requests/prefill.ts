/**
 * A demande started from a catalogue search (0168).
 *
 * « Enregistrer ma demande » under the results passes the search along, and
 * the form opens on it, so nothing is typed twice. What the demande model
 * holds becomes its criteria: the deal, the category, the governorate, the
 * budget, a minimum surface and number of rooms, and for a rental the
 * furniture and the date. The words searched are not a criterion — an alert
 * checks those conditions, never the text of an annonce — so they go in
 * « Autres souhaits », and the form says so before anything is saved. The
 * keyword used to be dropped on the way: « Teniour » searched, a demande
 * with no trace of it.
 *
 * Pure, so the mapping is tested without a page.
 */
import { asDealType, FURNISHED, isoDay, type DealType, type Furnished } from "@/lib/listings/deal";
import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";
import { findCategory } from "@/lib/catalog/browse";

/** The form holds strings, because inputs do; the API types them. */
export type RequestFormValue = {
  deal_type: DealType;
  category_ids: string[];
  governorates: string[];
  budget_min: string;
  budget_max: string;
  surface_min: string;
  rooms_min: string;
  furnished: Furnished | "";
  move_in_by: string;
  note: string;
  alerts: boolean;
};

/** The note's length on the form and in the API. */
export const NOTE_MAX = 500;

/** The catalogue filters a search can carry, besides the deal and the words. */
const SEARCH_FILTERS = ["cat", "gov", "min", "max", "surface", "rooms", "q"] as const;

export type SearchPrefill = {
  value: RequestFormValue;
  /** The words searched, now in the note; null when there were none. */
  words: string | null;
  /** A search over sales AND rentals: a demande is one of the two, and the
   *  form asks the person to check which rather than pass the guess off. */
  anyDeal: boolean;
};

const positive = (v: string | undefined): string => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? String(n) : "";
};

export function requestFormFromSearch(
  sp: Record<string, string | undefined>,
  categories: readonly { id: string; slug: string }[],
): SearchPrefill {
  const deal = asDealType(sp.deal);
  const rent = deal === "rent";
  // Accepts the slug the catalogue sends, or an id (see findCategory).
  const cat = findCategory(sp.cat, categories);
  const words = (sp.q ?? "").trim().replace(/\s+/g, " ").slice(0, NOTE_MAX) || null;
  const rooms = Math.floor(Number(sp.rooms));
  const searched = SEARCH_FILTERS.some((k) => (sp[k] ?? "").trim() !== "");

  return {
    value: {
      deal_type: deal,
      category_ids: cat ? [cat.id] : [],
      governorates: sp.gov && (TUNISIAN_GOVERNORATES as readonly string[]).includes(sp.gov) ? [sp.gov] : [],
      budget_min: positive(sp.min),
      budget_max: positive(sp.max),
      surface_min: positive(sp.surface),
      // The model's own bounds (parseRequestInput).
      rooms_min: rooms >= 1 && rooms <= 10 ? String(rooms) : "",
      furnished: rent && (FURNISHED as readonly string[]).includes(sp.furnished ?? "") ? (sp.furnished as Furnished) : "",
      move_in_by: rent ? isoDay(sp.avail) ?? "" : "",
      note: words ?? "",
      alerts: true,
    },
    words,
    anyDeal: searched && sp.deal !== "sale" && sp.deal !== "rent",
  };
}
