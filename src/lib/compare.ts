/**
 * Comparer des annonces (P3): up to three side by side. Pure — which ids a
 * link may carry, the price per m², and which annonce is best on what.
 */

export const COMPARE_MAX = 3;

/** The ids in « ?ids=a,b,c »: real uuids, each once, three at most. */
export function parseCompareIds(raw: string | string[] | undefined): string[] {
  const s = Array.isArray(raw) ? raw.join(",") : raw ?? "";
  const out: string[] = [];
  for (const id of s.split(",")) {
    const v = id.trim().toLowerCase();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v) && !out.includes(v)) out.push(v);
    if (out.length === COMPARE_MAX) break;
  }
  return out;
}

export type Comparable = {
  id: string;
  price: number | null;
  area: number | null;
  rooms: number | null;
};

const positive = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Price, surface and rooms out of a listing row; null where it says nothing. */
export function comparable(l: { id: string; price: number | string | null; price_on_request: boolean | null; attributes: Record<string, unknown> | null }): Comparable {
  const a = l.attributes ?? {};
  return { id: l.id, price: l.price_on_request ? null : positive(l.price), area: positive(a.area_sqm), rooms: positive(a.rooms) };
}

export function pricePerSqm(c: Comparable): number | null {
  return c.price != null && c.area != null ? Math.round(c.price / c.area) : null;
}

export type Best = { price: string | null; perSqm: string | null; area: string | null; rooms: string | null };

/**
 * Which annonce wins each line — the lowest price and price per m², the
 * largest surface, the most rooms — among those that say it, and only when
 * at least two say it and one is strictly ahead: a tie names nobody.
 */
export function bestOf(items: Comparable[]): Best {
  const pick = (value: (c: Comparable) => number | null, lowest: boolean): string | null => {
    const known = items.map((c) => ({ id: c.id, v: value(c) })).filter((x): x is { id: string; v: number } => x.v != null);
    if (known.length < 2) return null;
    const sorted = known.slice().sort((a, b) => (lowest ? a.v - b.v : b.v - a.v));
    return sorted[0].v === sorted[1].v ? null : sorted[0].id;
  };
  return {
    price: pick((c) => c.price, true),
    perSqm: pick(pricePerSqm, true),
    area: pick((c) => c.area, false),
    rooms: pick((c) => c.rooms, false),
  };
}
