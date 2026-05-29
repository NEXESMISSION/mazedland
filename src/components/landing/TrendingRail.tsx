"use client";

import { useCallback, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Wraps a horizontal snap rail and auto-advances it on a 4s timer. The
 * timer pauses when the user touches the rail or hovers it, and resumes
 * once interaction has stopped for 6s. When the rail reaches the end it
 * loops back to the start.
 *
 * Server-rendered cards live as children so SSR still produces a usable
 * grid even before the JS hydrates. This component only nudges
 * scrollLeft — no markup of its own.
 *
 * `arrows` opts the rail into desktop prev/next buttons (gated `lg:flex`,
 * so phones never see them — the mobile rail render stays untouched).
 */
export function TrendingRail({
  children,
  intervalMs = 4000,
  resumeAfterMs = 6000,
  arrows = false,
}: {
  children: React.ReactNode;
  intervalMs?: number;
  resumeAfterMs?: number;
  arrows?: boolean;
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

  const scrollByDir = useCallback((dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    lastInteractionAt.current = Date.now();
    const isRTL = document.documentElement.dir === "rtl";
    const card = el.querySelector<HTMLElement>(":scope > *");
    const step = (card ? card.offsetWidth : 300) + 12; // card + gap-3
    el.scrollBy({ left: (isRTL ? -dir : dir) * step, behavior: "smooth" });
  }, []);

  const rail = (
    <div
      ref={ref}
      className="snap-rail hide-scrollbar mt-4 flex gap-3 overflow-x-auto px-4 pb-2"
    >
      {children}
    </div>
  );

  // Mobile keeps the bare rail — identical render, no chrome.
  if (!arrows) return rail;

  // Desktop adds floating prev/next controls over the rail edges.
  return (
    <div className="relative">
      {rail}
      <button
        type="button"
        aria-label="Précédent"
        onClick={() => scrollByDir(-1)}
        className="absolute top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-white/90 text-foreground shadow-[0_8px_24px_-10px_rgba(15,23,42,0.4)] backdrop-blur transition hover:border-gold-soft hover:text-gold active:scale-95 lg:flex ltr:left-1 rtl:right-1"
      >
        <ChevronLeft className="size-5 rtl:hidden" strokeWidth={2.4} />
        <ChevronRight className="hidden size-5 rtl:block" strokeWidth={2.4} />
      </button>
      <button
        type="button"
        aria-label="Suivant"
        onClick={() => scrollByDir(1)}
        className="absolute top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-white/90 text-foreground shadow-[0_8px_24px_-10px_rgba(15,23,42,0.4)] backdrop-blur transition hover:border-gold-soft hover:text-gold active:scale-95 lg:flex ltr:right-1 rtl:left-1"
      >
        <ChevronRight className="size-5 rtl:hidden" strokeWidth={2.4} />
        <ChevronLeft className="hidden size-5 rtl:block" strokeWidth={2.4} />
      </button>
    </div>
  );
}
