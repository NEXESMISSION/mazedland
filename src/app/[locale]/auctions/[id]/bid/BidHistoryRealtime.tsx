"use client";

import { useEffect, useRef, useState } from "react";
import { Trophy, TrendingUp, Lock, Eye } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { formatTND } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { Bid } from "@/lib/types";

/**
 * `Bid` from the server may carry an embedded `bidder` profile when the
 * query joined on profiles. The shape is whatever Supabase's join
 * returns — single object for a `to-one` FK, or null if the profile is
 * missing.
 */
type EnrichedBid = Bid & {
  bidder?: { full_name: string | null } | null;
};

interface Props {
  auctionId: string;
  /** SSR seed — avoids a "..." flash. Newest first. */
  initialBids: EnrichedBid[];
  /** Total bid count incl. sealed rows hidden by RLS. */
  totalBids: number;
  /** Current user — bids by this id render as "Vous". */
  userId: string | null;
  /** Mask non-self bid amounts during live phase (sealed-bid only). */
  isSealedLive: boolean;
  locale: string;
}

/**
 * Privacy-respectful display name. "Ahmed Ben Salem" → "Ahmed B.";
 * a single name passes through unchanged; missing name → a stable
 * "Enchérisseur" placeholder. Beats showing the raw UUID slice
 * ("ec0043…") on every row, which leaks ids and reads as a bug.
 */
function maskName(full: string | null | undefined): string {
  const s = (full ?? "").trim();
  if (!s) return "Enchérisseur";
  const parts = s.split(/\s+/);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const last = parts[parts.length - 1];
  const initial = last.charAt(0);
  return `${first} ${initial}.`;
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
  const [bids, setBids] = useState<EnrichedBid[]>(initialBids);
  const [recentId, setRecentId] = useState<string | null>(null);

  // Cache of bidder_id → display name. Seeded from the SSR bids' joined
  // profile, kept hot by the poll, and queried-on-demand when a
  // realtime INSERT arrives for a bidder we haven't seen yet. Avoids
  // re-fetching the same profile every tick.
  const nameCacheRef = useRef<Map<string, string>>(
    new Map(
      initialBids
        .filter((b) => b.bidder?.full_name)
        .map((b) => [b.bidder_id, b.bidder!.full_name as string]),
    ),
  );
  // Bump this counter when the cache grows, so the rendered list
  // re-renders with the freshly resolved names (Map mutations alone
  // don't trigger React).
  const [nameVersion, setNameVersion] = useState(0);

  // Shared activity timestamp — bumped by the realtime INSERT handler
  // AND by the poll when it spots a new bid id. The adaptive poll
  // downstream reads this to switch between HOT (1 s) and COLD (4 s)
  // cadence so quiet auctions don't pay the bidding-feel price.
  const lastActivityRef = useRef<number>(0);

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
          lastActivityRef.current = Date.now();
          const incoming = payload.new;
          setBids((prev) => {
            if (prev.some((b) => b.id === incoming.id)) return prev;
            // Realtime INSERT payloads don't carry the joined profile,
            // so we attach the cached name (if known); the on-demand
            // fetch below fills it in for a brand-new bidder.
            const cachedName = nameCacheRef.current.get(incoming.bidder_id);
            const enriched: EnrichedBid = cachedName
              ? { ...incoming, bidder: { full_name: cachedName } }
              : { ...incoming, bidder: null };
            return [enriched, ...prev].slice(0, 8);
          });
          setRecentId(incoming.id);

          // First time we've seen this bidder? Look up their profile
          // once and cache the name — every subsequent bid from them
          // (this session) resolves instantly.
          if (!nameCacheRef.current.has(incoming.bidder_id)) {
            void supabase
              .from("profiles")
              .select("full_name")
              .eq("id", incoming.bidder_id)
              .maybeSingle()
              .then((res: { data: { full_name: string | null } | null }) => {
                const name = res.data?.full_name ?? null;
                if (!name) return;
                nameCacheRef.current.set(incoming.bidder_id, name);
                setNameVersion((v) => v + 1);
              });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [auctionId]);

  // Polling fallback — a SAFETY NET, not the live channel. The realtime
  // INSERT subscription above is the primary path and pushes new bids
  // instantly; this poll only reconciles the top-8 leaderboard for the
  // rare INSERT event Supabase Realtime drops. The query here is heavier
  // (a join to profiles), so at tens of thousands of concurrent viewers
  // a 1 s cadence was the single biggest DB-load source. Slowed on
  // purpose — realtime keeps the feed instant, the poll just heals gaps.
  //
  //   HOT  (7 s)  — bid landed in the last 30 s, OR the poll itself
  //                 detected a new row id (means realtime missed it).
  //   COLD (30 s) — quiet for 30 s. Idle auctions drop here.
  //
  // Without this poll, two clients could each see *themselves* as the
  // leader because their local bid was the only one their realtime
  // channel ever received. Order matches the bid page's SSR query:
  // placed_at DESC LIMIT 8. Pauses while the tab is hidden.
  useEffect(() => {
    const supabase = getBrowserSupabase();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const HOT_INTERVAL_MS = 7_000;
    const COLD_INTERVAL_MS = 30_000;
    const HOT_WINDOW_MS = 30_000;

    function nextInterval(): number {
      const age = Date.now() - lastActivityRef.current;
      return age < HOT_WINDOW_MS ? HOT_INTERVAL_MS : COLD_INTERVAL_MS;
    }

    async function pollOnce() {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) {
        schedule();
        return;
      }
      try {
        const { data, error } = await supabase
          .from("bids")
          .select("*, bidder:profiles!bids_bidder_id_fkey(full_name)")
          .eq("auction_id", auctionId)
          .order("placed_at", { ascending: false })
          .limit(8);
        if (error || !data || cancelled) {
          schedule();
          return;
        }
        const next = data as unknown as EnrichedBid[];
        // Refresh the name cache from whatever the poll just brought
        // back — keeps "Ahmed B." correct even if the user changed
        // their profile name mid-auction.
        let cacheGrew = false;
        for (const b of next) {
          const n = b.bidder?.full_name;
          if (n && nameCacheRef.current.get(b.bidder_id) !== n) {
            nameCacheRef.current.set(b.bidder_id, n);
            cacheGrew = true;
          }
        }
        if (cacheGrew) setNameVersion((v) => v + 1);
        setBids((prev) => {
          if (
            prev.length === next.length &&
            prev.every((b, i) => b.id === next[i].id)
          ) {
            return prev;
          }
          // List changed — realtime may have missed an INSERT, or our
          // optimistic state is stale. Either way, bump activity so
          // the cadence stays hot for the next 30 s.
          lastActivityRef.current = Date.now();
          return next;
        });
      } catch {
        /* transient — next tick will reconcile */
      }
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
                        <span className="text-[11px] lg:text-[12px] text-[var(--foreground-muted)]">
                          {/* Read from cache first (covers realtime
                              inserts that haven't been re-polled yet),
                              fall back to the joined profile, finally
                              "Enchérisseur" if nothing's available. */}
                          {maskName(
                            nameCacheRef.current.get(b.bidder_id)
                              ?? b.bidder?.full_name
                              ?? null,
                          )}
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
                    <div
                      className="text-[10px] lg:text-[11px] text-[var(--foreground-subtle)] batta-tabular"
                      // Server renders this at request time, client hydrates
                      // ~1 s later — `formatRelativeTime` reads `Date.now()`
                      // so the strings drift ("7 min" vs "8 min") and React
                      // throws #418. Live-clock components are the canonical
                      // case for suppressHydrationWarning.
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
