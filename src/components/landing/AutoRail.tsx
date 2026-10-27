"use client";

import { useEffect, useId, useRef } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSetting } from "@/components/settings/SettingsProvider";
import {
  RESUME_AFTER_MS,
  arrowTarget,
  autoplayTarget,
  canPlay,
  logicalScroll,
  logicalStart,
  nextDelay,
  physicalScrollLeft,
  type RailPause,
} from "@/lib/home/autoRail";

/**
 * A horizontal snap rail of the home page that moves by itself: one card every
 * `home_rail_seconds`, back to the first after the last, while
 * `home_rail_autoplay` is on.
 *
 * It holds still whenever someone might be reading it — under the mouse, under
 * a finger, holding the keyboard focus, for a few seconds after a swipe, a
 * wheel or an arrow — and whenever nobody can see it: off-screen or in a
 * hidden tab. Never with `prefers-reduced-motion`. A rail that is holding
 * still has no timer at all, so a page of ten rails runs one or two.
 *
 * The cards are server-rendered children, so the rail is a usable scroller
 * before (and without) the JavaScript. The arithmetic, including the
 * right-to-left scrollLeft, is in `@/lib/home/autoRail`.
 *
 * `TrendingRail` is the older one, still used under an annonce; it knows
 * nothing of the settings.
 */
export function AutoRail({
  children,
  arrows = false,
}: {
  children: React.ReactNode;
  /** Previous / next buttons over the rail's edges, from lg up. */
  arrows?: boolean;
}) {
  const t = useTranslations("landing.carousel");
  const autoplay = useSetting("home_rail_autoplay");
  const seconds = useSetting("home_rail_seconds");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const railId = useId();

  useEffect(() => {
    const root = rootRef.current;
    const rail = railRef.current;
    if (!root || !rail || !autoplay) return;
    if (prefersReducedMotion()) return;

    const intervalMs = Math.max(1, seconds) * 1000;
    const pause: RailPause = { hovering: false, touching: false, focused: false, inView: false, hidden: document.hidden };
    let resumeAt = 0;
    let timer: number | undefined;

    const stop = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    // The one place a timer is started: any change of state comes through here.
    const schedule = () => {
      stop();
      if (canPlay(pause)) timer = window.setTimeout(tick, nextDelay(Date.now(), intervalMs, resumeAt));
    };
    const tick = () => {
      timer = undefined;
      if (!canPlay(pause)) return;
      const m = measure(rail);
      const target = autoplayTarget(m.targets, m.scroll, m.maxScroll);
      // Every card fits: nothing to move, and nothing to wake up for.
      if (target === null) return;
      rail.scrollTo({ left: physicalScrollLeft(target, m.rtl), behavior: "smooth" });
      schedule();
    };

    // Someone moved the rail, or is about to: give it back to them for a while.
    const handBack = () => {
      resumeAt = Date.now() + RESUME_AFTER_MS;
      schedule();
    };
    const onPointerEnter = (e: PointerEvent) => {
      // A finger "enters" on a tap and never leaves; only a mouse or a pen hovers.
      if (e.pointerType === "touch") return;
      pause.hovering = true;
      stop();
    };
    const onPointerLeave = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      pause.hovering = false;
      schedule();
    };
    const onTouchStart = () => {
      pause.touching = true;
      stop();
    };
    const onTouchEnd = () => {
      pause.touching = false;
      handBack();
    };
    const onFocusIn = () => {
      pause.focused = true;
      stop();
    };
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget instanceof Node && root.contains(e.relatedTarget)) return;
      pause.focused = false;
      handBack();
    };
    const onVisibility = () => {
      pause.hidden = document.hidden;
      schedule();
    };

    root.addEventListener("pointerenter", onPointerEnter);
    root.addEventListener("pointerleave", onPointerLeave);
    root.addEventListener("pointerdown", handBack, { passive: true });
    root.addEventListener("wheel", handBack, { passive: true });
    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchend", onTouchEnd, { passive: true });
    root.addEventListener("touchcancel", onTouchEnd, { passive: true });
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    document.addEventListener("visibilitychange", onVisibility);

    // In view = inside the middle of the screen, not a strip peeking at its
    // edge: a rail nobody is looking at does not need to move.
    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        ([entry]) => {
          pause.inView = entry.isIntersecting;
          schedule();
        },
        { rootMargin: "-15% 0px" },
      );
      observer.observe(root);
    } else {
      pause.inView = true;
      schedule();
    }

    return () => {
      stop();
      observer?.disconnect();
      root.removeEventListener("pointerenter", onPointerEnter);
      root.removeEventListener("pointerleave", onPointerLeave);
      root.removeEventListener("pointerdown", handBack);
      root.removeEventListener("wheel", handBack);
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchEnd);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [autoplay, seconds]);

  // The arrows need no word with the timer: pressing one is a pointerdown (or
  // a focus) inside the rail, which already holds it still.
  const go = (dir: 1 | -1) => {
    const rail = railRef.current;
    if (!rail) return;
    const m = measure(rail);
    rail.scrollTo({
      left: physicalScrollLeft(arrowTarget(m.targets, m.scroll, m.maxScroll, dir), m.rtl),
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  };

  return (
    <div ref={rootRef} className="relative">
      <div
        ref={railRef}
        id={railId}
        className="snap-rail hide-scrollbar mt-4 flex gap-3 overflow-x-auto px-4 pb-2"
      >
        {children}
      </div>
      {arrows && (
        <>
          <button
            type="button"
            aria-label={t("prev")}
            aria-controls={railId}
            onClick={() => go(-1)}
            className="absolute start-1 top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-white/90 text-foreground shadow-[0_8px_24px_-10px_rgba(15,23,42,0.4)] backdrop-blur transition hover:border-gold-soft hover:text-gold active:scale-95 lg:flex"
          >
            <ChevronLeft className="size-5 rtl:-scale-x-100" strokeWidth={2.4} />
          </button>
          <button
            type="button"
            aria-label={t("next")}
            aria-controls={railId}
            onClick={() => go(1)}
            className="absolute end-1 top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-white/90 text-foreground shadow-[0_8px_24px_-10px_rgba(15,23,42,0.4)] backdrop-blur transition hover:border-gold-soft hover:text-gold active:scale-95 lg:flex"
          >
            <ChevronRight className="size-5 rtl:-scale-x-100" strokeWidth={2.4} />
          </button>
        </>
      )}
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * The rail as the arithmetic needs it: where each card would sit at the start
 * (less the scroll padding, so it lands where scroll-snap puts it), where the
 * rail is, and how far it can go. Read on demand — one layout read every few
 * seconds, nothing on scroll.
 */
function measure(rail: HTMLElement) {
  const style = getComputedStyle(rail);
  const rtl = style.direction === "rtl";
  const pad = parseFloat(style.scrollPaddingInlineStart) || 0;
  const box = rail.getBoundingClientRect();
  const scroll = logicalScroll(rail.scrollLeft, rtl);
  const targets = Array.from(rail.children, (card) => logicalStart(card.getBoundingClientRect(), box, scroll, rtl) - pad);
  return { rtl, targets, scroll, maxScroll: rail.scrollWidth - rail.clientWidth };
}
