"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { ChevronLeft } from "lucide-react";
import { TopBar } from "./TopBar";
import { DesktopNav } from "./DesktopNav";
import { BottomTabBar } from "./BottomTabBar";
import { ScrollToTop } from "./ScrollToTop";
import { PullToRefresh } from "@/components/ui/PullToRefresh";

/**
 * Mobile-app shell — top bar, scrollable main, bottom tab bar.
 *
 * Flow routes (KYC, payment, auth) opt out of the chrome — they render
 * their own dedicated header (KYCShell, CheckoutClient, auth forms) so
 * stacking the global TopBar + BottomTabBar on top produces a double
 * back button and wasted vertical space.
 *
 * The bars sit OUTSIDE the PullToRefresh wrapper as a belt-and-braces
 * measure — the wrapper used to set `will-change: transform` which
 * created a containing block for fixed descendants. That's been
 * removed (the active translate during a pull already promotes a
 * compositor layer), so fixed children now anchor to the viewport
 * the way they should.
 */
function isFlowRoute(pathname: string): boolean {
  return (
    // The admin console is its own self-contained desktop shell (its own
    // sidebar nav) — it must NOT also carry the consumer TopBar /
    // DesktopNav / BottomTabBar, or the two navigations stack and the
    // page reads as cluttered.
    pathname.startsWith("/admin") ||
    pathname.startsWith("/kyc") ||
    pathname.startsWith("/payment") ||
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/verify-email" ||
    pathname === "/verify-phone"
  );
}

export function MobileShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const flow = isFlowRoute(pathname);

  if (flow) {
    // The auth screens carry no chrome of their own, and installed as a PWA
    // there is no browser back button either: tapping Compte while signed out
    // left the visitor on the login screen with no way back into the site.
    const authFlow =
      pathname === "/login" ||
      pathname === "/signup" ||
      pathname === "/forgot-password" ||
      pathname === "/reset-password";
    return (
      <>
        <ScrollToTop />
        {authFlow && (
          <Link
            href="/"
            className="tap-target fixed start-3 top-3 z-50 inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-surface/90 px-3.5 text-[12.5px] font-bold text-foreground shadow-sm backdrop-blur transition hover:border-gold-soft"
          >
            <ChevronLeft className="size-4" strokeWidth={2.4} />
            Accueil
          </Link>
        )}
        <main id="main-content" tabIndex={-1} className="min-h-screen">{children}</main>
      </>
    );
  }

  return (
    <>
      <ScrollToTop />
      <TopBar />
      <DesktopNav />
      <PullToRefresh>
        <main id="main-content" tabIndex={-1} className="mazed-shell-main">{children}</main>
      </PullToRefresh>
      <BottomTabBar />
      {/* The KYC nudge stood here. It pushed the visitor towards identity
          verification, which existed so a bidder could be held to a bid.
          Nothing in the classifieds product asks for an identity. */}
    </>
  );
}
