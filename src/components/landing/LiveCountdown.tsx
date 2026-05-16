"use client";

import { useEffect, useState } from "react";

/**
 * Per-second updating countdown pill. SSR-friendly: renders the initial
 * label server-side too (the same math runs server + client on first
 * paint, then hydrates and starts the interval). Switches to "ended"
 * styling once the deadline passes.
 *
 * Used in the Trending rail and the Ending-Soon banner where the
 * passage of time itself is the point.
 */
export function LiveCountdown({
  endsAt,
  compact = false,
}: {
  endsAt: string;
  compact?: boolean;
}) {
  const [remaining, setRemaining] = useState(() => secondsUntil(endsAt));

  useEffect(() => {
    const id = window.setInterval(() => {
      setRemaining(secondsUntil(endsAt));
    }, 1000);
    return () => window.clearInterval(id);
  }, [endsAt]);

  if (remaining <= 0) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 font-bold text-red-600 ${
          compact ? "text-[10px]" : "text-xs"
        }`}
      >
        ended
      </span>
    );
  }

  const { d, h, m, s, urgent } = breakdown(remaining);
  const label = d > 0
    ? `${d}d ${h}h`
    : h > 0
      ? `${h}h ${m}m`
      : `${m}m ${String(s).padStart(2, "0")}s`;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold tabular-nums ${
        urgent
          ? "bg-red-500 text-white"
          : "bg-batta-surface-2 text-batta-gold ring-1 ring-batta-gold/30"
      } ${compact ? "text-[10px]" : "text-xs"}`}
    >
      {urgent && (
        <span className="batta-pulse-dot inline-flex size-1.5 rounded-full bg-white text-white/40" />
      )}
      {label}
    </span>
  );
}

function secondsUntil(iso: string): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}

function breakdown(secs: number) {
  const d = Math.floor(secs / 86_400);
  const h = Math.floor((secs % 86_400) / 3_600);
  const m = Math.floor((secs % 3_600) / 60);
  const s = secs % 60;
  // "Urgent" = under one hour. Triggers the red treatment in the UI.
  return { d, h, m, s, urgent: secs < 3_600 };
}
