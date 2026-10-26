/**
 * Comparer des annonces (P3): a few side by side, as many as the console's
 * `compare_max` (three by default). Pure — which ids a link may carry, the
 * price per m², and which annonce is best on what.
 */
import { asDealType, type DealType } from "@/lib/listings/deal";

/** The ids in « ?ids=a,b,c »: real uuids, each once, `max` at most. */
export function parseCompareIds(raw: string | string[] | undefined, max = 3): string[] {
  const s = Array.isArray(raw) ? raw.join(",") : raw ?? "";
  const out: string[] = [];
  for (const id of s.split(",")) {
    const v = id.trim().toLowerCase();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v) && !out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

export type Comparable = {
  id: string;
  /** A rental's price is its monthly rent (0166). */
  deal: DealType;
  price: number | null;
  area: number | null;
  rooms: number | null;
};

const positive = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Price, surface and rooms out of a listing row; null where it says nothing. */
export function comparable(l: {
  id: string;
  deal_type?: string | null;
  price: number | string | null;
  price_on_request: boolean | null;
  attributes: Record<string, unknown> | null;
}): Comparable {
  const a = l.attributes ?? {};
  return {
    id: l.id,
    deal: asDealType(l.deal_type),
    price: l.price_on_request ? null : positive(l.price),
    area: positive(a.area_sqm),
    rooms: positive(a.rooms),
  };
}

/** TND per m² — for a rental, per m² and per month: 15, not a sale's 2 500. */
export function pricePerSqm(c: Comparable): number | null {
  return c.price != null && c.area != null ? Math.round(c.price / c.area) : null;
}

export type Best = { price: string | null; perSqm: string | null; area: string | null; rooms: string | null };

/**
 * Which annonce wins each line — the lowest price and price per m², the
 * largest surface, the most rooms — among those that say it, and only when
 * at least two say it and one is strictly ahead: a tie names nobody.
 *
 * The two money lines name a winner only between annonces of the same deal:
 * a month's rent is not cheaper than a sale price, it is another number, and
 * a sale next to a rental used to hand the rental both trophies.
 */
export function bestOf(items: Comparable[]): Best {
  const pick = (value: (c: Comparable) => number | null, lowest: boolean, sameDeal = false): string | null => {
    const known = items
      .map((c) => ({ id: c.id, deal: c.deal, v: value(c) }))
      .filter((x): x is { id: string; deal: DealType; v: number } => x.v != null);
    if (known.length < 2) return null;
    if (sameDeal && known.some((x) => x.deal !== known[0].deal)) return null;
    const sorted = known.slice().sort((a, b) => (lowest ? a.v - b.v : b.v - a.v));
    return sorted[0].v === sorted[1].v ? null : sorted[0].id;
  };
  return {
    price: pick((c) => c.price, true, true),
    perSqm: pick(pricePerSqm, true, true),
    area: pick((c) => c.area, false),
    rooms: pick((c) => c.rooms, false),
  };
}
