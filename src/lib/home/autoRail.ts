/**
 * The arithmetic behind the home page's rails that move by themselves
 * (`AutoRail`), kept apart from the DOM so it can be tested.
 *
 * Everything here works in LOGICAL scroll: 0 at the start of the rail, growing
 * toward its end, in either writing direction. Browsers do not agree with that
 * in right-to-left: an Arabic rail starts at scrollLeft 0 and goes NEGATIVE as
 * it moves toward its end. `logicalScroll` and `physicalScrollLeft` are the
 * only two places that know it.
 */

/** A rail closer than this to a card, or to its end, is on it. Snap and
 *  sub-pixel layout rarely land on the exact pixel. */
export const SNAP_TOLERANCE_PX = 4;

/** How long a rail stays still after someone swiped, scrolled or pressed an arrow. */
export const RESUME_AFTER_MS = 6000;

/** scrollLeft → logical scroll. */
export function logicalScroll(scrollLeft: number, rtl: boolean): number {
  return rtl ? Math.abs(scrollLeft) : scrollLeft;
}

/** Logical scroll → the scrollLeft to hand `scrollTo`. Never -0: it is 0. */
export function physicalScrollLeft(logical: number, rtl: boolean): number {
  if (logical === 0) return 0;
  return rtl ? -logical : logical;
}

/**
 * Where a card begins, as a logical scroll from the rail's start: the scroll
 * that would bring its leading edge to the rail's leading edge. The leading
 * edge is the left one in French and the right one in Arabic.
 */
export function logicalStart(
  card: { left: number; right: number },
  rail: { left: number; right: number },
  scroll: number,
  rtl: boolean,
): number {
  return rtl ? rail.right - card.right + scroll : card.left - rail.left + scroll;
}

/** The card the rail shows first: the last one whose target it has reached. */
export function cardIndexAt(targets: readonly number[], scroll: number): number {
  let index = 0;
  for (let i = 0; i < targets.length; i++) if (targets[i] <= scroll + SNAP_TOLERANCE_PX) index = i;
  return index;
}

/** One card further, and back to the first once the rail has reached its end. */
export function nextCardIndex(current: number, count: number, atEnd: boolean): number {
  if (count <= 0) return 0;
  return atEnd || current + 1 >= count ? 0 : current + 1;
}

/**
 * Where the timer moves the rail next, or null when it cannot move at all
 * (every card already fits). `targets` are each card's logical start, less the
 * rail's scroll padding, so the card lands where scroll-snap would put it.
 */
export function autoplayTarget(targets: readonly number[], scroll: number, maxScroll: number): number | null {
  if (targets.length < 2 || maxScroll <= SNAP_TOLERANCE_PX) return null;
  const atEnd = scroll >= maxScroll - SNAP_TOLERANCE_PX;
  const next = nextCardIndex(cardIndexAt(targets, scroll), targets.length, atEnd);
  return Math.min(Math.max(0, targets[next]), maxScroll);
}

/**
 * Where an arrow moves the rail: one card toward its end (`1`) or its start
 * (`-1`). Arrows stop at the ends rather than wrap — a person pressing « next »
 * on the last card does not expect the first. Halfway between two cards,
 * « previous » first brings back the one that is cut.
 */
export function arrowTarget(targets: readonly number[], scroll: number, maxScroll: number, dir: 1 | -1): number {
  if (targets.length === 0 || maxScroll <= 0) return 0;
  const i = cardIndexAt(targets, scroll);
  const clamp = (v: number) => Math.min(Math.max(0, v), maxScroll);
  if (dir === 1) return clamp(targets[Math.min(i + 1, targets.length - 1)]);
  if (scroll > targets[i] + SNAP_TOLERANCE_PX) return clamp(targets[i]);
  return clamp(targets[Math.max(i - 1, 0)]);
}

/** Why a rail may be holding still. */
export type RailPause = {
  hovering: boolean;
  touching: boolean;
  focused: boolean;
  inView: boolean;
  hidden: boolean;
};

/** A rail moves only when nobody is reading it, and somebody can see it. */
export function canPlay(p: RailPause): boolean {
  return p.inView && !p.hidden && !p.hovering && !p.touching && !p.focused;
}

/** How long until the next move: one interval, or longer if someone just touched the rail. */
export function nextDelay(now: number, intervalMs: number, resumeAt: number): number {
  return Math.max(intervalMs, resumeAt - now);
}
