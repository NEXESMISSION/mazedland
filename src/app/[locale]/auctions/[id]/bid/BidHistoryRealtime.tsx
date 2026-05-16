"use client";

import { useEffect, useState } from "react";
import { Trophy, TrendingUp, Lock, Eye } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { formatTND } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { Bid } from "@/lib/types";

interface Props {
  auctionId: string;
  /** SSR seed — avoids a "..." flash. Newest first. */
  initialBids: Bid[];
  /** Total bid count incl. sealed rows hidden by RLS. */
  totalBids: number;
  /** Current user — bids by this id render as "Vous". */
  userId: string | null;
  /** Mask non-self bid amounts during live phase (sealed-bid only). */
  isSealedLive: boolean;
  locale: string;
}

/**
 * Realtime leaderboard of bids on a single auction. Subscribes to bids
 * INSERT events for this auction. Newest first; rank-1 gets a gold pill
 * and gradient amount. The current user's row is labelled "Vous".
 *
 * For sealed-bid auctions in the live phase, RLS already hides other
 * bidders' amounts at the server. We still receive their `id` rows
 * (count is public) so the leaderboard renders "X autres offres ·
 * révélées à la clôture" instead of looking empty.
 */
export function BidHistoryRealtime({
  auctionId,
  initialBids,
  totalBids,
  userId,
  isSealedLive,
  locale,
}: Props) {
  const [bids, setBids] = useState<Bid[]>(initialBids);
  const [recentId, setRecentId] = useState<string | null>(null);

  // Subscribe to INSERT events on bids for this auction. Dedup by id so
  // an optimistic local insert + the realtime echo don't double-render.
  useEffect(() => {
    const supabase = getBrowserSupabase();
    const channel = supabase
      .channel(`auction-history:${auctionId}`)
      .on(
        "postgres_changes" as unknown as never,
        {
          event: "INSERT",
          schema: "public",
          table: "bids",
          filter: `auction_id=eq.${auctionId}`,
        } as never,
        (payload: { new: Bid }) => {
          setBids((prev) => {
            if (prev.some((b) => b.id === payload.new.id)) return prev;
            return [payload.new, ...prev].slice(0, 8);
          });
          setRecentId(payload.new.id);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [auctionId]);

  // Clear the "fresh" highlight ~3s after the latest bid arrives.
  useEffect(() => {
    if (!recentId) return;
    const t = setTimeout(() => {
      setRecentId((v) => (v === recentId ? null : v));
    }, 3000);
    return () => clearTimeout(t);
  }, [recentId]);

  const hiddenSealedCount = isSealedLive ? Math.max(0, totalBids - bids.length) : 0;

  return (
    <div className="space-y-3 lg:space-y-4">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-2 text-sm">
          <TrendingUp className="h-4 w-4 text-[var(--gold)]" />
          <span className="font-bold">Enchérisseurs</span>
        </div>
        <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--foreground-muted)] batta-tabular">
          {totalBids} {totalBids === 1 ? "offre" : "offres"}
        </span>
      </div>

      {/* Sealed-bid live banner — explains the "X autres" hidden rows */}
      {hiddenSealedCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--gold-soft)]/40 bg-[var(--gold-faint)] px-3 py-2 text-[11px] text-[var(--foreground-muted)]">
          <Eye className="h-3.5 w-3.5 text-[var(--gold)] shrink-0" />
          <span>
            {hiddenSealedCount}{" "}
            {hiddenSealedCount === 1 ? "autre offre placée" : "autres offres placées"} —
            montants révélés à la clôture.
          </span>
        </div>
      )}

      {bids.length === 0 && hiddenSealedCount === 0 ? (
        <div className="py-6 text-center text-[12px] text-[var(--foreground-muted)]">
          Aucune offre pour le moment
          <div className="hidden lg:block text-[11px] text-[var(--foreground-subtle)] mt-1">
            Soyez le premier à enchérir
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border)] lg:divide-y-0 lg:space-y-1.5">
          {bids.map((b, i) => {
            const isMine = b.bidder_id === userId;
            const isLeader = i === 0;
            const isFresh = b.id === recentId;
            const maskedAmount = isSealedLive && !isMine;
            return (
              <li
                key={b.id}
                className={cn(
                  "py-2 lg:py-3 flex items-center justify-between lg:px-3 lg:rounded-xl transition-colors",
                  isFresh && "lg:bg-[var(--gold-faint)] lg:ring-1 lg:ring-[var(--gold)]/30",
                  !isFresh && isLeader && "lg:bg-[var(--surface-2)]/60",
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={cn(
                      "h-7 w-7 lg:h-9 lg:w-9 rounded-full flex items-center justify-center text-[10px] lg:text-[12px] font-bold shrink-0 batta-tabular",
                      isLeader
                        ? "bg-[var(--gold)] text-black shadow-[var(--shadow-gold)]"
                        : "bg-[var(--surface-2)] text-[var(--foreground-muted)]",
                    )}
                  >
                    {isLeader ? (
                      <Trophy className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[12px] lg:text-sm font-bold truncate flex items-center gap-1.5">
                      {isMine ? (
                        <span className="text-[var(--gold)]">Vous</span>
                      ) : (
                        <span className="font-mono text-[11px] lg:text-[12px] text-[var(--foreground-muted)]">
                          {b.bidder_id.slice(0, 6)}…
                        </span>
                      )}
                      {b.is_proxy && (
                        <span className="text-[9px] font-extrabold uppercase tracking-wider text-[var(--gold)]">
                          PROXY
                        </span>
                      )}
                      {isLeader && !isSealedLive && (
                        <span className="hidden lg:inline-flex items-center px-1.5 h-4 rounded-full bg-[var(--gold-faint)] text-[var(--gold)] text-[9px] font-extrabold uppercase tracking-wider">
                          En tête
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] lg:text-[11px] text-[var(--foreground-subtle)] batta-tabular">
                      {formatRelativeTime(b.placed_at)}
                    </div>
                  </div>
                </div>
                <div
                  className={cn(
                    "font-bold lg:font-extrabold batta-tabular text-[13px] lg:text-base shrink-0",
                    isLeader && !maskedAmount && "gradient-gold-text lg:text-lg",
                  )}
                >
                  {maskedAmount ? (
                    <span className="inline-flex items-center gap-1 text-[var(--foreground-muted)] font-mono text-xs">
                      <Lock className="h-3 w-3" />
                      sealed
                    </span>
                  ) : (
                    formatTND(Number(b.amount), locale)
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h`;
  return `${Math.floor(hr / 24)} j`;
}
