import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { parseMonetizationSettings, resolveDeposit } from "@/lib/pricing";
import { BidComposer } from "@/components/auction/BidComposer";
import { AuctionEndModal } from "@/components/auction/AuctionEndModal";
import { LiveTimer } from "@/components/landing/LiveTimer";
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
  // Receipt uploaded, waiting on an admin to validate the caution. While
  // true (and there's no captured deposit yet) the gate shows a "we're
  // checking it" state instead of asking the buyer to pay again.
  let depositUnderReview = false;
  if (userId) {
    const [profileRes, depositRes, pendRes] = await Promise.all([
      supabase.from("profiles").select("kyc_status").eq("id", userId).single(),
      supabase
        .from("auction_deposits")
        .select("id")
        .eq("auction_id", id)
        .eq("user_id", userId)
        .is("released_at", null)
        .is("forfeited_at", null)
        .maybeSingle(),
      supabase
        .from("payments")
        .select("id")
        .eq("user_id", userId)
        .eq("auction_id", id)
        .eq("kind", "deposit_lock")
        .eq("status", "pending_review")
        .limit(1),
    ]);
    kycVerified = profileRes.data?.kyc_status === "verified";
    hasActiveDeposit = !!depositRes.data;
    depositUnderReview = (pendRes.data?.length ?? 0) > 0;
  }
  const isOwner = userId !== null && userId === auction.property.owner_id;
  // Owners can't bid on their own listing — bounce them to the detail
  // page instead of rendering the "vous publiez cette enchère" gate.
  // Same native-redirect rationale as the direct-sale bounce above.
  if (isOwner) {
    redirect(`/${locale}/auctions/${id}`);
  }
  const { data: depRow } = await supabase
    .from("app_settings").select("value").eq("key", "deposit").maybeSingle();
  const depCfg = parseMonetizationSettings(
    new Map<string, unknown>([["deposit", depRow?.value]]),
  ).deposit;
  const { required: depositRequired, amount: depositAmount } = resolveDeposit(
    depCfg, auction.opening_price,
  );
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
          knows they're in the bid flow. The countdown chip is sticky to
          the page header so a bidder always sees how much time is left
          while scrolling the composer + history. */}
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
        {(() => {
          const startsAtMs = auction.starts_at
            ? new Date(auction.starts_at).getTime()
            : null;
          const showStart =
            !isLive && startsAtMs !== null && startsAtMs > Date.now();
          const endsAtMs = new Date(auction.ends_at).getTime();
          const isEnded =
            !isLive && (!showStart || endsAtMs <= Date.now()) &&
            auction.status !== "scheduled";
          if (isEnded) return null;
          return (
            <div className="mt-3">
              <span className="inline-flex items-center gap-2 rounded-full bg-foreground/[0.04] px-3 py-1 text-foreground/85 ring-1 ring-foreground/10">
                <span
                  aria-hidden
                  className={`size-1.5 rounded-full ${
                    isLive ? "batta-pulse-dot bg-red-500" : "bg-gold"
                  }`}
                />
                <LiveTimer
                  endsAt={showStart ? (auction.starts_at as string) : auction.ends_at}
                  className="batta-tabular text-[13px] font-bold !text-foreground"
                />
              </span>
            </div>
          );
        })()}
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
                  depositUnderReview={depositUnderReview}
                  isOwner={isOwner}
                  depositAmount={depositAmount}
                  depositRequired={depositRequired}
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
              depositUnderReview={depositUnderReview}
              isOwner={isOwner}
              depositAmount={depositAmount}
              depositRequired={depositRequired}
              totalBids={totalBids}
              locale={locale}
            />
          </div>
        )}
      </main>
    </div>
  );
}
