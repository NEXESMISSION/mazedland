/**
 * Visit requests (0174): a buyer proposes a few half-days, the seller's
 * side confirms one, declines, or marks the visit done; the buyer can cancel.
 *
 * Pure — the slots, the moves allowed from each status, the client stages —
 * so the rules are tested once and the routes only apply them.
 */

export const VISIT_PARTS = ["morning", "afternoon", "evening"] as const;
export type VisitPart = (typeof VISIT_PARTS)[number];
export type VisitSlot = { day: string; part: VisitPart };

export const VISIT_STATUSES = ["requested", "confirmed", "declined", "cancelled", "done"] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

/** Still waiting on someone: the ones a buyer cannot open twice. */
export const OPEN_VISIT_STATUSES: readonly VisitStatus[] = ["requested", "confirmed"];

/**
 * How many half-days a buyer may propose, and how far ahead: set in the
 * console (`visits_max_slots`, `visits_horizon_days`), these by default.
 */
export type SlotRules = { maxSlots: number; horizonDays: number };
export const DEFAULT_SLOT_RULES: SlotRules = { maxSlots: 3, horizonDays: 30 };

/** Today in Tunisia, as YYYY-MM-DD — the day a slot is compared with. */
export function tunisDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tunis" }).format(now);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * 1 to `maxSlots` distinct half-days, from today to `horizonDays` out, in the
 * order given. Null when there is none, or one of them is not a real day in
 * that window.
 */
export function parseSlots(
  raw: unknown,
  today: string = tunisDay(),
  { maxSlots, horizonDays }: SlotRules = DEFAULT_SLOT_RULES,
): VisitSlot[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > maxSlots) return null;
  const last = addDays(today, horizonDays);
  const seen = new Set<string>();
  const out: VisitSlot[] = [];
  for (const item of raw) {
    const { day, part } = (item ?? {}) as { day?: unknown; part?: unknown };
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    // 2026-02-30 parses to March: a day that does not round-trip is not a day.
    if (new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day) return null;
    if (day < today || day > last) return null;
    if (!VISIT_PARTS.includes(part as VisitPart)) return null;
    const key = `${day}/${part}`;
    if (seen.has(key)) return null;
    seen.add(key);
    out.push({ day, part: part as VisitPart });
  }
  return out;
}

export type VisitAction = "confirm" | "decline" | "done" | "cancel";
export type VisitSide = "seller" | "buyer";

/**
 * Where an action leads, for this side, from this status — or null when it
 * may not. The seller's side answers and closes; the buyer can only call it off.
 */
export function nextStatus(status: VisitStatus, action: VisitAction, side: VisitSide): VisitStatus | null {
  if (side === "buyer") {
    return action === "cancel" && (status === "requested" || status === "confirmed") ? "cancelled" : null;
  }
  if (status === "requested") {
    if (action === "confirm") return "confirmed";
    if (action === "decline" || action === "cancel") return "declined";
    return null;
  }
  if (status === "confirmed") {
    if (action === "done") return "done";
    if (action === "cancel" || action === "decline") return "cancelled";
  }
  return null;
}

/** The slot the seller picked, which must be one the buyer proposed. */
export function pickSlot(slots: VisitSlot[], raw: unknown): VisitSlot | null {
  const { day, part } = (raw ?? {}) as { day?: unknown; part?: unknown };
  return slots.find((s) => s.day === day && s.part === part) ?? null;
}

// ── The client pipeline ─────────────────────────────────────────────────────
export const LEAD_STAGES = ["new", "contacted", "visit", "negotiation", "won", "lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const LEAD_SOURCES = ["visit", "manual", "suggestion"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

/** A visit request moves its client along; it never moves one back from a decided stage. */
export function stageAfterVisit(stage: LeadStage, status: VisitStatus): LeadStage {
  if (stage === "won" || stage === "lost" || stage === "negotiation") return stage;
  if (status === "confirmed" || status === "done") return "visit";
  return stage;
}
