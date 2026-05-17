"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import type { ReactElement } from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, Globe } from "lucide-react";

// Compact label on the visible pill — keeps the top bar tight. The
// full Arabic / French / English name is shown inside the menu, where
// there's room to breathe.
const SHORT: Record<string, string> = {
  ar: "ع",
  fr: "FR",
  en: "EN",
};
const FULL: Record<string, string> = {
  ar: "العربية",
  fr: "Français",
  en: "English",
};
// Inline SVG flags. We avoid emoji flags because Windows doesn't ship
// the regional-indicator glyphs by default, so 🇹🇳 falls back to "TN"
// — visually broken next to the locale label.
function FlagSvg({ code }: { code: string }) {
  const stripes: Record<string, ReactElement> = {
    ar: (
      // Tunisia — red field with white disc + red crescent/star
      <>
        <rect width="20" height="14" fill="#e70013" />
        <circle cx="10" cy="7" r="3.6" fill="#ffffff" />
        <circle cx="10.9" cy="7" r="2.8" fill="#e70013" />
        <polygon
          points="10.55,5.55 10.86,6.5 11.85,6.5 11.05,7.1 11.35,8.05 10.55,7.45 9.75,8.05 10.05,7.1 9.25,6.5 10.24,6.5"
          fill="#ffffff"
        />
      </>
    ),
    fr: (
      // France — vertical blue/white/red
      <>
        <rect width="6.67" height="14" x="0"     fill="#0055a4" />
        <rect width="6.67" height="14" x="6.67"  fill="#ffffff" />
        <rect width="6.67" height="14" x="13.33" fill="#ef4135" />
      </>
    ),
    en: (
      // UK Union Jack — simplified
      <>
        <rect width="20" height="14" fill="#012169" />
        <path d="M0,0 L20,14 M20,0 L0,14" stroke="#ffffff" strokeWidth="2.4" />
        <path d="M0,0 L20,14 M20,0 L0,14" stroke="#c8102e" strokeWidth="1.2" />
        <path d="M10,0 V14 M0,7 H20" stroke="#ffffff" strokeWidth="3.6" />
        <path d="M10,0 V14 M0,7 H20" stroke="#c8102e" strokeWidth="2" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 20 14"
      className="block h-3.5 w-5 shrink-0 overflow-hidden rounded-[2px] ring-1 ring-black/10"
      aria-hidden
    >
      {stripes[code] ?? null}
    </svg>
  );
}

/**
 * Custom locale switcher with a popover menu.
 *
 *   - The trigger is a slim dark pill: globe icon + current locale
 *     code + chevron, gold-tinted hairline border. Same visual weight
 *     as any other top-bar chip.
 *   - Tapping opens a popover anchored to the trigger, sliding down
 *     from underneath. Inside: one row per locale (flag + native
 *     name + ISO code), with a metallic-gold check on the active
 *     row.
 *   - Tap-outside / Escape / select-language all close the menu.
 *   - Chevron rotates 180° while open as the affordance for the
 *     menu state.
 *
 * Why not a native `<select>`? The OS picker (full-screen sheet on
 * iOS, drab dropdown on Android) breaks the dark + gold visual
 * language the rest of the app sets up. A custom menu keeps the
 * surface coherent and lets us show flags + native names without
 * fighting browser styling.
 */
export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isRTL = locale === "ar";

  // Close on Escape + on outside click. The listener attaches only
  // while the menu is open so we don't keep a global handler around
  // for the 99% of time the menu is closed.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointer(e: Event) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer, { passive: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [open]);

  function pick(next: string) {
    setOpen(false);
    if (next === locale) return;
    startTransition(() =>
      router.replace(pathname, { locale: next as "ar" | "fr" | "en" }),
    );
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* Trigger pill */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch language"
        className={`inline-flex h-9 items-center gap-1.5 rounded-full border bg-surface/80 px-3 text-xs font-bold text-foreground transition-colors ${
          open
            ? "border-gold/60 shadow-[0_0_0_2px_var(--gold-faint)]"
            : "border-gold/30 hover:border-gold/50"
        }`}
      >
        <Globe className="size-3.5 text-gold" aria-hidden strokeWidth={2} />
        <span className="tabular-nums tracking-wider">
          {SHORT[locale] ?? locale.toUpperCase()}
        </span>
        <ChevronDown
          className={`size-3 text-gold/70 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
          strokeWidth={2.5}
        />
      </button>

      {/* Popover menu — animated in below the trigger. */}
      {open && (
        <div
          role="menu"
          aria-label="Languages"
          className={`batta-fade-up absolute top-full z-50 mt-2 min-w-[200px] origin-top overflow-hidden rounded-xl border border-gold/30 bg-surface shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7),0_0_0_1px_rgba(0,0,0,0.4)] backdrop-blur-xl ${
            isRTL ? "left-0" : "right-0"
          }`}
        >
          {/* Eyebrow inside the menu so the user knows what they're
              looking at without a header bar. */}
          <div className="border-b border-border bg-surface-2 px-3 py-2">
            <span className="batta-eyebrow text-[9.5px]">Language</span>
          </div>
          <ul className="py-1">
            {routing.locales.map((l) => {
              const active = l === locale;
              return (
                <li key={l} role="none">
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => pick(l)}
                    disabled={isPending}
                    dir={l === "ar" ? "rtl" : "ltr"}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-start text-[13px] font-semibold transition-colors disabled:opacity-50 ${
                      active
                        ? "bg-gold-faint text-gold-bright"
                        : "text-foreground hover:bg-surface-2"
                    }`}
                  >
                    <FlagSvg code={l} />
                    <span className="flex-1 truncate">
                      {FULL[l] ?? l.toUpperCase()}
                    </span>
                    {active ? (
                      <Check
                        className="size-4 text-gold"
                        strokeWidth={2.5}
                        aria-hidden
                      />
                    ) : (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                        {l}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
