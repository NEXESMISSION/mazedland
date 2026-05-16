"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { Home, Search, Plus, Heart, User } from "lucide-react";

/**
 * Bottom tab bar — full-width, flush-bottom, rounded top corners.
 *
 *   - Spans the whole viewport width and welds to the bottom edge so
 *     it reads as a native-app tab bar (iOS/Android), not a detached
 *     pill. The top corners are rounded so the bar still feels
 *     modern — without that the bar would look like a flat strip.
 *   - The bar background extends under the home indicator on iPhones
 *     (the wrapper takes the safe-area inset as bottom padding), but
 *     the icon row's height stays a clean `--bottombar-h` so the
 *     visible content zone is the same on every device.
 *   - Five cells, with cell 3 reserved for the gold **Sell FAB** —
 *     the polished-brass disc that lifts above the bar's top edge so
 *     it pops out of the rounded curve.
 *   - Active state: gold icon + label, with a 1px gold pin glowing
 *     just inside the top corner of the cell.
 */

type Tab = {
  href: "/" | "/properties" | "/sell" | "/watchlist" | "/account";
  labelKey: "home" | "browse" | "sell" | "watchlist" | "account";
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  match: (p: string) => boolean;
  /** Renders the floating gold FAB instead of a regular cell. */
  isCenter?: boolean;
};

const TABS: Tab[] = [
  {
    href: "/",
    labelKey: "home",
    Icon: Home,
    match: (p) => p === "/",
  },
  {
    href: "/properties",
    labelKey: "browse",
    Icon: Search,
    match: (p) =>
      p === "/properties" ||
      p.startsWith("/properties/") ||
      p.startsWith("/auctions") ||
      p.startsWith("/inspectors"),
  },
  {
    href: "/sell",
    labelKey: "sell",
    Icon: Plus,
    match: (p) => p === "/sell" || p.startsWith("/sell/"),
    isCenter: true,
  },
  {
    href: "/watchlist",
    labelKey: "watchlist",
    Icon: Heart,
    match: (p) => p === "/watchlist" || p.startsWith("/watchlist/"),
  },
  {
    href: "/account",
    labelKey: "account",
    Icon: User,
    match: (p) =>
      p === "/account" ||
      p.startsWith("/account/") ||
      p === "/login" ||
      p === "/signup" ||
      p.startsWith("/kyc") ||
      p.startsWith("/payment") ||
      p.startsWith("/partners") ||
      p.startsWith("/admin"),
  },
];

export function BottomTabBar() {
  const t = useTranslations("shell.tabs");
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 items-center rounded-t-3xl border-t border-gold/20 bg-[rgba(14,14,14,0.96)] backdrop-blur-xl shadow-[0_-12px_36px_-8px_rgba(0,0,0,0.6)]"
      style={{
        // Bar height = visible icon-row height + the device's safe-area
        // inset (home indicator on iPhone). The background extends all
        // the way to the bottom edge; only the content row uses the
        // visible height.
        height: "calc(var(--batta-bottombar-h) + env(safe-area-inset-bottom))",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {TABS.map((tab) => {
        const Icon = tab.Icon;
        const active = tab.match(pathname);

        if (tab.isCenter) {
          // Polished-brass FAB. Negative translate lifts the disc
          // above the bar's top edge so it pops out of the rounded
          // corner curve — the visual "sell" focal point.
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="relative flex h-full items-center justify-center"
              aria-label={t(tab.labelKey)}
              aria-current={active ? "page" : undefined}
            >
              <span
                className={`relative inline-flex h-14 w-14 -translate-y-5 items-center justify-center rounded-full bg-gradient-to-b from-[#f7e07a] via-gold-bright to-gold-soft shadow-[var(--shadow-gold),inset_0_1px_0_0_rgba(255,255,255,0.35),inset_0_-1px_0_0_rgba(0,0,0,0.15)] transition-transform active:scale-95 ${
                  active ? "scale-105" : "hover:scale-[1.03]"
                }`}
              >
                <Plus className="size-6 text-black" strokeWidth={3} />
              </span>
            </Link>
          );
        }

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`relative flex h-full min-w-0 flex-col items-center justify-center gap-1 px-1 transition-colors ${
              active ? "text-gold" : "text-muted hover:text-foreground"
            }`}
            aria-label={t(tab.labelKey)}
            aria-current={active ? "page" : undefined}
          >
            {/* Top gold pin — sits just inside the rounded top so it
                glows along the curve without bleeding off. */}
            {active && (
              <span className="absolute top-1.5 h-1 w-10 rounded-full bg-gold shadow-[0_0_12px_var(--gold-glow)]" />
            )}
            <Icon
              className={`size-5 transition-transform ${active ? "scale-110" : ""}`}
              strokeWidth={active ? 2.5 : 2}
            />
            <span className="max-w-full truncate text-[10px] font-semibold leading-tight">
              {t(tab.labelKey)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
