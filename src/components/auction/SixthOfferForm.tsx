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
 * Submitting calls the place_sixth_offer RPC, which enforces KYC + active
 * deposit + the 1/6 minimum + the deadline server-side (direct INSERT on
 * sixth_offers is revoked). The state-machine cron promotes the highest
 * sixth offer when sixth_offer_deadline passes.
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
      // Server-side RPC enforces KYC + active deposit + 1/6 + deadline.
      // Direct INSERT on sixth_offers is revoked, so this is the only path.
      const { error } = await supabase.rpc("place_sixth_offer", {
        p_auction_id: auctionId,
        p_amount: amount,
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
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-gold-faint text-gold ring-1 ring-gold/15">
        <Hourglass className="size-4" strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <div className="text-[14px] font-bold text-foreground">
          {t("sixth.windowOpen")}
        </div>
        <p className="mt-0.5 text-[11.5px] leading-snug text-muted">
          {t("sixth.windowBody", {
            deadline: new Date(deadline).toLocaleString(locale, {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          })}
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

        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-xl bg-surface-2 p-3 ring-1 ring-border">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
              {t("sixth.currentWinning")}
            </div>
            <div className="batta-tabular mt-1 text-[15px] font-extrabold text-foreground">
              {formatTND(winningAmount, locale)} {t("common.tnd")}
            </div>
          </div>
          <div className="rounded-xl bg-gold-faint p-3 ring-1 ring-gold/20">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-gold">
              {t("sixth.minOffer")}
            </div>
            <div className="batta-tabular mt-1 text-[15px] font-extrabold text-gold-bright">
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
              className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-bold text-foreground focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40"
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
