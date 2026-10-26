/**
 * Catching a zero too many or too few on a price (P3 « vendre sans se
 * tromper »). Two helps, both pure:
 *
 * 1. The figure read back in words, the way it is said in Tunisia —
 *    « 300 mille dinars », and in Arabic « 300 ألف دينار — 300 مليون » (a
 *    « مليون » is a thousand dinars: a million millimes). 3 000 000 typed
 *    for 300 000 jumps out when it reads « 3 millions ».
 * 2. A comparison with what similar annonces ask: a price ten times off the
 *    usual, with a ×10 or ÷10 that lands right in it, is offered as a fix.
 */
import type { CategoryKind } from "@/lib/moderation/rules";
import type { DealType } from "@/lib/listings/deal";

const grouped = (n: number) => {
  const [int, dec] = String(Math.round(n * 100) / 100).split(".");
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (dec ? `,${dec}` : "");
};
const oneDecimal = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

/** The price in words, for reading back under the field. Null below 1 dinar. */
export function priceInWords(price: number, locale: string): string | null {
  if (!Number.isFinite(price) || price < 1) return null;
  if (locale === "ar") {
    const dinars = price >= 1000 ? `${grouped(price / 1000)} ألف دينار` : `${grouped(price)} دينار`;
    if (price < 1000) return dinars;
    // The Tunisian way: millions of millimes, and « مليار » for a thousand of them.
    const millions = price / 1000;
    const spoken =
      millions >= 1000
        ? `${oneDecimal(millions / 1000)} مليار`
        : `${grouped(millions)} مليون`;
    return `${dinars} — ${spoken}`;
  }
  if (price >= 1_000_000) return `${oneDecimal(price / 1_000_000)} million${price >= 2_000_000 ? "s" : ""} de dinars`;
  if (price >= 1000) return `${grouped(price / 1000)} mille dinars`;
  return `${grouped(price)} dinars`;
}

type Range = readonly [number, number];
/** What a dinar figure usually is in Tunisia, per m² (a month, for a rent). */
const TYPICAL_PER_SQM: Record<"sale" | "rent", Record<CategoryKind, Range>> = {
  sale: { residential: [400, 8_000], land: [3, 3_000], commercial: [300, 15_000] },
  rent: { residential: [3, 60], land: [0.05, 10], commercial: [3, 100] },
};
/** And as a whole, when the surface is not given. */
const TYPICAL_TOTAL: Record<"sale" | "rent", Record<CategoryKind, Range>> = {
  sale: { residential: [15_000, 5_000_000], land: [1_000, 10_000_000], commercial: [10_000, 10_000_000] },
  rent: { residential: [100, 15_000], land: [50, 20_000], commercial: [150, 50_000] },
};

export type PriceRef = {
  /** Median asking price of the online annonces like it. */
  median: number | null;
  /** Median price per m² of those that give a surface. */
  perSqm: number | null;
};

/** The middle value, or null when there are fewer than three to go on. */
export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length < 3) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * A ×10 or ÷10 that would make the price make sense, or null. The usual price
 * is the surface times the usual price per m² when both are known, else the
 * usual price. Off by five times or more one way, and the fix lands within
 * three times of the usual — or, with nothing to compare with, the price is
 * outside the usual range for Tunisia and the fix is inside it.
 */
export function suggestPriceFix(input: {
  price: number;
  areaSqm: number | null;
  ref: PriceRef | null;
  kind: CategoryKind | null;
  dealType: DealType;
}): number | null {
  const { price, areaSqm } = input;
  if (!Number.isFinite(price) || price <= 0) return null;
  const usual =
    input.ref?.perSqm && areaSqm && areaSqm > 0 ? input.ref.perSqm * areaSqm : input.ref?.median ?? null;
  const candidates = [price / 10, price * 10];
  if (usual) {
    const ratio = price / usual;
    if (ratio >= 5 || ratio <= 0.2) {
      const fix = candidates.find((c) => c / usual <= 3 && c / usual >= 1 / 3);
      if (fix) return Math.round(fix);
    }
    return null;
  }
  // Nothing to compare with yet (few annonces of this kind online): the usual
  // range for Tunisia instead — narrower than the moderation's limits, since
  // here it only asks a question the seller can wave away.
  const usualRange = (p: number) => {
    const deal = input.dealType === "rent" ? "rent" : "sale";
    const kind = input.kind ?? "residential";
    const [lo, hi] = areaSqm && areaSqm > 0 ? TYPICAL_PER_SQM[deal][kind] : TYPICAL_TOTAL[deal][kind];
    const v = areaSqm && areaSqm > 0 ? p / areaSqm : p;
    return v >= lo && v <= hi;
  };
  if (usualRange(price)) return null;
  const fix = candidates.find(usualRange);
  return fix ? Math.round(fix) : null;
}
