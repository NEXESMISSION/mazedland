"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Counts a number up from 0 to `to` over `duration` ms, but only starts
 * once the element is intersecting the viewport. Used on the landing
 * stats strip so the numbers tick to life as the user scrolls.
 *
 * `format` controls the output string. We use a string-enum here
 * (instead of a `(n: number) => string` callback) because this is a
 * Client Component rendered from RSCs — functions can't cross the
 * server→client serialization boundary.
 *
 *   "locale"  →  toLocaleString("fr-TN")  e.g. 1 234 — for thousands/grouping
 *   "raw"     →  String(n)                e.g. 24    — for small integers
 *
 * Respects prefers-reduced-motion: skips the animation and renders the
 * final number immediately.
 */
export function CountUp({
  to,
  duration = 1200,
  format = "locale",
  suffix,
  prefix,
}: {
  to: number;
  duration?: number;
  format?: "locale" | "raw";
  suffix?: string;
  prefix?: string;
}) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLSpanElement | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setValue(to);
      return;
    }

    const node = ref.current;
    if (!node) return;

    const start = () => {
      if (started.current) return;
      started.current = true;
      const startedAt = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - startedAt) / duration);
        // ease-out cubic — fast at start, settles smoothly.
        const eased = 1 - Math.pow(1 - t, 3);
        setValue(Math.round(eased * to));
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && start()),
      { threshold: 0.4 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [to, duration]);

  const rendered = format === "raw" ? String(value) : value.toLocaleString("fr-TN");

  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      {rendered}
      {suffix}
    </span>
  );
}
