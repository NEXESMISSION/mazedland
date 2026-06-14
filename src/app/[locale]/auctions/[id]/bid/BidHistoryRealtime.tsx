"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Trophy, TrendingUp, Lock, Eye } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { formatTND } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * A bid as served by the `auction_bids_public` view (audit #4): amount + time +
 * a relationship-scoped masked-able name + an is_mine flag, and crucially NO raw
 * bidder_id (which is no longer column-readable). The view also encodes the
 * sealed-bid gate, so we only ever receive rows the caller is allowed to see.
 */
export type PublicBid = {
  id: string;
  auction_id: string;
  amount: number;
  is_proxy: boolean;
  is_winning: boolean;
  placed_at: string;
  bidder_name: string | null;
  is_mine: boolean;
};

interface Props {
  auctionId: string;
  /** SSR seed (from auction_bids_public) — avoids a "..." flash. Newest first. */
  initialBids: PublicBid[];
  /** Total bid count incl. sealed rows hidden by the view. */
  totalBids: number;
  /** Mask non-self bid amounts during live phase (sealed-bid only). */
  isSealedLive: boolean;
  locale: string;
}

/**
 * Privacy-respectful display name. "Ahmed Ben Salem" → "Ahmed B.";
 * a single name passes through; missing → a stable "Enchérisseur".
 */
function maskName(full: string | null | undefined): string {
  const s = (full ?? "").trim();
  if (!s) return "Enchérisseur";
  const parts = s.split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}

/**
 * Realtime leaderboard of bids on one auction. Reads exclusively from the gated
 * `auction_bids_public` view — names + is_mine come from the server, so there's
 * no client-side bidder_id → name resolution (and no bidder_id leaves the DB).
 * A realtime INSERT subscription just triggers an immediate re-fetch of the
 * view; an adaptive poll heals any dropped events. (Realtime payloads no longer
 * carry the name/is_mine, so re-fetching the view is the single source of truth.)
 */
export function BidHistoryRealtime({
  auctionId,
  initialBids,
  totalBids,
  isSealedLive,
  locale,
}: Props) {
  const [bids, setBids] = useState<PublicBid[]>(initialBids);
  const [recentId, setRecentId] = useState<string | null>(null);

  const lastActivityRef = useRef<number>(0);
  // Holds the latest re-fetch fn so the realtime effect can call it without
  // re-subscribing on every render.
  const refetchRef = useRef<() => void>(() => {});
  const topIdRef = useRef<string | null>(initialBids[0]?.id ?? null);

  // Fetch the top-8 from the gated view, reconcile, and flag a fresh top row.
  const fetchTop = useCallback(async () => {
    const supabase = getBrowserSupabase();
    const { data, error } = await supabase
      .from("auction_bids_public")
      .select("id, auction_id, amount, is_proxy, is_winning, placed_at, bidder_name, is_mine")
      .eq("auction_id", auctionId)
      .order("placed_at", { ascending: false })
      .limit(8);
    if (error || !data) return;
    const next = data as unknown as PublicBid[];
    setBids((prev) => {
      if (prev.length === next.length && prev.every((b, i) => b.id === next[i].id)) {
        return prev; // unchanged
      }
      const newTop = next[0]?.id ?? null;
      if (newTop && newTop !== topIdRef.current) {
        topIdRef.current = newTop;
        setRecentId(newTop);
        lastActivityRef.current = Date.now();
      }
      return next;
    });
  }, [auctionId]);

  useEffect(() => {
    refetchRef.current = () => void fetchTop();
  }, [fetchTop]);

  // Realtime: an INSERT on bids for this auction → refetch the view. The payload
  // itself no longer carries name/is_mine (bidder_id is revoked), so the view is
  // the authority; this just makes the refresh instant instead of poll-latency.
  useEffect(() => {
    const supabase = getBrowserSupabase();
    const channel = supabase
      .channel(`auction-history:${auctionId}`)
      .on(
        "postgres_changes" as unknown as never,
        { event: "INSERT", schema: "public", table: "bids", filter: `auction_id=eq.${auctionId}` } as never,
        () => {
          lastActivityRef.current = Date.now();
          refetchRef.current();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [auctionId]);

  // Adaptive poll — safety net for dropped realtime events. HOT 7s within 30s of
  // activity, COLD 30s when quiet. Pauses while the tab is hidden.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const HOT = 7_000, COLD = 30_000, HOT_WINDOW = 30_000;
    const nextInterval = () => (Date.now() - lastActivityRef.current < HOT_WINDOW ? HOT : COLD);

    async function pollOnce() {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) return; // re-armed by visibility listener
      await fetchTop();
      schedule();
    }
    function schedule() {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(pollOnce, nextInterval());
    }
    pollOnce();
    function onVis() {
      if (!document.hidden) pollOnce();
    }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fetchTop]);

  // Clear the "fresh" highlight ~3s after the latest bid arrives.
  useEffect(() => {
    if (!recentId) return;
    const t = setTimeout(() => setRecentId((v) => (v === recentId ? null : v)), 3000);
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
            const isMine = b.is_mine;
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
                        ? "bg-[var(--gold)] text-foreground shadow-[var(--shadow-gold)]"
                        : "bg-[var(--surface-2)] text-[var(--foreground-muted)]",
                    )}
                  >
                    {isLeader ? <Trophy className="h-3.5 w-3.5 lg:h-4 lg:w-4" /> : i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[12px] lg:text-sm font-bold truncate flex items-center gap-1.5">
                      {isMine ? (
                        <span className="text-[var(--gold)]">Vous</span>
                      ) : (
                        <span className="text-[11px] lg:text-[12px] text-[var(--foreground-muted)]">
                          {maskName(b.bidder_name)}
                        </span>
                      )}
                      {isLeader && !isSealedLive && (
                        <span className="hidden lg:inline-flex items-center px-1.5 h-4 rounded-full bg-[var(--gold-faint)] text-[var(--gold)] text-[9px] font-extrabold uppercase tracking-wider">
                          En tête
                        </span>
                      )}
                    </div>
                    <div
                      className="text-[10px] lg:text-[11px] text-[var(--foreground-subtle)] batta-tabular"
                      suppressHydrationWarning
                    >
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
