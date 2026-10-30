/**
 * How a saved annonce appears in « Mes favoris » once it has left the catalogue.
 *
 *   shown    — online; or down for a reason the buyer may read beside its
 *              title: withdrawn or sold by the seller, expired, held for an
 *              edit. « plus disponible » is the answer they came for, and a
 *              favourite that silently vanishes looks like one we lost.
 *   withheld — taken down by the console (0190): kept in the list, so the
 *              favourite is not lost either, but without its title, price,
 *              place or photo.
 *   dropped  — never public: a draft or an annonce still waiting, saved by id.
 *              There was nothing to save, and nothing of it may be read here.
 */
export type SavedVisibility = "shown" | "withheld" | "dropped";

export function savedVisibility(l: {
  status: string;
  published_at: string | null;
  taken_down_at: string | null;
}): SavedVisibility {
  if (l.status === "published") return "shown";
  if (l.taken_down_at) return "withheld";
  if (!l.published_at) return "dropped";
  return "shown";
}
