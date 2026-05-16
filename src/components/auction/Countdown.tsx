"use client";

import { useEffect, useState } from "react";

/**
 * Live HH:MM:SS countdown that inherits text color from its parent so
 * the same component reads correctly on both light cards and dark
 * surfaces (the auction-detail headline card is navy). The only color
 * we own is the red critical state inside the last 5 minutes — that's
 * a semantic alert, not chrome, so it intentionally overrides parent.
 */
export function Countdown({ endsAt }: { endsAt: string }) {
  // SSR: render placeholder so server / client markup matches; the
  // first effect tick replaces it within ~16ms.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (now === null) return <span className="font-mono tabular-nums">— : — : —</span>;
  const ms = new Date(endsAt).getTime() - now;
  if (ms <= 0) {
    return <span className="font-mono font-semibold tabular-nums text-red-500">00 : 00 : 00</span>;
  }
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);

  // Anti-sniping window: highlight inside the last 5 min in red so it's
  // unmistakable on either surface. Otherwise inherit color.
  const isCritical = days === 0 && hours === 0 && mins < 5;
  const colorClass = isCritical ? "text-red-500" : "";

  if (days > 0) {
    return (
      <span className={`font-mono font-semibold tabular-nums ${colorClass}`}>
        {days}d {pad(hours)}:{pad(mins)}:{pad(secs)}
      </span>
    );
  }
  return (
    <span className={`font-mono font-semibold tabular-nums ${colorClass}`}>
      {pad(hours)}:{pad(mins)}:{pad(secs)}
    </span>
  );
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}
