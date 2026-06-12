import { Link } from "@/i18n/navigation";
import { formatTND } from "@/lib/utils";
import { Countdown } from "@/components/auction/Countdown";
import {
  Gavel, CheckCircle2, XCircle, AlertCircle, Clock,
  Wallet, BarChart3, Settings2, Users,
} from "lucide-react";

type AuctionStatus =
  | "scheduled"
  | "live"
  | "extending"
  | "ended_sold"
  | "ended_unsold"
  | "sixth_offer_window"
  | "awarded"
  | "cancelled";

interface Props {
  auctionId: string;
  propertyId: string;
  status: AuctionStatus;
  startsAt: string | null;
  endsAt: string;
  currentPrice: number;
  winnerAmount: number | null;
  totalBids: number;
  activeDeposits: number;
  /** Latest final_payment / buy_now row for this auction, if any. */
  finalPayment: { id: string; status: string; amount: number } | null;
  locale: string;
  /** Pre-translated "TND" suffix — banner is a server component so we can't
   *  call useTranslations directly. */
  tCommonTnd: string;
}

/**
 * Tableau du vendeur — the seller-side framing of /auctions/[id].
 *
 * Sellers used to land on the bidder UI when they tapped a
 * seller_received_bid / auction_sold_seller notification: deposit box,
 * "Placer une enchère" button, sixth-offer form — none of it relevant
 * to them. This banner replaces that framing with the data points the
 * owner actually wants: current depth (bids + deposit-holding bidders),
 * the verdict if closed, the buyer's final-payment status when sold,
 * and direct links to manage the listing and follow payouts.
 *
 * Rendered server-side; safe to inject above the regular detail flow,
 * which then continues to show specs/docs/map (a seller may want to
 * sanity-check how their own listing reads).
 */
