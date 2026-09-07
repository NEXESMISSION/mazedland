"use client";

import { useEffect } from "react";

/**
 * One reference-counted scroll lock for the whole app.
 *
 * Eight components each did this independently:
 *
 *     const prev = document.body.style.overflow;
 *     document.body.style.overflow = "hidden";
 *     return () => { document.body.style.overflow = prev; };
 *
 * Which is correct exactly as long as no two of them are ever open at once.
 * They are: an alert can open over the filter sheet, a lightbox over a side
 * panel, the notification sheet over anything. Then:
 *
 *   sheet opens     → prev "",       sets hidden
 *   alert opens     → prev "hidden", sets hidden
 *   sheet closes    → restores ""    → the page scrolls behind an open alert
 *   alert closes    → restores "hidden"
 *                     ^ nothing is open and the page can no longer scroll.
 *
 * That last line is the "scrolling gets stuck sometimes" — it needs two
 * overlays and a particular closing order, which is exactly why it is
 * intermittent and hard to pin on any one screen. Reloading fixes it, so it
 * looks like a fluke rather than a bug.
 *
 * Counting instead: the first lock records the real original value and applies
 * `hidden`; the last one to leave restores it. Anything in between changes
 * only the count, so no ordering can strand the page.
 */
let locks = 0;
let original: string | null = null;

function acquire() {
  if (typeof document === "undefined") return;
  if (locks === 0) {
    original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  locks += 1;
}

function release() {
  if (typeof document === "undefined") return;
  locks = Math.max(0, locks - 1);
  if (locks === 0) {
    document.body.style.overflow = original ?? "";
    original = null;
  }
}

/**
 * Locks page scroll while `enabled` is true, and releases on unmount — so a
 * component that disappears mid-transition (a route change with the sheet
 * still open) cannot leave the page frozen.
 */
export function useScrollLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    acquire();
    return release;
  }, [enabled]);
}

/** Escape hatch for the rare non-React caller. Pair every call with `release`. */
export const scrollLock = { acquire, release };
