"use client";

import { useEffect } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * Heartbeat into `auction_presence` while the user has the page open.
 *
 * The DB-side `place_bid` function checks this table before enqueuing
 * an "auction_outbid" notification — if the user has pinged in the
 * last 45s, the push is skipped because they already see the price
 * move live in the UI. Used by both the auction detail page and the
 * bid page so being on *either* surface counts as "actively watching".
 *
 * Pings:
 *   - immediately on mount
 *   - every 35s while the tab is visible (kept comfortably under the
 *     server's 45s window; a wider interval means fewer DB writes per
 *     viewer — presence cost scales with VIEWERS, not bidders, so this
 *     matters a lot at tens of thousands of concurrent watchers)
 *   - one extra ping when the tab becomes visible again (so a quick
 *     tab-switch doesn't blow past the 45s window).
 *
 * This is the single owner of the heartbeat. Mount it once per surface
 * (auction detail page AND bid page) — do NOT also ping from inside
 * BidComposer, or every bid-page viewer doubles the write load.
 *
 * No-ops when there's no `userId` (anonymous browsers don't need to
 * suppress notifications they wouldn't get anyway).
 */
export function AuctionPresencePing({
  auctionId,
  userId,
}: {
  auctionId: string;
  userId: string | null;
}) {
  useEffect(() => {
    if (!userId) return;
    const supabase = getBrowserSupabase();

    const ping = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void supabase
        .from("auction_presence")
        .upsert(
          { user_id: userId, auction_id: auctionId, seen_at: new Date().toISOString() },
          { onConflict: "user_id,auction_id" },
        );
    };

    ping();
    const intervalId = window.setInterval(ping, 35_000);
    // Tab returns to foreground → ping right away so the 45s window
    // doesn't lapse just because the user briefly switched tabs.
    const onVisibility = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId, auctionId]);

  return null;
}
