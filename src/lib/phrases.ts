/**
 * Suggestion chips that write into a text the person can also type in:
 * « Vue mer » into a demande's wishes, « Financement prêt. » into a visit
 * request, « Rendez-vous à 10 h. » into a seller's answer. The text stays
 * theirs: a chip adds its phrase at the end, takes it out again on a second
 * tap, and leaves every other word as it was typed.
 *
 * A phrase that ends like a sentence (« Je viens avec ma famille. ») follows
 * the text after a space; a short one (« Vue mer ») after a comma — the
 * Arabic comma when either side is Arabic.
 *
 * Pure, so the joins are tested without a form.
 */

const SENTENCE_END = /[.!?؟…]$/;
const PUNCT_END = /[.!?؟…,،;:]$/;
const ARABIC = /[؀-ۿ]/;
const LETTER = /[\p{L}\p{N}]/u;

/** Where the phrase stands in the text as words of its own, or -1. */
function find(text: string, phrase: string): number {
  const hay = text.toLowerCase();
  const needle = phrase.toLowerCase();
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    // « Vue mer » is not in « Vue merveilleuse ».
    const before = at > 0 ? hay[at - 1] : "";
    const after = hay[at + needle.length] ?? "";
    if (!LETTER.test(before) && !LETTER.test(after)) return at;
  }
  return -1;
}

export function hasPhrase(text: string, phrase: string): boolean {
  const p = phrase.trim();
  return p !== "" && find(text, p) >= 0;
}

/**
 * The text with the phrase at its end. Unchanged when it is already there,
 * or when adding it would pass `max` — the field's own limit, so a chip never
 * writes what the API would cut.
 */
export function addPhrase(text: string, phrase: string, max: number = Infinity): string {
  const p = phrase.trim();
  if (!p || hasPhrase(text, p)) return text;
  const base = text.trimEnd();
  let next: string;
  if (!base) next = p;
  else if (PUNCT_END.test(base)) next = `${base} ${p}`;
  else if (SENTENCE_END.test(p)) next = `${base}. ${p}`;
  else next = `${base}${ARABIC.test(base) || ARABIC.test(p) ? "،" : ","} ${p}`;
  return next.length <= max ? next : text;
}

/** The text without the phrase, and without the comma or space that came with it. */
export function removePhrase(text: string, phrase: string): string {
  const p = phrase.trim();
  if (!p) return text;
  const at = find(text, p);
  if (at < 0) return text;
  const head = text.slice(0, at);
  const tail = text.slice(at + p.length);
  const lead = /([,،])?\s*$/.exec(head)!;
  const trail = /^\s*([,،])?\s*/.exec(tail)!;
  const before = head.slice(0, head.length - lead[0].length);
  const after = tail.slice(trail[0].length);
  if (!before || !after) return before + after;
  // The neighbours were joined through the phrase: by its comma, or by a space.
  const sep = lead[1] ?? trail[1];
  return `${before}${sep ? `${sep} ` : " "}${after}`;
}

/** A chip's tap: in when it is out, out when it is in. */
export function togglePhrase(text: string, phrase: string, max: number = Infinity): string {
  return hasPhrase(text, phrase) ? removePhrase(text, phrase) : addPhrase(text, phrase, max);
}

/**
 * One phrase in place of another — a chip group where one answer at a time
 * holds (the hour of a visit, a reason). Either side may be null. When the
 * new one does not fit, the text stays as it was, old answer included.
 */
export function swapPhrase(text: string, from: string | null, to: string | null, max: number = Infinity): string {
  const without = from ? removePhrase(text, from) : text;
  if (!to) return without;
  const next = addPhrase(without, to, max);
  return hasPhrase(next, to) ? next : text;
}
