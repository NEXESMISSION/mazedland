/**
 * One shared 1-second ticker for all live countdowns on the page.
 *
 * Why: the home page (and /properties, /watchlist, …) can mount hundreds of
 * PropertyCards, each with a LiveTimer. If every LiveTimer ran its own
 * `setInterval(1000)`, the page would carry ~370 independent timers all
 * firing every second — sustained main-thread churn that shows up as
 * long-tasks and jank. Funnelling them through a single interval keeps the
 * cost flat (1 timer) no matter how many countdowns are on screen.
 *
 * Subscribers are invoked once per second. The interval only runs while at
 * least one subscriber is registered, and is torn down when the last one
 * unsubscribes — so an idle page (no countdowns) carries no timer at all.
 */

type Sub = () => void;

const subscribers = new Set<Sub>();
let timer: ReturnType<typeof setInterval> | null = null;

function ensureRunning() {
  if (timer !== null || typeof window === "undefined") return;
  timer = setInterval(() => {
    // Snapshot to a copy so a subscriber that unsubscribes during the
    // loop can't mutate the set we're iterating.
    for (const fn of Array.from(subscribers)) {
      try {
        fn();
      } catch {
        // A single misbehaving countdown must not kill the shared tick.
      }
    }
  }, 1000);
}

/**
 * Register a per-second callback. Returns an unsubscribe fn — call it on
 * component unmount. Starts the shared interval on the first subscriber and
 * stops it when the last one leaves.
 */
export function subscribeTick(fn: Sub): () => void {
  subscribers.add(fn);
  ensureRunning();
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}
