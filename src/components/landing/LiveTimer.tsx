"use client";

import { useEffect, useState } from "react";

/**
 * Tiny live-ticking countdown. Updates every second; shows seconds
 * always so the urgency is visible at a glance.
 *
 *   2d 14h 32m 15s   (days present)
 *   2h 12m 45s       (hours present, no days)
 *   12m 45s          (under one hour)
 *   45s              (under one minute)
 *   —                ended
 *
 * The server renders an initial value computed at request time and the
 * client takes over on hydration. The two snapshots can differ by ~1s
 * (clock advances between render and hydrate), so the rendered span
 * uses `suppressHydrationWarning` — React's intended escape hatch for
 * live-clock components. Falls back to "—" once the deadline passes.
 *
 * `urgent` flips when the remaining time crosses below `urgentBelowSec`
 * (default 1 h). Consumers can use it to colour the surrounding chip
 * red — e.g. the ending-soon banner already does this.
 */
export function LiveTimer({
  endsAt,
  urgentBelowSec = 3600,
  className,
}: {
  endsAt: string;
  urgentBelowSec?: number;
  className?: string;
}) {
  const [remaining, setRemaining] = useState(() => secondsUntil(endsAt));

  useEffect(() => {
    // Re-sync on prop change so a parent that swaps auctions doesn't
    // keep counting from the previous one.
    setRemaining(secondsUntil(endsAt));
    const id = window.setInterval(() => {
      setRemaining(secondsUntil(endsAt));
    }, 1000);
    return () => window.clearInterval(id);
  }, [endsAt]);

  if (remaining <= 0)
    return (
      <span className={className} suppressHydrationWarning>
        —
      </span>
    );

  const label = formatRemaining(remaining);
  const urgent = remaining < urgentBelowSec;
  // Server render happens at request time; by the time hydration runs on
  // the client, ≥1s has typically elapsed and `Date.now()` returns a
  // different value — so the server's "1h 52m 04s" mismatches the
  // client's "1h 52m 03s". The values converge after the first tick of
  // the interval; suppressHydrationWarning is the React-blessed escape
  // hatch for this exact "live clock" pattern.
  return (
    <span
      className={`tabular-nums ${urgent ? "text-red-400" : ""} ${className ?? ""}`}
      suppressHydrationWarning
    >
      {label}
    </span>
  );
}

function secondsUntil(iso: string): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatRemaining(secs: number): string {
  const d = Math.floor(secs / 86_400);
  const h = Math.floor((secs % 86_400) / 3_600);
  const m = Math.floor((secs % 3_600) / 60);
  const s = secs % 60;
  if (d > 0) return `${d}d ${h}h ${pad(m)}m ${pad(s)}s`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}
