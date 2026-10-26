/**
 * The choice chip of the buyer-side forms (a demande, a visit, a report, the
 * catalogue's budget): a ready answer is one tap, and every chip reads the
 * same wherever it is.
 *
 * `tap-target` keeps it 44 px high, so a thumb finds it; `max-w-full` lets
 * a long label wrap inside it on a 320 px phone instead of pushing the page
 * sideways. Selected is the ink fill with a white label — never a dark label
 * on it (src/lib/contrast-guard.test.ts).
 */
export const CHIP =
  "tap-target inline-flex max-w-full items-center justify-center gap-1.5 rounded-full px-4 py-2 text-center text-[13px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40";

const ON = "bg-[var(--gold)] text-[var(--background)]";
const OFF = "bg-surface text-muted ring-1 ring-border hover:text-foreground";

export function chipClass(on: boolean): string {
  return `${CHIP} ${on ? ON : OFF}`;
}
