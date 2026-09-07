"use client";

import { useEffect } from "react";

/**
 * Tells the server this annonce was actually looked at.
 *
 * Renders nothing. It fires once after the page is on screen, which is the
 * point: counting in the server component would count Next's prefetches —
 * pages nobody ever saw — as readers.
 *
 * The sessionStorage guard is only politeness to the network. The real
 * de-duplication is in the database (0173): one row per viewer, and a return
 * visit only counts after a 30-minute gap, so a reload can never inflate a
 * number even if this fires again.
 *
 * `keepalive` so the count survives a reader who opens the page and immediately
 * taps a photo or navigates away — which is exactly the reader worth counting.
 */
export function ViewTracker({ listingId }: { listingId: string }) {
  useEffect(() => {
    const key = `v:${listingId}`;
    try {
      if (sessionStorage.getItem(key)) return;
    } catch {
      // Private mode, or storage disabled. Send it anyway — the database
      // de-duplicates, so the worst case is one extra request.
    }

    // A view is someone who stayed long enough to look. A reader who lands on
    // the wrong annonce and leaves in a second is not an impression worth
    // reporting to a seller.
    const timer = window.setTimeout(() => {
      // Marked when the request actually goes, NOT when the effect starts.
      // Marking it up front looks equivalent and is not: React runs an effect,
      // cleans it up and runs it again, so the first pass set the flag, the
      // cleanup cancelled the timer, and the second pass saw the flag and did
      // nothing. Nothing was ever counted.
      try {
        sessionStorage.setItem(key, "1");
      } catch {
        /* storage unavailable — the database still de-duplicates */
      }
      void fetch(`/api/annonces/${listingId}/view`, {
        method: "POST",
        keepalive: true,
      }).catch(() => {});
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [listingId]);

  return null;
}
