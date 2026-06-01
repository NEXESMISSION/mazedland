import { getTranslations, getLocale } from "next-intl/server";
import { formatTND, minBidIncrement } from "@/lib/utils";
import { Wallet } from "lucide-react";
import type { AuctionWithProperty } from "@/lib/types";

/**
 * "Détails de l'enchère" — a scannable terms block so a bidder sees, at a
 * glance, exactly what the numbers are: the refundable caution up front
 * (the thing people ask about most), then mise à prix, current bid, the
 * next minimum bid, buy-now, auction type, closing time and offers received.
 *
 * Auctions only — direct sales use DirectSalePanel. Server component;
 * everything is passed in already computed by the route.
 */
export async function AuctionTerms({
  auction,
  currentPrice,
  deposit,
  depositRequired,
  totalBids,
  isEnded,
  isLive,
  className = "",
}: {
  auction: AuctionWithProperty;
  currentPrice: number;
  deposit: number;
  depositRequired: boolean;
  totalBids: number;
  isEnded: boolean;
  isLive: boolean;
  className?: string;
}) {
  const t = await getTranslations();
  const locale = await getLocale();
  const tnd = t("common.tnd");
  const money = (n: number) => `${formatTND(n, locale)} ${tnd}`;

  const startsAtMs = auction.starts_at ? new Date(auction.starts_at).getTime() : null;
  const showStart = !isLive && startsAtMs !== null && startsAtMs > Date.now();
  const dateStr = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
    } catch {
      return iso;
    }
  };

  // Key → value rows (the caution is shown separately, highlighted above).
  const rows: { label: string; value: string }[] = [];
  rows.push({ label: "Mise à prix", value: money(auction.opening_price) });
  rows.push({
    label: isEnded ? "Prix final" : "Enchère actuelle",
    value: money(isEnded && auction.winner_amount ? Number(auction.winner_amount) : currentPrice),
  });
  if (isLive) {
    rows.push({
      label: "Prochaine offre min.",
      value: money(currentPrice + minBidIncrement(currentPrice)),
    });
  }
  if (auction.buy_now_price != null) {
    rows.push({ label: "Achat immédiat", value: money(Number(auction.buy_now_price)) });
  }
  rows.push({ label: "Type d'enchère", value: t(`auction.types.${auction.type}`) });
  rows.push({
    label: showStart ? "Ouverture" : "Clôture",
    value: dateStr(showStart ? (auction.starts_at as string) : auction.ends_at),
  });
  rows.push({ label: "Offres reçues", value: String(totalBids) });

  return (
    <section className={`rounded-2xl border border-black/[0.07] bg-white p-6 ${className}`}>
      <h2 className="batta-eyebrow flex items-center gap-2">
        <span aria-hidden className="batta-gold-rule-short" />
        Détails de l&apos;enchère
      </h2>

      {/* Caution — the headline figure, kept prominent */}
      <div className="mt-4 flex items-center gap-3 rounded-2xl bg-[var(--gold-faint)] p-4">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white text-gold ring-1 ring-[var(--gold)]/25">
          <Wallet className="size-5" strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[var(--gold)]">
            Caution requise
          </div>
          <div className="batta-tabular mt-0.5 text-[22px] font-extrabold leading-none text-foreground">
            {depositRequired ? money(deposit) : "Gratuite"}
          </div>
        </div>
        {depositRequired && (
          <span className="ms-auto shrink-0 rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--gold)] ring-1 ring-[var(--gold)]/25">
            Remboursable
          </span>
        )}
      </div>

      {/* Everything else, as a clean key→value list */}
      <dl className="mt-3 divide-y divide-black/[0.06]">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-[12.5px] text-muted">{r.label}</dt>
            <dd className="batta-tabular text-[13.5px] font-bold text-foreground text-end">{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
