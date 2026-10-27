/**
 * The ready answers of a visit (0174): the half-days a buyer taps instead of
 * picking dates, the hour a seller names, the phrases either side adds.
 *
 * Slots stay what the API takes (src/lib/visits.ts): distinct half-days from
 * today to `visits_horizon_days` out. The helpers here keep the chips inside
 * those rules — a half-day already proposed cannot be tapped twice, which the
 * API would refuse — so nothing the buyer taps comes back as an error. Pure.
 */
import { VISIT_PARTS, type VisitPart, type VisitSlot } from "@/lib/visits";
import { addDays } from "@/lib/dayChips";

/** The API's lengths: the buyer's message, the seller's word. */
export const VISIT_MESSAGE_MAX = 600;
export const SELLER_NOTE_MAX = 400;

/** What a buyer adds to the default message: `visits.request.phrases.<key>`. */
export const BUYER_PHRASES = ["quick", "financing", "family"] as const;
/** What a seller adds when confirming: `visits.actions.phrases.<key>`. */
export const SELLER_PHRASES = ["call", "entrance"] as const;
/** Why a seller says no: `visits.actions.declineReasons.<key>`. */
export const DECLINE_REASONS = ["slots", "unavailable"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

/** The hours a seller can name inside the half-day the buyer chose. */
export const PART_HOURS: Record<VisitPart, readonly number[]> = {
  morning: [9, 10, 11],
  afternoon: [14, 15, 16, 17],
  evening: [18, 19, 20],
};

/** Another slot than the `index`th already holds this half-day. */
export function partTaken(slots: readonly VisitSlot[], index: number, day: string, part: VisitPart): boolean {
  return slots.some((s, i) => i !== index && s.day === day && s.part === part);
}

/**
 * The half-day the `index`th slot takes on `day`: the one it had when that is
 * free, else the first free one, else null (the day is full).
 */
export function freePart(
  slots: readonly VisitSlot[],
  index: number,
  day: string,
  preferred: VisitPart,
): VisitPart | null {
  if (!partTaken(slots, index, day, preferred)) return preferred;
  return VISIT_PARTS.find((p) => !partTaken(slots, index, day, p)) ?? null;
}

/**
 * The slot « Proposer un autre moment » adds in one tap: the day after the
 * last one, at the same time of day — the buyer free on Saturday morning is
 * usually free on Sunday morning — and the first free half-day from there,
 * then from today, within the window. Null when every half-day is taken.
 */
export function suggestSlot(slots: readonly VisitSlot[], today: string, horizonDays: number): VisitSlot | null {
  const last = slots[slots.length - 1];
  const part = last?.part ?? "morning";
  const start = last ? addDays(last.day, 1) : addDays(today, 1);
  const end = addDays(today, horizonDays);
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  for (let d = today; d < start && d <= end; d = addDays(d, 1)) days.push(d);
  for (const day of days) {
    const p = freePart(slots, -1, day, part);
    if (p) return { day, part: p };
  }
  return null;
}
