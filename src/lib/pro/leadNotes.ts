/**
 * A client's note and call-back day (0174), filled with taps: a quick line
 * (« Rappelé », « Visite prévue »…) stamped with the day it was added, and
 * the usual call-back days as choices. The free text and the date field stay
 * for everything else. Pure, tested on its own.
 */

/** The lines a team member writes most, as chips — their words are `pro.clients.quick.*`. */
export const QUICK_NOTES = ["called", "visit_planned", "offer_made", "not_interested"] as const;
export type QuickNote = (typeof QUICK_NOTES)[number];

/** The note's length in the leads API (parseLeadPatch). */
export const NOTE_MAX = 2000;

/** « 2026-10-26 » → « 26/10 »: the day as a note line says it, the way Tunisia writes it. */
export function shortDay(day: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${m[2]}/${m[1]}` : day;
}

/**
 * « 26/10 · Rappelé » on top of what the note held. Newest first: the card
 * shows the note's first lines, and those should be the latest news. Cut
 * where the API would cut it, so what is saved is what the field shows.
 */
export function addNoteLine(note: string, text: string, day: string): string {
  const line = `${shortDay(day)} · ${text.trim()}`;
  const rest = note.trim();
  return (rest ? `${line}\n${rest}` : line).slice(0, NOTE_MAX);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** When to call back, as choices: tomorrow, in three days, in a week — words under `pro.clients.when.*`. */
export const CALL_BACK = [
  { key: "tomorrow", days: 1 },
  { key: "in3", days: 3 },
  { key: "nextWeek", days: 7 },
] as const;
export type CallBackKey = (typeof CALL_BACK)[number]["key"];

export function callBackChoices(today: string): { key: CallBackKey; day: string }[] {
  return CALL_BACK.map((c) => ({ key: c.key, day: addDays(today, c.days) }));
}
