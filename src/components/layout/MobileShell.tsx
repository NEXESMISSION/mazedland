"use client";

import { usePathname } from "@/i18n/navigation";
import { TopBar } from "./TopBar";
import { BottomTabBar } from "./BottomTabBar";
import { ScrollToTop } from "./ScrollToTop";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { KYCNudgeModal } from "@/components/kyc/KYCNudgeModal";

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
    return (
      <>
        <ScrollToTop />
        <main className="min-h-screen">{children}</main>
      </>
    );
  }

  return (
    <>
      <ScrollToTop />
      <TopBar />
      <PullToRefresh>
        <main className="batta-shell-main">{children}</main>
      </PullToRefresh>
      <BottomTabBar />
      <KYCNudgeModal />
    </>
  );
}
