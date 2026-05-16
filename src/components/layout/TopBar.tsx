"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, Link } from "@/i18n/navigation";
import { BackButton } from "./BackButton";
import { LocaleSwitcher } from "./LocaleSwitcher";

const ROOT_TAB_PATHS = new Set(["/", "/properties", "/watchlist", "/account"]);

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
      className="fixed inset-x-0 top-0 z-40 bg-[#0a0a0a] border-b border-border shadow-[0_2px_18px_rgba(0,0,0,0.35)] pt-safe"
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

        {/* TRAILING — locale switcher */}
        <div className="flex items-center">
          <LocaleSwitcher />
        </div>
      </div>
    </header>
  );
}

function BrandMark() {
  const t = useTranslations("brand");
  const locale = useLocale();
  const isRTL = locale === "ar";
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <Logomark />
      <div className="leading-none">
        <div
          className={`gradient-gold-text text-[18px] font-extrabold tracking-tight ${
            isRTL ? "font-arabic" : ""
          }`}
        >
          {t("name")}
        </div>
        <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.24em] text-muted">
          {t("domain").replace(/^https?:\/\//, "")}
        </div>
      </div>
    </Link>
  );
}

/**
 * Logomark — small dark seal with a gold gavel. Same recipe as the
 * mazed-auto avatar logo (rounded square + gradient gold mark), so
 * the two products look like a family.
 */
function Logomark() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 36 36"
      aria-hidden="true"
      className="shrink-0 rounded-full ring-1 ring-gold/40"
    >
      <defs>
        <linearGradient id="batta-gold-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"  stopColor="#F4D77A" />
          <stop offset="50%" stopColor="#D4AF37" />
          <stop offset="100%" stopColor="#8B6F1F" />
        </linearGradient>
      </defs>
      <rect width="36" height="36" rx="18" fill="#0a0a0a" />
      {/* gavel head + handle in metallic gold */}
      <rect x="14.5" y="11" width="11" height="4.5" rx="1" fill="url(#batta-gold-grad)" transform="rotate(-32 20 13.2)" />
      <rect x="11" y="18.5" width="14" height="2" rx="1" fill="url(#batta-gold-grad)" transform="rotate(-32 18 19.5)" />
      <rect x="9" y="26.5" width="18" height="1.5" rx="0.75" fill="url(#batta-gold-grad)" />
    </svg>
  );
}
