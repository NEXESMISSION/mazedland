"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { formatTND, minBidIncrement } from "@/lib/utils";
import { minSixthOffer } from "@/lib/auction-engine";
import { Hourglass, CheckCircle2, Wallet } from "lucide-react";

type Props = {
  auctionId: string;
  winningAmount: number;
  deadline: string; // ISO
  /** Server-truth — same gates as bidding. */
  loggedIn: boolean;
  kycVerified: boolean;
  hasActiveDeposit: boolean;
};

/**
 * Sixth-offer (offre du sixième) — Tunisian-law-mandated 8-day window
 * after the hammer in which any qualified bidder may submit an offer
 * at least 1/6 (≈16.67%) above the winning bid. The original winner
 * keeps the right to match.
 *
 * Submitting goes straight through the public.sixth_offers table; RLS
 * lets any KYC+deposited user insert (the SQL policy is
 * `with check (auth.uid() = bidder_id)`). The state-machine cron
 * promotes the highest sixth offer when sixth_offer_deadline passes.
 */
export function SixthOfferForm({
  auctionId, winningAmount, deadline,
  loggedIn, kycVerified, hasActiveDeposit,
}: Props) {
  const t = useTranslations();
  const locale = useLocale();
  const [amount, setAmount] = useState<number>(minSixthOffer(winningAmount));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const minOffer = minSixthOffer(winningAmount);
  const closed = new Date(deadline).getTime() <= Date.now();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (amount < minOffer) {
      setError(t("sixth.tooLow", { min: formatTND(minOffer, locale) }));
      return;
    }
    start(async () => {
      const supabase = getBrowserSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("auth"); return; }
      const { error } = await supabase.from("sixth_offers").insert({
        auction_id: auctionId,
        bidder_id: user.id,
        amount,
      });
      if (error) {
        setError(error.message);
        return;
      }
      setDone(true);
    });
  }

  const header = (
    <div className="mb-3 flex items-start gap-3">
      <span className="batta-monogram size-9 shrink-0 text-[14px]">
        <Hourglass className="size-4" strokeWidth={1.75} />
      </span>
      <div>
        <div className="batta-serif text-[15px] font-semibold text-batta-cream">
          {t("sixth.windowOpen")}
        </div>
        <p className="mt-0.5 text-[11px] text-batta-cream/65">
          {t("sixth.windowBody", { deadline: new Date(deadline).toLocaleString(locale) })}
        </p>
      </div>
    </div>
  );

  if (done) {
    return (
      <section className="batta-frame-gold mx-4 mt-3 p-5">
        <div className="relative">
          {header}
          <div className="batta-tone-ok flex items-center gap-2 rounded-xl p-3 text-sm">
            <CheckCircle2 className="size-4" />
            {t("sixth.submitted")}
          </div>
        </div>
      </section>
    );
  }

  if (closed) {
    return (
      <section className="batta-frame mx-4 mt-3 p-5">
        {header}
        <p className="text-xs text-batta-muted">{t("sixth.alreadyAwarded")}</p>
      </section>
    );
  }

  return (
    <section className="batta-frame-gold mx-4 mt-3 p-5">
      <div className="relative">
        {header}

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-batta-surface-2 p-2.5 ring-1 ring-batta-gold/15">
            <div className="batta-eyebrow text-[9px]">{t("sixth.currentWinning")}</div>
            <div className="batta-tabular batta-serif mt-0.5 text-[14px] font-semibold text-batta-cream">
              {formatTND(winningAmount, locale)} {t("common.tnd")}
            </div>
          </div>
          <div className="rounded-lg bg-batta-surface-2 p-2.5 ring-1 ring-batta-gold/15">
            <div className="batta-eyebrow text-[9px]">{t("sixth.minOffer")}</div>
            <div className="batta-gold-text batta-tabular batta-serif mt-0.5 text-[14px] font-semibold">
              {formatTND(minOffer, locale)} {t("common.tnd")}
            </div>
          </div>
        </div>

        {!loggedIn ? (
          <Link
            href={`/login?next=${encodeURIComponent(`/auctions/${auctionId}`)}` as `/login?next=${string}`}
            className="batta-btn-luxe tap-target mt-3 w-full px-5 py-3 text-[13.5px]"
          >
            {t("auction.loginToBid")}
          </Link>
        ) : !kycVerified ? (
          <Link
            href="/kyc"
            className="batta-btn-luxe tap-target mt-3 w-full px-5 py-3 text-[13.5px]"
          >
            {t("auction.kycRequiredCta")}
          </Link>
        ) : !hasActiveDeposit ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-batta-gold/20 bg-batta-surface-2 p-3 text-[11px] text-batta-cream/70">
            <Wallet className="size-3.5 shrink-0 text-batta-gold" strokeWidth={1.75} />
            {t("sixth.needDeposit")}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-3 space-y-2">
            <input
              type="number"
              value={amount}
              min={minOffer}
              step={minBidIncrement(winningAmount)}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-3 py-2.5 text-sm font-bold text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
              inputMode="numeric"
              dir="ltr"
            />
            {error && <p className="batta-tone-bad rounded-lg px-2 py-1 text-[11px]">{error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="batta-btn-luxe tap-target w-full px-5 py-2.5 text-[13px] disabled:opacity-50"
            >
              {pending ? t("sixth.submitting") : t("sixth.submitOffer")}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