export function SellerAuctionBanner({
  auctionId: _auctionId,
  propertyId,
  status,
  startsAt,
  endsAt,
  currentPrice,
  winnerAmount,
  totalBids,
  activeDeposits,
  finalPayment,
  locale,
  tCommonTnd,
}: Props) {
  const isLive = status === "live" || status === "extending";
  const isScheduled = status === "scheduled";
  const isSold = status === "ended_sold" || status === "awarded";
  const isUnsold = status === "ended_unsold";
  const isCancelled = status === "cancelled";
  const isSixthOffer = status === "sixth_offer_window";

  // Headline figure: winning bid if closed-sold, current bid otherwise.
  const headline = isSold && winnerAmount != null ? winnerAmount : currentPrice;

  // Verdict pill — color + glyph + label, picked once.
  const verdict = (() => {
    if (isSold) {
      return { Icon: CheckCircle2, tone: "batta-tone-ok", label: "Adjugée" };
    }
    if (isUnsold) {
      return {
        Icon: AlertCircle, tone: "bg-surface-2 text-muted ring-1 ring-border",
        label: "Invendue",
      };
    }
    if (isCancelled) {
      return { Icon: XCircle, tone: "batta-tone-bad", label: "Annulée" };
    }
    if (isSixthOffer) {
      return { Icon: Clock, tone: "batta-tone-warn", label: "Surenchère légale" };
    }
    if (isLive) {
      return { Icon: Gavel, tone: "batta-tone-warn", label: "En direct" };
    }
    return { Icon: Clock, tone: "bg-surface-2 text-muted ring-1 ring-border", label: "Programmée" };
  })();

  // Payment status for the buyer's final payment — only shown when sold.
  // Tracks the funds actually reaching the seller (≠ the auction closing).
  const payStatus = finalPayment?.status ?? null;
  const payTone =
    payStatus === "captured"
      ? "batta-tone-ok"
      : payStatus === "failed" || payStatus === "cancelled"
        ? "batta-tone-bad"
        : payStatus
          ? "batta-tone-warn"
          : "bg-surface-2 text-muted ring-1 ring-border";
  const payLabel = (() => {
    switch (payStatus) {
      case "captured": return "Payé";
      case "pending": return "Reçu non envoyé";
      case "pending_review": return "Reçu en vérification";
      case "authorized": return "Autorisé";
      case "refunded": return "Remboursé";
      case "failed": return "Refusé";
      case "cancelled": return "Annulé";
      default: return "En attente";
    }
  })();

  return (
    <section className="batta-surface-navy-luxe relative mx-4 mt-5 overflow-hidden rounded-2xl ring-1 ring-gold/25">
      <div className="relative p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="batta-eyebrow">Tableau du vendeur</span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider ${verdict.tone}`}
          >
            <verdict.Icon className="size-3" strokeWidth={2.5} />
            {verdict.label}
          </span>
        </div>

        <div
          className={`batta-tabular gradient-gold-text mt-2 text-[36px] font-extrabold leading-none tracking-tight`}
        >
          {formatTND(headline, locale)}
          <span className="ms-2 text-[12px] font-bold uppercase tracking-[0.16em] text-gold/80">
            {tCommonTnd}
          </span>
        </div>
        <div className="mt-1 text-[11px] text-muted">
          {isSold
            ? "Prix d'adjudication"
            : isLive || isSixthOffer
              ? "Enchère actuelle"
              : isScheduled
                ? "Mise à prix"
                : "Dernier prix"}
        </div>

        {/* Stat row — bids + active depositors + countdown (live/scheduled).
            Hidden for closed auctions where the figures stop being useful. */}
        {(isLive || isScheduled || isSixthOffer) && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-gold/15">
              <div className="batta-eyebrow flex items-center gap-1 text-[9px]">
                <BarChart3 className="size-3" strokeWidth={2.2} />
                Offres reçues
              </div>
              <div className="batta-tabular mt-1 text-[15px] font-bold text-foreground">
                {totalBids}
                {activeDeposits > 0 && (
                  <span className="ms-2 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                    <Users className="size-3" strokeWidth={2.2} />
                    {activeDeposits} caution{activeDeposits > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
            <div className="rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-gold/15">
              <div className="batta-eyebrow text-[9px]">
                {isScheduled ? "Démarre dans" : "Termine dans"}
              </div>
              <div className="batta-tabular mt-1 text-[15px] font-bold text-foreground">
                <Countdown
                  endsAt={isScheduled && startsAt ? startsAt : endsAt}
                />
              </div>
            </div>
          </div>
        )}

        {/* Buyer payment row — only relevant when the auction sold. The
            seller's payout follows this row's capture; we surface it so
            the next question ("when do I get paid?") is one tap away. */}
        {isSold && (
          <div className="mt-4 rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-gold/15">
            <div className="flex items-center justify-between gap-2">
              <div className="batta-eyebrow flex items-center gap-1 text-[9px]">
                <Wallet className="size-3" strokeWidth={2.2} />
                Paiement acheteur
              </div>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wider ${payTone}`}
              >
                {payLabel}
              </span>
            </div>
            {finalPayment && (
              <div className="batta-tabular mt-1 text-[13px] font-bold text-foreground">
                {formatTND(finalPayment.amount, locale)} {tCommonTnd}
              </div>
            )}
          </div>
        )}

        {/* Action row — manage the listing + jump to payouts. The manage
            link goes to the listing's edit page (the only per-listing route
            that exists; bare /sell/<id> has no page and would 404). */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link
            href={`/sell/${propertyId}/edit` as never}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-surface-2 px-3 py-2.5 text-[11.5px] font-bold text-foreground ring-1 ring-gold/20 transition active:scale-[0.99]"
          >
            <Settings2 className="size-3.5" strokeWidth={2.2} />
            Mon annonce
          </Link>
          <Link
            href={(isSold ? "/sell#payouts" : "/sell") as never}
            className="batta-gold-fill inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[11.5px] font-extrabold uppercase tracking-wider shadow-[var(--shadow-gold)] transition active:scale-[0.99]"
          >
            <Wallet className="size-3.5" strokeWidth={2.2} />
            {isSold ? "Mes paiements" : "Tableau de bord"}
          </Link>
        </div>
      </div>
    </section>
  );
}
