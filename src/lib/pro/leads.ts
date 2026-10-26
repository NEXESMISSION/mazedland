/**
 * A shop's clients (0174): the form for one added by hand, and the changes a
 * team member makes as the sale moves. Pure, tested on its own.
 */
import { anyPhoneToE164 } from "@/lib/tunisia";
import { LEAD_STAGES, type LeadStage } from "@/lib/visits";

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};
const uuid = (v: unknown): string | null => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
const stage = (v: unknown): LeadStage | null => LEAD_STAGES.find((s) => s === v) ?? null;

/** A day (YYYY-MM-DD) for the next call, kept at noon UTC so it stays that day in Tunis. Null clears it. */
function nextAction(v: unknown): string | null | undefined {
  if (v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? undefined : d.toISOString();
}

export type NewLead = { name: string; phone: string | null; listing_id: string | null; note: string | null; stage: LeadStage; next_action_at: string | null };

export function parseNewLead(raw: Record<string, unknown>): { ok: true; value: NewLead } | { ok: false; error: "name" | "phone" | "date" } {
  const name = text(raw.name, 120)?.replace(/\s+/g, " ") ?? null;
  if (!name || name.length < 2) return { ok: false, error: "name" };
  const phoneRaw = text(raw.phone, 24);
  const phone = phoneRaw ? anyPhoneToE164(phoneRaw) : null;
  if (phoneRaw && !phone) return { ok: false, error: "phone" };
  const when = nextAction(raw.next_action_at ?? null);
  if (when === undefined) return { ok: false, error: "date" };
  return {
    ok: true,
    value: { name, phone, listing_id: uuid(raw.listingId), note: text(raw.note, 2000), stage: stage(raw.stage) ?? "new", next_action_at: when },
  };
}

export type LeadPatch = Partial<{ stage: LeadStage; note: string | null; next_action_at: string | null }>;

/** Only what was sent and is valid; an empty patch means there is nothing to do. */
export function parseLeadPatch(raw: Record<string, unknown>): LeadPatch | null {
  const out: LeadPatch = {};
  if ("stage" in raw) {
    const s = stage(raw.stage);
    if (!s) return null;
    out.stage = s;
  }
  if ("note" in raw) out.note = text(raw.note, 2000);
  if ("next_action_at" in raw) {
    const when = nextAction(raw.next_action_at);
    if (when === undefined) return null;
    out.next_action_at = when;
  }
  return Object.keys(out).length ? out : null;
}
