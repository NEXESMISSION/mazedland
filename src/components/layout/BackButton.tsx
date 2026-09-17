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
  "/account/activity",
  "/account",
]);

/**
 * Universal back affordance for the TopBar.
 *
 * - Hidden on the home / root-tab routes (already top-level).
 * - Goes BACK when the visitor arrived from inside the app, and home otherwise.
 *   It always went home, which threw away a buyer's filters: « Terrains · Sfax
 *   · page 2 » → open an annonce → back → the home page. Installed as a PWA
 *   there is no browser back button either, so this is the only way back.
 * - Chevron flips for RTL so it always points in the page-flow direction.
 */
export function BackButton() {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations();
  const locale = useLocale();
  const isRTL = locale === "ar";
  const ChevronIcon = isRTL ? ChevronRight : ChevronLeft;

  if (ROOT_PATHS.has(pathname)) return null;

  return (
    <button
      type="button"
      onClick={() => {
        // An empty referrer means a client-side navigation inside the app.
        const cameFromApp =
          !document.referrer || document.referrer.startsWith(window.location.origin);
        if (window.history.length > 1 && cameFromApp) {
          router.back();
          return;
        }
        router.push("/");
      }}
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
