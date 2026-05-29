"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { Search, User, Plus } from "lucide-react";

/**
 * Desktop (lg+) horizontal navigation. Replaces the mobile TopBar +
 * BottomTabBar on wide viewports (both are `lg:hidden`). Self-hides
 * below lg via `hidden lg:flex`, so the mobile chrome is the single
 * source of navigation on phones/tablets and stays untouched.
 *
 * Balanced three-zone bar:
 *   - Left: logo (→ home) + primary links with a soft active pill.
 *   - Center: an always-visible search that lands on the unified
 *     /properties explore surface.
 *   - Right: notification bell, account, and a saturated "Vendre" CTA.
 *
 * Height is pinned to --desktop-nav-h; the shell's top padding switches
 * to the same value at lg (see .batta-shell-main in globals.css).
 */

const LINKS: { href: "/" | "/properties" | "/account/activity"; key: "home" | "browse" | "activity" }[] = [
  { href: "/", key: "home" },
  { href: "/properties", key: "browse" },
  { href: "/account/activity", key: "activity" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/properties") {
    return (
      pathname === "/properties" ||
      pathname.startsWith("/properties/") ||
      pathname.startsWith("/auctions")
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DesktopNav() {
  const t = useTranslations("shell.tabs");
  const tn = useTranslations("nav");
  const pathname = usePathname();

  return (
    <header className="fixed inset-x-0 top-0 z-40 hidden h-[var(--desktop-nav-h)] items-center border-b border-border/70 bg-white/80 backdrop-blur-2xl lg:flex">
      <div className="mx-auto flex h-full w-full max-w-[var(--max-w-wide)] items-center gap-6 px-8">
        {/* ── Left zone: brand + primary links ── */}
        <div className="flex shrink-0 items-center gap-7">
          <Link href="/" className="flex shrink-0 items-center" aria-label="Batta">
            <Image
              src="/logo.png"
              alt="Batta"
              width={257}
              height={80}
              priority
              sizes="128px"
              className="h-9 w-auto"
            />
          </Link>

          <nav className="flex items-center gap-1" aria-label="Primary">
            {LINKS.map((l) => {
              const active = isActive(pathname, l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full px-3.5 py-2 text-[13.5px] font-semibold transition-colors ${
                    active
                      ? "bg-gold-faint text-[var(--gold)]"
                      : "text-[var(--foreground-muted)] hover:bg-surface-2 hover:text-[var(--foreground)]"
                  }`}
                >
                  {t(l.key)}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* ── Center zone: always-visible search, lands on /properties ── */}
        <div className="flex flex-1 justify-center">
          <Link
            href="/properties"
            className="group flex w-full max-w-md items-center gap-2.5 rounded-full border border-border bg-surface-2 px-4 py-2.5 text-[13px] text-muted transition-colors hover:border-gold-soft/70 hover:bg-surface"
          >
            <Search className="size-4 shrink-0 transition-colors group-hover:text-gold" strokeWidth={2} />
            <span className="truncate">{tn("properties")}</span>
          </Link>
        </div>

        {/* ── Right zone: notifications, account, sell CTA ── */}
        <div className="flex shrink-0 items-center gap-2">
          <NotificationBell />
          <Link
            href="/account"
            aria-label={t("account")}
            className={`inline-flex size-10 items-center justify-center rounded-full border transition-colors ${
              isActive(pathname, "/account")
                ? "border-gold-soft bg-gold-faint text-gold"
                : "border-border text-muted hover:border-gold-soft/60 hover:text-foreground"
            }`}
          >
            <User className="size-5" strokeWidth={2} />
          </Link>
          <Link
            href="/sell"
            className="batta-gold-fill inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-[13px] font-bold shadow-[var(--shadow-gold)] transition active:scale-[0.98]"
          >
            <Plus className="size-4" strokeWidth={2.5} />
            {t("sell")}
          </Link>
        </div>
      </div>
    </header>
  );
}
