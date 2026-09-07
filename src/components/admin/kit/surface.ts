/**
 * The console's visual contract, in one file.
 *
 * The rule the whole design follows: **structure comes from hairlines and
 * space, never from a box.** No card, no rounded tile, no shadow, no filled
 * panel. The previous console drew a bordered, rounded, shadowed container
 * around every group of information, which flattened the hierarchy — when
 * everything is a card, nothing is emphasised — and made a working tool read
 * like a marketing page.
 *
 * Gold is spent in exactly two places: the row you are on, and the one
 * primary action on screen. Everywhere else is grey, and status is carried by
 * a small coloured dot rather than by a filled badge.
 */

/** A 1px divider. The only structural device in the console. */
export const RULE = "border-b border-border";
export const RULE_S = "border-e border-border";

/** Section eyebrow — uppercase micro-label above a group. */
export const EYEBROW =
  "text-[10px] font-bold uppercase tracking-[0.15em] text-subtle";

/** Column header inside a list. */
export const COLHEAD =
  "text-[10px] font-bold uppercase tracking-[0.13em] text-subtle";

/** Numbers that line up in columns. */
export const NUM = "batta-tabular tabular-nums";

/**
 * Row states. `selected` is the only place a filled background is allowed,
 * and it is barely there — the 2px gold edge does the work.
 */
export const ROW_BASE =
  "relative flex w-full items-start gap-3 px-4 py-2.5 text-start transition";
export const ROW_IDLE = "hover:bg-[var(--row-hover)]";
export const ROW_SELECTED =
  "bg-[var(--row-selected)] before:absolute before:inset-y-0 before:start-0 before:w-[2px] before:bg-[var(--gold)]";
export const ROW_FOCUS =
  "focus-visible:outline-none focus-visible:bg-[var(--row-focus)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--gold)]";

/** Left edge marker for a row that needs attention before it can move. */
export const FLAG: Record<"warn" | "bad", string> = {
  warn: "before:absolute before:inset-y-0 before:start-0 before:w-[2px] before:bg-[var(--tone-warn-edge)]",
  bad: "before:absolute before:inset-y-0 before:start-0 before:w-[2px] before:bg-[var(--tone-bad-edge)]",
};

/** Pane scroll region — each pane scrolls independently, the page never does. */
export const PANE = "min-h-0 flex-1 overflow-y-auto overscroll-contain";
