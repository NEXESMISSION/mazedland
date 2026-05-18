import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { depositForOpening } from "@/lib/utils";
import { BidComposer } from "@/components/auction/BidComposer";
import { AuctionEndModal } from "@/components/auction/AuctionEndModal";
import { BidHistoryRealtime } from "./BidHistoryRealtime";
import type { AuctionWithProperty, Bid } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Bid page — the dedicated workflow for placing an offer. Mirrors the
 * mazed-auto pattern: header bar with back-to-detail link, all the
 * pre-bid gates (login / KYC / deposit / owner) rendered as proper
 * gate cards (not a broken bid form), and a type-aware composer
 * (English / Dutch / Sealed) once the gates are cleared.
 *
 * Owners and visitors landing on this URL while the auction is no
 * longer biddable still see the composer's "ended" or "winner" banner
 * inline — no hard redirect — so the user keeps the context of which
 * auction just ended.
 */
export default async function BidPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = await params;
  const locale = await getLocale();
  const t = await getTranslations();
  const supabase = await getServerSupabase();

  const [auctionRes, bidCountRes, initialBidsRes, userRes] = await Promise.all([
    supabase
      .from("auctions")
      .select(
        `*, property:properties (*, photos:property_photos (id, storage_path, sort_order, caption))`,
      )
      .eq("id", id)
      .single(),
    supabase
      .from("bids")
      .select("id", { count: "exact", head: true })
      .eq("auction_id", id),
    // Seed the history list — RLS hides sealed-bid amounts from non-self
    // rows during live phase, but rows still come through so the count
    // strip can show "X autres offres révélées à la clôture".
    supabase
      .from("bids")
      .select("*")
      .eq("auction_id", id)
      .order("placed_at", { ascending: false })
      .limit(8),
    supabase.auth.getUser(),
  ]);

  if (auctionRes.error || !auctionRes.data) notFound();
  const auction = auctionRes.data as unknown as AuctionWithProperty;
  // Direct-sale listings have no bidding workflow. The detail page hosts
  // DirectSalePanel with the "Acheter maintenant" CTA; bouncing /bid back
  // there keeps the user from staring at a composer that can't do anything.
  // Using Next.js's native redirect (not the next-intl one) because
  // next-intl's variant has triggered a Suspense/IntlProvider race in
  // recent next@16 versions. We build the locale prefix manually since
  // the layout uses localePrefix='always'.
  if (auction.listing_type === "direct") {
    redirect(`/${locale}/auctions/${id}`);
  }
  const totalBids = bidCountRes.count ?? 0;
  const initialBids = (initialBidsRes.data ?? []) as Bid[];
  const userId = userRes.data.user?.id ?? null;

  // Server-truth pre-flight: KYC + deposit. The composer needs these
  // synchronously so the right gate renders without a client-side flash.
  let kycVerified = false;
  let hasActiveDeposit = false;
  if (userId) {
    const [profileRes, depositRes] = await Promise.all([
      supabase.from("profiles").select("kyc_status").eq("id", userId).single(),
      supabase
        .from("auction_deposits")
        .select("id")
        .eq("auction_id", id)
        .eq("user_id", userId)
        .is("released_at", null)
        .is("forfeited_at", null)
        .maybeSingle(),
    ]);
    kycVerified = profileRes.data?.kyc_status === "verified";
    hasActiveDeposit = !!depositRes.data;
  }
  const isOwner = userId !== null && userId === auction.property.owner_id;
  const depositAmount = depositForOpening(auction.opening_price);
  const isLive = auction.status === "live" || auction.status === "extending";
  const isSealedLive = isLive && auction.type === "sealed";

  // The user is "in" the auction when they've cleared every gate. Only
  // then do we render the bid history alongside the composer — for a
  // user mid-gate, the history is a distraction from the "do this next"
  // CTA. Sellers and ended-auction visitors also fall through to the
  // composer-only layout (composer renders the right banner inline).
  const userIsBidder =
    userId !== null && !isOwner && kycVerified && hasActiveDeposit && isLive;

  return (
    <div className="min-h-screen bg-background">
      {/* Back navigation is owned by the global TopBar (parent-path
          mapping sends /auctions/[id]/bid back to /auctions/[id]).
          No page-specific back button. */}

      {/* Pops once when a bidder lands on a freshly-ended auction. */}
      <AuctionEndModal auction={auction} userId={userId} locale={locale} />

      {/* Inline page title — sits at the top of the content so the user
          knows they're in the bid flow. */}
      <header className="max-w-[var(--max-w)] mx-auto px-4 pt-4 lg:max-w-[var(--max-w-wide)] lg:px-8 lg:pt-6">
        <div className="text-[10px] uppercase tracking-[0.22em] font-extrabold text-[var(--gold)]">
          {t("auction.placeBid")}
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <h1 className="text-[20px] lg:text-[26px] font-extrabold leading-tight tracking-tight truncate">
            {auction.property.title}
          </h1>
          <span className="font-mono text-[11px] text-[var(--foreground-subtle)] tracking-[0.1em] batta-tabular shrink-0 hidden lg:inline">
            Lot · {String(auction.id).replace(/-/g, "").slice(-4).toUpperCase()}
          </span>
        </div>
      </header>

      <main className="max-w-[var(--max-w)] mx-auto px-4 pt-4 pb-10 lg:max-w-[var(--max-w-wide)] lg:px-8 lg:pt-6 lg:pb-16">
        {userIsBidder ? (
          // ── BIDDER layout — composer + history side-by-side on desktop,
          //    stacked on mobile (composer first so it stays in thumb reach).
          <div className="space-y-6 lg:space-y-0 lg:grid lg:grid-cols-[1.4fr_440px] xl:grid-cols-[1.4fr_480px] lg:gap-10 xl:gap-12">
            <aside className="lg:col-start-2 lg:row-start-1 lg:sticky lg:top-[calc(5rem+1.5rem)] lg:self-start">
              <div className="lg:rounded-[24px] lg:bg-[var(--surface)] lg:ring-1 lg:ring-[var(--border)] lg:p-7 lg:shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
                <BidComposer
                  auction={auction}
                  userId={userId}
                  kycVerified={kycVerified}
                  hasActiveDeposit={hasActiveDeposit}
                  isOwner={isOwner}
                  depositAmount={depositAmount}
                  totalBids={totalBids}
                  locale={locale}
                />
              </div>
            </aside>
            <div className="lg:col-start-1 lg:row-start-1 lg:rounded-[var(--radius-md)] lg:bg-[var(--surface)] lg:ring-1 lg:ring-[var(--border)] lg:p-6">
              <BidHistoryRealtime
                auctionId={auction.id}
                initialBids={initialBids}
                totalBids={totalBids}
                userId={userId}
                isSealedLive={isSealedLive}
                locale={locale}
              />
            </div>
          </div>
        ) : (
          // ── GATE / ENDED layout — composer alone. PreBidGate already
          //    renders its own 2-col magazine layout (property hero + gate
          //    card) on desktop, so we don't wrap it in another card.
          <div className="lg:rounded-[24px] lg:bg-[var(--surface)] lg:ring-1 lg:ring-[var(--border)] lg:p-8 lg:shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
            <BidComposer
              auction={auction}
              userId={userId}
              kycVerified={kycVerified}
              hasActiveDeposit={hasActiveDeposit}
              isOwner={isOwner}
              depositAmount={depositAmount}
              totalBids={totalBids}
              locale={locale}
            />
          </div>
        )}
      </main>
    </div>
  );
}
