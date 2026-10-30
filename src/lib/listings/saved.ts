/**
 * How a saved annonce appears in « Mes favoris » once it has left the catalogue.
 *
 *   shown    — online; or down for a reason the buyer may read beside its
 *              title: withdrawn or sold by the seller, expired. « plus
 *              disponible » is the answer they came for, and a favourite that
 *              silently vanishes looks like one we lost.
 *   withheld — kept in the list, so the favourite is not lost either, but
 *              without its title, price, place or photo: taken down by the
 *              console (0190), or back in the pipeline (refused, held for
 *              review, awaiting a payment) — the columns of such a row may be
 *              a seller's rewrite nobody has moderated yet.
 *   dropped  — never public: a draft or an annonce still waiting, saved by id.
 *              There was nothing to save, and nothing of it may be read here.
 */
export type SavedVisibility = "shown" | "withheld" | "dropped";

/** Statuses whose columns are the approved version of the annonce. */
const APPROVED_WORDS = new Set(["published", "expired", "sold", "rented", "archived"]);

export function savedVisibility(l: {
  status: string;
  published_at: string | null;
  taken_down_at: string | null;
}): SavedVisibility {
  if (l.status === "published") return "shown";
  if (l.taken_down_at) return "withheld";
  if (!l.published_at) return "dropped";
  return APPROVED_WORDS.has(l.status) ? "shown" : "withheld";
}
