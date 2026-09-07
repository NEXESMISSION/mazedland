"use client";

import { Loader2, Search } from "lucide-react";

/**
 * "I heard you, I'm looking" — for every search field in the app.
 *
 * A search submit is a full server round trip. Until now the field did
 * absolutely nothing while it happened: same icon, same text, same border, and
 * the results turned up when they turned up. On anything slower than a fast
 * connection that is indistinguishable from a dead control, and the reflex is
 * to press Enter again.
 *
 * Two signals, because one is missable:
 *   1. the magnifier becomes a spinner, right where the eye already is;
 *   2. a gold bar sweeps the width of the field (`.search-sweep`, globals.css).
 *
 * Both are driven by the same `active` flag, which every caller derives from
 * `useTransition` around its own router.push — so the indicator ends exactly
 * when the new results are on screen, not on a guessed timer.
 */

/** The leading icon: magnifier at rest, spinner in flight. */
export function SearchIcon({
  active,
  className = "",
}: {
  active: boolean;
  className?: string;
}) {
  return active ? (
    <Loader2
      aria-hidden
      className={`animate-spin text-[var(--gold)] ${className}`}
      strokeWidth={2.4}
    />
  ) : (
    <Search aria-hidden className={className} strokeWidth={2} />
  );
}

/**
 * The sweeping bar. Renders nothing at rest, so it costs nothing to leave in
 * place. Expects a `relative` + `overflow-hidden` parent — usually the same
 * wrapper that rounds the input.
 */
export function SearchSweep({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span
      aria-hidden
      className="search-sweep pointer-events-none absolute inset-0 overflow-hidden rounded-full"
    />
  );
}

/**
 * The announcement for anyone not looking at the field — a screen reader, or
 * a user whose attention is elsewhere. `role="status"` is polite: it waits for
 * a pause rather than interrupting.
 */
export function SearchStatus({ active }: { active: boolean }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {active ? "Recherche en cours…" : ""}
    </span>
  );
}
