"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * "This is the one you tapped."
 *
 * Three things already cover parts of this: `.press` gives the 120 ms squeeze
 * under your finger, `NavigationProgress` puts a bar at the top of the window,
 * and every route has a `loading.tsx` skeleton. What none of them answer, on a
 * grid of twenty cards, is *which* card is loading — and that is the only
 * question the reader has between the tap and the next screen.
 *
 * **Why this is not `useLinkStatus`.** That was the first implementation, and
 * measured against the real catalogue it never fired once: Next prefetches
 * every Link in the viewport, so by the time you click, the segment is warm and
 * `pending` goes straight from false to false. It reports "is this navigation
 * waiting on the network", which on a prefetched grid is almost never true —
 * not "did the user just tap this", which is always true and is what the
 * feedback is for.
 *
 * So this listens for the parent link's own click and clears when the route
 * changes. It cannot miss, and it costs one listener per card.
 *
 * The overlay fades in over 90 ms, so a navigation that resolves faster than
 * that never flashes: you get the feedback exactly when the wait is long
 * enough to need it.
 */

/** If a click never leads anywhere — a blocked navigation, a same-URL link —
 *  the marker must not stay on the card forever. */
const GIVE_UP_MS = 8000;

export function LinkBusy({
  variant = "overlay",
  label = "Chargement",
}: {
  /**
   * "overlay" dims the whole card and floats a ring on it — for image cards,
   * where a small spinner in a corner disappears against a photo.
   * "inline" is a ring that sits in the flow — for text links and list rows.
   */
  variant?: "overlay" | "inline";
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const pathname = usePathname();
  const search = useSearchParams();

  // Arm on the enclosing link's click. The marker element is always in the
  // DOM (zero-sized) so there is a stable node to find the parent from.
  useEffect(() => {
    const link = anchorRef.current?.closest("a");
    if (!link) return;

    const onClick = (e: MouseEvent) => {
      // A modified or middle click opens a new tab — this page is not going
      // anywhere, so marking it would be a lie that never clears.
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ||
        link.target === "_blank"
      ) {
        return;
      }
      setBusy(true);
    };

    link.addEventListener("click", onClick);
    return () => link.removeEventListener("click", onClick);
  }, []);

  // The destination arrived (or the user went elsewhere) — stand down.
  useEffect(() => {
    setBusy(false);
  }, [pathname, search]);

  useEffect(() => {
    if (!busy) return;
    const id = setTimeout(() => setBusy(false), GIVE_UP_MS);
    return () => clearTimeout(id);
  }, [busy]);

  if (variant === "inline") {
    return (
      <>
        <span ref={anchorRef} aria-hidden className="hidden" />
        {busy && (
          <span
            role="status"
            aria-label={label}
            className="link-busy-ring inline-block size-3.5 shrink-0 align-middle"
          />
        )}
      </>
    );
  }

  return (
    <>
      <span ref={anchorRef} aria-hidden className="hidden" />
      {busy && (
        <span
          role="status"
          aria-label={label}
          className="link-busy-overlay pointer-events-none absolute inset-0 z-20 grid place-items-center"
        >
          <span className="link-busy-ring size-7" />
        </span>
      )}
    </>
  );
}
