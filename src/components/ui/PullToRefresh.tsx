"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/**
 * Native-feeling pull-to-refresh. Listens to touch events at the top
 * of the page; pulls down a spinner indicator that follows the finger
 * with rubber-banding; commits a `router.refresh()` past a threshold.
 *
 * Only engages when:
 *   - the page is scrolled to the top (window.scrollY === 0)
 *   - the user actually drags downward (deltaY > 0)
 *
 * Uses CSS transforms for the drag — no React re-render per frame so
 * the gesture stays smooth on low-end Android.
 *
 * Iframes (the OSM map embed) and inputs swallow touch events
 * naturally, so this won't accidentally fire from inside them.
 */
const TRIGGER_THRESHOLD_PX = 80;
const RUBBERBAND_FACTOR = 0.45;
const MAX_PULL_PX = 140;

export function PullToRefresh({
  children,
  enabled = true,
}: {
  children: React.ReactNode;
  /** Disable on routes where the gesture conflicts (e.g. internal scrollers). */
  enabled?: boolean;
}) {
  const router = useRouter();
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const startY = useRef<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    // Coarse-pointer check — desktop with a mouse should not get this.
    const isCoarse = window.matchMedia("(pointer: coarse)").matches;
    if (!isCoarse) return;

    const indicator = indicatorRef.current;
    const wrap = wrapRef.current;
    if (!indicator || !wrap) return;

    function setOffset(px: number) {
      const clamped = Math.max(0, Math.min(MAX_PULL_PX, px));
      const progress = Math.min(1, clamped / TRIGGER_THRESHOLD_PX);
      indicator!.style.transform = `translate3d(-50%, ${clamped - 60}px, 0)`;
      indicator!.style.opacity = String(Math.min(1, progress * 1.4));
      // Rotate the spinner during pull so it feels alive even before commit.
      const rotation = progress * 360;
      const inner = indicator!.firstElementChild as HTMLElement | null;
      if (inner) inner.style.transform = `rotate(${rotation}deg)`;
      // Slight content nudge — gives the gesture a tactile "weight".
      wrap!.style.transform = clamped > 0 ? `translate3d(0, ${clamped * 0.3}px, 0)` : "";
    }

    function reset(animate = true) {
      if (!indicator || !wrap) return;
      if (animate) {
        indicator.style.transition = "transform 200ms ease-out, opacity 200ms ease-out";
        wrap.style.transition = "transform 200ms ease-out";
      }
      indicator.style.transform = "translate3d(-50%, -60px, 0)";
      indicator.style.opacity = "0";
      wrap.style.transform = "";
      // Clear transitions after they settle so the next drag is direct again.
      window.setTimeout(() => {
        if (indicator) indicator.style.transition = "";
        if (wrap) wrap.style.transition = "";
      }, 220);
    }

    function onTouchStart(e: TouchEvent) {
      if (refreshing) return;
      // Only arm at the very top of the document.
      if ((window.scrollY || document.documentElement.scrollTop) > 0) {
        startY.current = null;
        return;
      }
      // Bail when the touch lands inside an internal scroller (e.g.
      // the Reels feed's snap container). Without this guard,
      // window.scrollY is 0 because the body never scrolls — the
      // inner element does — and PullToRefresh would otherwise
      // hijack every downward swipe and refresh the page.
      const target = e.target as Element | null;
      if (target?.closest("[data-prevent-pull-to-refresh]")) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0].clientY;
    }

    function onTouchMove(e: TouchEvent) {
      if (startY.current === null || refreshing) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) {
        // Upward drag — let the page scroll normally.
        startY.current = null;
        reset();
        return;
      }
      // Rubberbanding so it feels physical, not linear.
      const eased = delta * RUBBERBAND_FACTOR;
      setOffset(eased);
      // Block native overscroll only when we're in our active gesture; lets
      // horizontal swipes (like the photo thumbnail rail) still work.
      if (e.cancelable) e.preventDefault();
    }

    function onTouchEnd(e: TouchEvent) {
      if (startY.current === null || refreshing) return;
      const lastY = e.changedTouches[0].clientY;
      const delta = (lastY - startY.current) * RUBBERBAND_FACTOR;
      startY.current = null;
      if (delta >= TRIGGER_THRESHOLD_PX) {
        // Snap to "loading" position and commit.
        setOffset(TRIGGER_THRESHOLD_PX);
        setRefreshing(true);
        // router.refresh() is synchronous-ish — trigger but also auto-reset
        // after a max of 1.5s in case the network is sluggish so we don't
        // strand the user on the spinner.
        router.refresh();
        window.setTimeout(() => {
          setRefreshing(false);
          reset();
        }, 700);
      } else {
        reset();
      }
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [enabled, refreshing, router]);

  return (
    <>
      {/* Spinner indicator — fixed-position so it floats over the chrome. */}
      <div
        ref={indicatorRef}
        aria-hidden
        className="pointer-events-none fixed left-1/2 top-[calc(var(--batta-topbar-h)+var(--batta-safe-top))] z-[60] flex size-12 items-center justify-center rounded-full bg-batta-surface shadow-lg shadow-black/50 ring-1 ring-batta-gold/30"
        style={{
          transform: "translate3d(-50%, -60px, 0)",
          opacity: 0,
          willChange: "transform, opacity",
        }}
      >
        <RefreshCw
          className={`size-5 text-batta-gold-bright ${refreshing ? "animate-spin" : ""}`}
          strokeWidth={2.4}
        />
      </div>

      {/* The wrap is what we translate during the pull so the content
          follows the gesture. Full-bleed by default. */}
      <div ref={wrapRef} style={{ willChange: "transform" }}>
        {children}
      </div>
    </>
  );
}
