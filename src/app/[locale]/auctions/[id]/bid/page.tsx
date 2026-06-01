import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { parseMonetizationSettings, resolveDeposit } from "@/lib/pricing";
import { BidComposer } from "@/components/auction/BidComposer";
import { AuctionEndModal } from "@/components/auction/AuctionEndModal";
import { SixthOfferForm } from "@/components/auction/SixthOfferForm";
import { LiveTimer } from "@/components/landing/LiveTimer";
import { Link } from "@/i18n/navigation";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { formatTND } from "@/lib/utils";
import { MapPin } from "lucide-react";
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

  const [auctionRes, bidCountRes, initialBidsRes, topBidRes, userRes] = await Promise.all([
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
    // Join profiles for `full_name` so the history can show "Ahmed B."
    // instead of the truncated UUID slice "ec0043…" the audit flagged.
    supabase
      .from("bids")
      .select("*, bidder:profiles!bids_bidder_id_fkey(full_name)")
      .eq("auction_id", id)
      .order("placed_at", { ascending: false })
      .limit(8),
    // Current top bidder — matches the ordering the place_bid RPC uses
    // (amount desc, placed_at asc). The composer needs this so the
    // current leader can raise their own bid without the min-increment
    // floor (DB place_bid was updated to allow self-raise in 0046).
    supabase
      .from("bids")
      .select("bidder_id")
      .eq("auction_id", id)
      .order("amount", { ascending: false })
      .order("placed_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
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
  const currentTopBidderId =
    (topBidRes.data as { bidder_id: string } | null)?.bidder_id ?? null;
  const userId = userRes.data.user?.id ?? null;

  // Server-truth pre-flight: KYC + deposit. The composer needs these
  // synchronously so the right gate renders without a client-side flash.
  let kycVerified = false;
  let kycStatus: string | null = null;
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
    kycStatus = (profileRes.data?.kyc_status as string | null) ?? null;
    kycVerified = kycStatus === "verified";
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

      {/* ─── PROPERTY CONTEXT STRIP ───
              Compact thumbnail + title + governorate row, deep-linking back
              to the detail page. The bid page is a focused workspace — the
              composer alone gave the bidder no visual anchor of which
              property they were committing to. Tapping the strip returns
              to the full detail page in one move; the row also doubles as
              the "back to listing" affordance for users who entered via a
              direct notification link rather than the floating CTA. */}
      <section className="max-w-[var(--max-w)] mx-auto px-4 pt-3 lg:max-w-[var(--max-w-wide)] lg:px-8 lg:pt-6">
        <Link
          href={`/auctions/${auction.id}` as never}
          className="flex items-center gap-3 rounded-2xl bg-surface p-2 ring-1 ring-border transition active:scale-[0.995]"
        >
          {(() => {
            const cover = (auction.property.photos ?? [])
              .slice()
              .sort((a, b) => a.sort_order - b.sort_order)[0];
            return cover ? (
              <Image
                src={propertyPhotoUrl(cover.storage_path, { transform: { width: 160 } })}
                alt=""
                width={56}
                height={56}
                className="size-14 shrink-0 rounded-xl object-cover ring-1 ring-border"
              />
            ) : (
              <div className="size-14 shrink-0 rounded-xl bg-surface-2 ring-1 ring-border" />
            );
          })()}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-bold text-foreground">
              {auction.property.title}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
              <MapPin className="size-3" strokeWidth={2} />
              <span className="truncate">{auction.property.governorate}</span>
              <span aria-hidden className="opacity-40">·</span>
              <span className="batta-tabular font-mono text-[10px] uppercase tracking-[0.1em]">
                Lot {String(auction.id).replace(/-/g, "").slice(-4).toUpperCase()}
              </span>
            </div>
          </div>
          <span className="batta-tabular shrink-0 text-right">
            <span className="block text-[9px] uppercase tracking-[0.16em] text-muted">
              {isLive ? t("auction.currentBid") : "Mise à prix"}
            </span>
            <span className="batta-gold-text mt-0.5 block text-[14px] font-extrabold">
              {formatTND(
                auction.current_price ?? auction.opening_price,
                locale,
              )}
            </span>
          </span>
        </Link>
      </section>

      {/* Inline page title — sits at the top of the content so the user
          knows they're in the bid flow. The countdown chip is sticky to
          the page header so a bidder always sees how much time is left
          while scrolling the composer + history. */}
      <header
        className={`max-w-[var(--max-w)] mx-auto px-4 pt-4 lg:max-w-[var(--max-w-wide)] lg:px-8 lg:pt-6 ${
          // Gate states (login/KYC/deposit) render their own hero with the
          // title + countdown, so this header would be a third copy on
          // desktop — hide it there. Bidders (composer) still need it.
          userIsBidder ? "" : "lg:hidden"
        }`}
      >
        <div className="text-[10px] uppercase tracking-[0.22em] font-extrabold text-[var(--gold)]">
          {t("auction.placeBid")}
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <h1 className="text-[20px] lg:text-[26px] font-extrabold leading-tight tracking-tight truncate">
            {auction.property.title}
          </h1>
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
        {/* ─── SIXTH-OFFER FORM (Tunisian-law 1/6 surenchère) ───
                Moved here from the detail page. The bid page is the
                bidding workspace, so the surenchère — which IS a bid
                placement — belongs alongside the composer rather than
                buried between the property specs and documents. Same
                winner-only audience as before; the DB place_sixth_offer
                RPC still gates server-side. The negative top margin
                pulls it into the same rhythm as the composer card. */}
        {auction.status === "sixth_offer_window"
          && auction.winner_amount
          && auction.sixth_offer_deadline
          && !isOwner
          && userId !== null
          && auction.winner_user_id === userId && (
          <div className="mb-6 -mx-4 lg:mx-0">
            <SixthOfferForm
              auctionId={auction.id}
              winningAmount={Number(auction.winner_amount)}
              deadline={auction.sixth_offer_deadline}
              loggedIn={userId !== null}
              kycVerified={kycVerified}
              hasActiveDeposit={hasActiveDeposit}
            />
          </div>
        )}

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
                  kycStatus={kycStatus}
                  hasActiveDeposit={hasActiveDeposit}
                  depositUnderReview={depositUnderReview}
                  isOwner={isOwner}
                  depositAmount={depositAmount}
                  depositRequired={depositRequired}
                  totalBids={totalBids}
                  currentTopBidderId={currentTopBidderId}
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
          // ── GATE / ENDED layout — composer alone. PreBidGate now renders
          //    its own single centered card, so this is just a passthrough
          //    (no outer card chrome — that produced a card-in-card look).
          <div className="lg:pt-2">
            <BidComposer
              auction={auction}
              userId={userId}
              kycVerified={kycVerified}
              kycStatus={kycStatus}
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
