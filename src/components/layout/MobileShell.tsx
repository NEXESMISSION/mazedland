import { TopBar } from "./TopBar";
import { BottomTabBar } from "./BottomTabBar";
import { ScrollToTop } from "./ScrollToTop";
import { PullToRefresh } from "@/components/ui/PullToRefresh";

/**
 * Mobile-app shell — top bar, scrollable main, bottom tab bar.
 *
 * The bars sit OUTSIDE the PullToRefresh wrapper on purpose.
 * PullToRefresh applies `will-change: transform` to its inner
 * container, which creates a new containing block for any
 * `position: fixed` descendants. If the bars lived inside, they'd
 * anchor to the wrapper (full document height) instead of the
 * viewport, and the bottom bar would only appear after the user
 * scrolled to the page's bottom.
 *
 * Keeping the bars at this level also means the top bar stays
 * rock-steady while the main content rubber-bands during pull —
 * which is the correct native gesture feel.
 */
export function MobileShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ScrollToTop />
      <TopBar />
      <PullToRefresh>
        <main className="batta-shell-main">{children}</main>
      </PullToRefresh>
      <BottomTabBar />
    </>
  );
}
