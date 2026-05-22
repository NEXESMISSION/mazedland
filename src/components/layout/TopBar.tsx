"use client";

import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, Link } from "@/i18n/navigation";
import { BackButton } from "./BackButton";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { NotificationBell } from "@/components/notifications/NotificationBell";

const ROOT_TAB_PATHS = new Set(["/", "/properties", "/account/activity", "/account"]);

// Map the first path segment to the i18n key under shell.pageTitles.
// Anything not in here falls back to the brand mark.
const TITLE_BY_SEGMENT: Record<string, string> = {
  properties: "properties",
  auctions: "auctions",
  inspectors: "inspectors",
  watchlist: "watchlist",
  account: "account",
  login: "login",
  signup: "signup",
  kyc: "kyc",
  partners: "partners",
  sell: "sell",
  admin: "admin",
  payment: "payment",
};

/**
 * Mobile-app top bar — ported from the mazed-auto pattern.
 *
 *   - Pure `#0a0a0a` background with a soft black drop, no glass
 *     or hairline gold rule. The chrome stays out of the way so the
 *     page content carries the design weight.
 *   - Brand wordmark on the root pages renders in `gradient-gold-text`
 *     (the same recipe auto uses for "Mazed Auto").
 *   - Inner pages get a back button + plain Jakarta page title, gold
 *     accents only on the active state.
 */
export function TopBar() {
  const t = useTranslations();
  const locale = useLocale();
  const isRTL = locale === "ar";
  const pathname = usePathname();

  const isRoot = ROOT_TAB_PATHS.has(pathname) || pathname === "/";
  const segment = pathname.split("/").filter(Boolean)[0];
  const titleKey = segment ? TITLE_BY_SEGMENT[segment] : undefined;

  return (
    <header
      className="fixed inset-x-0 top-0 z-40 bg-white border-b border-border pt-safe"
      style={{ height: "calc(var(--batta-topbar-h) + var(--batta-safe-top))" }}
    >
      <div className="mx-auto flex h-[var(--batta-topbar-h)] max-w-[var(--max-w-wide)] items-center gap-2 px-4">
        {/* LEADING — back on inner pages, brand on root.
            BackButton lives in its own component so the parent-path
            mapping (which avoids redirect loops on routes like
            /auctions/[id]/bid) is shared with any other surface that
            needs an in-app back affordance. */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isRoot ? (
            <BrandMark />
          ) : (
            <>
              <BackButton />
              {titleKey && (
                <h1
                  className={`truncate text-[16px] font-bold tracking-tight text-foreground ${
                    isRTL ? "font-arabic" : ""
                  }`}
                >
                  {t(`shell.pageTitles.${titleKey}`)}
                </h1>
              )}
            </>
          )}
        </div>

        {/* TRAILING — notifications bell + locale switcher */}
        <div className="flex items-center gap-1">
          <NotificationBell />
          <LocaleSwitcher />
        </div>
      </div>
    </header>
  );
}

function BrandMark() {
  const t = useTranslations("brand");
  // Wordmark sized to read clearly in the top bar — `h-8` (32px) on
  // mobile, `h-9` (36px) on desktop. The ~3.2:1 wordmark auto-scales
  // its width via `w-auto`. `priority` skips the lazy-load — this is
  // above-the-fold on every page that shows the bar. The asset is
  // also `<link rel="preload">`-ed in the root layout, so by the
  // time this paints it's already in cache.
  return (
    <Link href="/" className="flex items-center" aria-label={t("name")}>
      <Image
        src="/logo.png"
        alt={t("name")}
        width={257}
        height={80}
        priority
        sizes="116px"
        className="h-8 w-auto shrink-0 lg:h-9"
      />
    </Link>
  );
}
