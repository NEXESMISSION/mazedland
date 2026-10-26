/**
 * Ready budgets, in TND: the ceilings a demande offers as chips, and the
 * floors and ceilings next to the catalogue's two budget fields.
 *
 * Not `PRICE_BUCKETS` (src/lib/catalog/browse.ts). Those are brackets for
 * browsing — « 100k – 500k » — and the catalogue already shows them as links.
 * A buyer's budget is a ceiling said in a round number: « jusqu'à 300 000 »,
 * where a bracket would stop at 499 999, and its open last bracket has no
 * ceiling at all, the one thing a demande cannot do without. A rent is a
 * monthly figure, so it has its own scale, as the brackets do.
 */
import type { DealType } from "@/lib/listings/deal";
import { formatTND } from "@/lib/utils";

export const BUDGET_PRESETS: Record<DealType, { ceilings: readonly number[]; floors: readonly number[] }> = {
  sale: {
    ceilings: [100_000, 150_000, 200_000, 300_000, 500_000, 1_000_000],
    floors: [50_000, 100_000, 200_000, 300_000, 500_000],
  },
  rent: {
    ceilings: [500, 800, 1_000, 1_500, 2_000, 3_000],
    floors: [300, 500, 800, 1_000, 1_500],
  },
};

/**
 * Which chip a demande's budget is on: a ceiling with no floor that is one of
 * the presets, « Autre budget » ("other") for anything else typed, null when
 * there is no ceiling yet.
 */
export function budgetChoice(min: string, max: string, ceilings: readonly number[]): number | "other" | null {
  const top = Number(max);
  const floor = Number(min);
  if (!max.trim() || !(top > 0)) return min.trim() && floor > 0 ? "other" : null;
  if (min.trim() && floor > 0) return "other";
  return ceilings.includes(top) ? top : "other";
}

/**
 * A budget chip's text: « 300 k », « 300 ألف » for a sale, as the catalogue's
 * brackets say it; a rent in full (« 1 500 »), where the compact form would
 * round it to « 2 k ».
 */
export function budgetChipLabel(amount: number, deal: DealType, locale: string): string {
  const compact = deal === "sale" && amount >= 10_000 && amount % (amount >= 1_000_000 ? 1_000_000 : 1_000) === 0;
  return formatTND(amount, locale, { compact });
}
