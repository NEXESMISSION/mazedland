"use client";

import { useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { Flame } from "lucide-react";
import { LiveCountdown } from "./LiveCountdown";

export type EndingSoonItem = {
  id: string;
  title: string;
  governorate: string;
  endsAt: string;
};

/**
 * Auto-advancing slider for the "ending soon" banner when there are
 * multiple about-to-close auctions. Each slide gets ~1.5 s of prime
 * eye-line time before rotating to the next, then loops. We keep
 * every <LiveCountdown> mounted simultaneously (they're cheap, just
 * setInterval(1s) each) so the per-second countdown stays accurate
 * across rotations without remount jitter.
 *
 * Pauses when the tab is hidden so we don't burn CPU on a background
 * tab; resumes when it returns. Also pauses while a pointer is over
 * the rail so a tap doesn't fight a rotation transition mid-press.
 */
const SLIDE_MS = 1_500;

export function EndingSoonSlider({ items }: { items: EndingSoonItem[] }) {
  const [index, setIndex] = useState(0);
  const pausedRef = useRef(false);

  useEffect(() => {
    if (items.length <= 1) return;

    function tick() {
      if (typeof document !== "undefined" && document.hidden) return;
      if (pausedRef.current) return;
      setIndex((i) => (i + 1) % items.length);
    }
    const id = window.setInterval(tick, SLIDE_MS);

    // When the tab returns, resync to the first slide so the user
    // doesn't land on whatever phantom index the paused interval was
    // about to advance to. Cheap and reads as "fresh".
    function onVisibility() {
      if (!document.hidden) setIndex(0);
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [items.length]);

  return (
    <div
      className="relative"
      onPointerEnter={() => { pausedRef.current = true; }}
      onPointerLeave={() => { pausedRef.current = false; }}
    >
      {/* Slides — one stacked on top of the other. Only the current one
          is interactive (opacity 1, pointer-events on); the rest stay
          mounted so their countdowns keep ticking. The shadow lives on
          the wrapper (not each slide) so the cross-fade doesn't strobe
          a halo on every tick. */}
      <div className="relative overflow-hidden rounded-2xl shadow-lg shadow-red-500/25">
        {/* Sizer — invisible copy of the longest slide so the wrapper
            keeps a steady height even while opacity-swapping. Without
            it the absolutely-positioned children would collapse the
            parent to 0px. */}
        <div className="invisible">
          <Slide item={items[0]} />
        </div>

        {items.map((item, i) => (
          <div
            key={item.id}
            aria-hidden={i !== index}
            className={`absolute inset-0 transition-opacity duration-300 ease-out ${
              i === index ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            <Slide item={item} />
          </div>
        ))}
      </div>

      {/* Progress dots — gives the user a sense of "n of m" so the
          rotation reads as intentional rather than a glitch. Tap a dot
          to jump to that slide; we DON'T stop the auto-rotation on tap
          because the dots are a peek, not a takeover. */}
      <div className="mt-2 flex items-center justify-center gap-1.5">
        {items.map((it, i) => (
          <button
            key={it.id}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Voir ${it.title}`}
            className={`size-1.5 rounded-full transition-all ${
              i === index
                ? "w-4 bg-red-500"
                : "bg-foreground/20 hover:bg-foreground/40"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function Slide({ item }: { item: EndingSoonItem }) {
  return (
    <Link
      href={`/auctions/${item.id}` as `/auctions/${string}`}
      className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-red-600 to-red-500 p-3 text-white active:scale-[0.99] transition"
    >
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/15">
        <Flame className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-wider text-white/80">
          Ending soon
        </div>
        <div className="truncate text-sm font-bold">
          {item.title} · {item.governorate}
        </div>
      </div>
      <div className="shrink-0">
        <LiveCountdown endsAt={item.endsAt} />
      </div>
    </Link>
  );
}
