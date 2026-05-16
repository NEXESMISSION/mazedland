"use client";

import { useEffect, useRef } from "react";

/**
 * Wraps a horizontal snap rail and auto-advances it on a 4s timer. The
 * timer pauses when the user touches the rail or hovers it, and resumes
 * once interaction has stopped for 6s. When the rail reaches the end it
 * loops back to the start.
 *
 * Server-rendered cards live as children so SSR still produces a usable
 * grid even before the JS hydrates. This component only nudges
 * scrollLeft — no markup of its own.
 */
export function TrendingRail({
  children,
  intervalMs = 4000,
  resumeAfterMs = 6000,
}: {
  children: React.ReactNode;
  intervalMs?: number;
  resumeAfterMs?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const lastInteractionAt = useRef<number>(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    const el = ref.current;
    if (!el) return;

    // Pause auto-advance while the user is hovering (desktop) so a
    // mouse user reading a card doesn't have it scrolled out from
    // under them. Touch / pointerdown / wheel set a 6 s cooldown
    // instead — the user has explicitly handed control back when
    // they walk away.
    let hovering = false;
    const note = () => { lastInteractionAt.current = Date.now(); };
    const onEnter = () => { hovering = true; };
    const onLeave = () => { hovering = false; };
    el.addEventListener("touchstart", note, { passive: true });
    el.addEventListener("pointerdown", note, { passive: true });
    el.addEventListener("wheel", note, { passive: true });
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);

    const id = window.setInterval(() => {
      if (hovering) return;
      if (Date.now() - lastInteractionAt.current < resumeAfterMs) return;
      const card = el.querySelector<HTMLElement>(":scope > *");
      if (!card) return;
      // Distance of one card + gap, in the writing direction.
      const isRTL = document.documentElement.dir === "rtl";
      const step = card.offsetWidth + 12 /* matches gap-3 */;

      // Rail is too narrow to scroll — no room for auto-advance.
      if (el.scrollWidth <= el.clientWidth) return;

      const maxScroll = el.scrollWidth - el.clientWidth - 4;
      const atEnd = isRTL
        ? Math.abs(el.scrollLeft) >= maxScroll
        : el.scrollLeft >= maxScroll;

      if (atEnd) {
        el.scrollTo({ left: 0, behavior: "smooth" });
      } else {
        el.scrollBy({ left: isRTL ? -step : step, behavior: "smooth" });
      }
    }, intervalMs);

    return () => {
      window.clearInterval(id);
      el.removeEventListener("touchstart", note);
      el.removeEventListener("pointerdown", note);
      el.removeEventListener("wheel", note);
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [intervalMs, resumeAfterMs]);

  return (
    <div
      ref={ref}
      className="snap-rail hide-scrollbar mt-4 flex gap-3 overflow-x-auto px-4 pb-2"
    >
      {children}
    </div>
  );
}
