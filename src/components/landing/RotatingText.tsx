"use client";

import { useEffect, useState } from "react";

/**
 * Auto-cycling label. Fades between strings on a timer — used in the
 * hero "LIVE · متاحة الآن" badge so the same surface keeps two messages
 * in rotation without taking double the horizontal space.
 *
 * Implementation:
 *  - One `<span>` mounts at a time; we swap via `opacity` so layout
 *    stays stable and a screen reader announces the label change as
 *    `aria-live="polite"`.
 *  - First label is rendered SSR-side so there's no flash of empty.
 *  - Stops cleanly on prefers-reduced-motion (snaps without fade), so
 *    a user who opts out still sees the rotation but no animation.
 */
export function RotatingText({
  labels,
  intervalMs = 2400,
  className,
}: {
  labels: string[];
  intervalMs?: number;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [fade, setFade] = useState<"in" | "out">("in");

  useEffect(() => {
    if (labels.length <= 1) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const tick = () => {
      if (reduce) {
        setIndex((i) => (i + 1) % labels.length);
        return;
      }
      setFade("out");
      // Brief fade-out, swap, fade back in. 180ms is short enough to
      // feel snappy but long enough for the eye to register the change.
      window.setTimeout(() => {
        setIndex((i) => (i + 1) % labels.length);
        setFade("in");
      }, 180);
    };

    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [labels, intervalMs]);

  return (
    <span
      className={className}
      aria-live="polite"
      style={{
        display: "inline-block",
        opacity: fade === "in" ? 1 : 0,
        transition: "opacity 180ms ease-out",
      }}
    >
      {labels[index]}
    </span>
  );
}
