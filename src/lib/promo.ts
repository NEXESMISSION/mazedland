/**
 * Paid placements of an annonce (0156 columns, sold as `products` of kind
 * « promo »). Pure: which product sets which placement, and what a listing
 * has running now.
 *
 *   promo-accueil        → promo_home_featured  « Les biens du moment » on the home page
 *   promo-top-recherche  → promo_top_listed     first in the catalogue's default order
 *   promo-banniere       → promo_banner         first slides of the home page's banner
 *
 * One placement at a time per annonce: the three share one `promo_expires_at`,
 * so a second kind bought while one runs would quietly extend the first. The
 * same kind again extends it from where it ends.
 */

export const PLACEMENTS = {
  "promo-accueil": "promo_home_featured",
  "promo-top-recherche": "promo_top_listed",
  "promo-banniere": "promo_banner",
} as const;

export type PromoSlug = keyof typeof PLACEMENTS;
export type PromoColumn = (typeof PLACEMENTS)[PromoSlug];

export function placementOf(slug: string | null | undefined): PromoColumn | null {
  return slug && slug in PLACEMENTS ? PLACEMENTS[slug as PromoSlug] : null;
}

export type PromoState = {
  promo_home_featured: boolean | null;
  promo_top_listed: boolean | null;
  promo_banner: boolean | null;
  promo_expires_at: string | null;
};

/** The placement running now, if any, and until when. */
export function activePromo(l: PromoState, now: Date = new Date()): { column: PromoColumn; until: string } | null {
  if (!l.promo_expires_at || new Date(l.promo_expires_at).getTime() <= now.getTime()) return null;
  const column = (["promo_banner", "promo_home_featured", "promo_top_listed"] as const).find((c) => l[c]);
  return column ? { column, until: l.promo_expires_at } : null;
}

/** May this placement be bought now: nothing running, or the same one (an extension). */
export function canBuy(l: PromoState, column: PromoColumn, now: Date = new Date()): boolean {
  const running = activePromo(l, now);
  return !running || running.column === column;
}

/** When a bought period ends: from the running one's end when extending, else from now. */
export function promoEnd(l: PromoState, column: PromoColumn, days: number, now: Date = new Date()): Date {
  const running = activePromo(l, now);
  const from = running && running.column === column ? new Date(running.until) : now;
  return new Date(from.getTime() + days * 86_400_000);
}
