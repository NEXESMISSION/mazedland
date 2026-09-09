"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { Home, Search, Plus, LayoutGrid, User } from "lucide-react";

/**
 * Bottom tab bar — full-width, flush-bottom, clean white surface.
 *
 *   - Frosted white background that lets the page peek through subtly,
 *     anchored to the bottom edge. A single hairline top border keeps
 *     it crisp without competing with content.
 *   - Five cells. Cell 3 is the "Sell" FAB — a dark disc that lifts above
 *     the bar's top edge so it pops as the action.
 *   - Active tab: full-contrast icon + label + a pin hanging from the bar's
 *     top edge. Inactive: muted zinc. Hover lightly darkens.
 *   - Safe-area aware: the visible icon row is `--bottombar-h` tall;
 *     the bar background extends below it for the iPhone home indicator.
 */

type Tab = {
  href: "/" | "/annonces" | "/annonces/nouvelle" | "/account/activity" | "/account";
  labelKey: "home" | "browse" | "sell" | "activity" | "account";
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  match: (p: string) => boolean;
  /** Renders the floating navy FAB instead of a regular cell. */
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
    // The catalogue, not the auction list. `/properties` and `/auctions` still
    // exist while the auction product winds down, so they keep lighting this
    // tab up — a bidder who lands there from a notification should not see an
    // unlit navigation bar.
    href: "/annonces",
    labelKey: "browse",
    Icon: Search,
    match: (p) =>
      p === "/annonces" ||
      (p.startsWith("/annonces/") && p !== "/annonces/nouvelle") ||
      p === "/properties" ||
      p.startsWith("/properties/") ||
      p.startsWith("/auctions"),
  },
  {
    // The centre button publishes a fixed-price annonce. `/sell` submits a lot
    // to an auction: a different product, and one that is being retired. It
    // still matches here so the auction wind-down keeps a lit tab.
    href: "/annonces/nouvelle",
    labelKey: "sell",
    Icon: Plus,
    match: (p) =>
      p === "/annonces/nouvelle" || p === "/sell" || p.startsWith("/sell/"),
    isCenter: true,
  },
  {
    href: "/account/activity",
    labelKey: "activity",
    Icon: LayoutGrid,
    match: (p) =>
      p === "/account/activity" ||
      p === "/watchlist" ||
      p.startsWith("/watchlist/"),
  },
  {
    href: "/account",
    labelKey: "account",
    Icon: User,
    match: (p) =>
      p === "/account" ||
      (p.startsWith("/account/") && p !== "/account/activity") ||
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
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 items-center border-t border-border bg-white/90 backdrop-blur-xl shadow-[0_-4px_20px_-8px_rgba(15,23,42,0.06)] lg:hidden"
      style={{
        height: "calc(var(--mazed-bottombar-h) + env(safe-area-inset-bottom))",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {TABS.map((tab) => {
        const Icon = tab.Icon;
        const active = tab.match(pathname);

        if (tab.isCenter) {
          // Gold-gradient FAB — same metallic 135° sweep as the splash,
          // brand mark, and notification modal header. White ring keeps
          // it floating above the bar's hairline border.
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="relative flex h-full items-center justify-center"
              aria-label={t(tab.labelKey)}
              aria-current={active ? "page" : undefined}
            >
              {/* Dark, not gold. It was a gold gradient under a gold glow —
                  the single loudest object on the page, for an action most
                  visitors never take. Same trade as .mazed-btn-luxe: the
                  highest contrast available needs no glow to be found, and it
                  leaves gold to mean one thing, which is money. */}
              <span
                className={`relative inline-flex h-14 w-14 -translate-y-5 items-center justify-center rounded-full bg-foreground text-[var(--background)] shadow-[var(--shadow-lg)] ring-4 ring-[var(--background)] transition-transform active:scale-95 ${
                  active ? "scale-105" : "hover:scale-[1.03]"
                }`}
              >
                <Plus className="size-6" strokeWidth={2.5} />
              </span>
            </Link>
          );
        }

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`relative flex h-full min-w-0 flex-col items-center justify-center gap-1 px-1 transition-colors ${
              active
                ? "text-foreground"
                : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
            }`}
            aria-label={t(tab.labelKey)}
            aria-current={active ? "page" : undefined}
          >
            <Icon
              className={`size-5 transition-transform ${active ? "scale-110" : ""}`}
              strokeWidth={active ? 2.5 : 2}
            />
            <span className="max-w-full truncate text-[10px] font-semibold leading-tight">
              {t(tab.labelKey)}
            </span>
            {/* Active indicator — a pin hanging from the bar's top edge.
                A 4px dot under a 10px label is below the threshold of
                noticing, and it sat where the FAB already draws the eye. */}
            {active && (
              <span className="absolute top-0 h-1 w-10 rounded-b-full bg-foreground" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
