"use client";

import { useTranslations, useLocale } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Root tabs — the universal back button hides on these because there's
// nowhere logical to go back to from a top-level surface. Mirrors the
// ROOT_TAB_PATHS set in TopBar.
const ROOT_PATHS = new Set([
  "/",
  "/properties",
  "/auctions",
  "/watchlist",
  "/account",
]);

/**
 * Universal back affordance for the TopBar — ported from mazed-auto.
 *
 * - Hidden on the home / root-tab routes (nothing to go back to).
 * - Navigates to the *logical parent* of the current pathname, not the
 *   previous browser-history entry. This avoids the classic loop where
 *   a page that does a server-side redirect (e.g. /auctions/[id]/bid
 *   redirecting to /auctions/[id] for direct listings) bounces the user
 *   back and forth between two URLs forever.
 * - Chevron flips for RTL so it always points in the page-flow direction.
 *
 * The parent mapping lives in `parentPath()` below — add new overrides
 * there when a route's generic strip-the-last-segment behavior would
 * land somewhere wrong.
 */
export function BackButton() {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations();
  const locale = useLocale();
  const isRTL = locale === "ar";
  const ChevronIcon = isRTL ? ChevronRight : ChevronLeft;

  if (ROOT_PATHS.has(pathname)) return null;

  const parent = parentPath(pathname);

  return (
    <button
      type="button"
      onClick={() => router.push(parent as never)}
      aria-label={t("shell.back")}
      className="
        group relative h-9 w-9 rounded-full shrink-0
        bg-[var(--surface)] border border-[var(--gold-soft)]
        text-[var(--gold)]
        flex items-center justify-center
        hover:bg-[var(--gold-faint)] hover:border-[var(--gold)]
        active:scale-95
        transition-all duration-150
      "
    >
      <ChevronIcon
        className={`h-4 w-4 transition-transform ${
          isRTL ? "group-hover:translate-x-[2px]" : "group-hover:-translate-x-[2px]"
        }`}
        strokeWidth={2.5}
      />
    </button>
  );
}

/**
 * Map a pathname to a sensible "go back" target. Specific overrides come
 * first; the generic rule strips the last URL segment.
 *
 * Add a new override here when stripping the last segment lands somewhere
 * that doesn't exist (e.g. /payment doesn't render anything; we route
 * payment/checkout back to /) or somewhere that creates a redirect loop.
 */
function parentPath(pathname: string): string {
  const overrides: Array<{
    test: RegExp;
    to: string | ((m: RegExpMatchArray) => string);
  }> = [
    // /auctions/[id]/bid → detail page (NOT /auctions/[id]/, which
    // would generic-strip back to /auctions/[id] anyway; explicit so
    // the intent is documented + safe even if /bid grows children).
    {
      test: /^\/auctions\/[^/]+\/bid$/,
      to: (m) => `/auctions/${m[0].split("/")[2]}`,
    },
    // /sell/[id]/schedule and /sell/[id]/edit → /sell (seller dashboard)
    { test: /^\/sell\/[^/]+\/(schedule|edit)$/, to: "/sell" },
    // /payment/* → home. Each payment step is mid-flow; the "parent"
    // is wherever the user came from. Sending them back to / is the
    // safest default — they can re-enter from the auction page.
    { test: /^\/payment\/[^/]+$/, to: "/" },
    // /kyc/[step] → /kyc/start (the wizard hub). /kyc/start itself
    // goes back to /account.
    { test: /^\/kyc\/start$/, to: "/account" },
    { test: /^\/kyc\/[^/]+$/, to: "/kyc/start" },
    // /admin/[section]/[id|sub] → /admin/[section]
    {
      test: /^\/admin\/[^/]+\/[^/]+$/,
      to: (m) => "/admin/" + m[0].split("/")[2],
    },
    // /inspectors/book and /inspectors/apply → /inspectors
    { test: /^\/inspectors\/(book|apply)$/, to: "/inspectors" },
    // /inspectors/[id] → /inspectors
    { test: /^\/inspectors\/[^/]+$/, to: "/inspectors" },
    // Auth-only pages
    {
      test: /^\/(login|signup|forgot-password|reset-password|verify-email|verify-phone)$/,
      to: "/",
    },
    // /account/[section] → /account
    { test: /^\/account\/[^/]+$/, to: "/account" },
    // /partners/[section] → /partners
    { test: /^\/partners\/[^/]+$/, to: "/partners" },
  ];

  for (const o of overrides) {
    const m = pathname.match(o.test);
    if (m) return typeof o.to === "function" ? o.to(m) : o.to;
  }

  // Generic: strip last segment. /a/b/c → /a/b. /a → /.
  const idx = pathname.lastIndexOf("/");
  if (idx <= 0) return "/";
  return pathname.slice(0, idx) || "/";
}
