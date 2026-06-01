"use client";

import { CheckCircle2, ArrowRight, ShieldCheck, Clock } from "lucide-react";
import { formatTND, cn } from "@/lib/utils";
import type { AuctionWithProperty } from "@/lib/types";

/**
 * Optional "math card" for gates whose CTA amount is derived from a larger
 * reference figure — typically the deposit gate where e.g. 29 000 TND is 10%
 * of the 290 000 TND opening price. Showing the number up front makes the
 * deposit feel transparent instead of arbitrary.
 */
export interface PriceContext {
  /** Eyebrow above the big number, e.g. "Caution requise". */
  label: string;
  /** The amount the user is being asked to commit (in TND). */
  amount: number;
}

interface Props {
  tone: "muted" | "warning" | "gold";
  icon: React.ReactNode;
  title: string;
  body: string;
  ctaLabel: string;
  ctaIcon?: React.ReactNode;
  onCta: () => void;
  bullets?: string[];
  auction: AuctionWithProperty;
  totalBids: number;
  locale: string;
  /** Optional pricing-math block (deposit gate uses this). */
  priceContext?: PriceContext;
}

/**
 * Replaces the bid composer when the user can't bid yet — login, KYC,
 * deposit, ended/winner, or scheduled. ONE focused, centered card (same on
 * mobile and desktop): icon + title, the amount-or-copy, scannable
 * reassurance rows, the primary CTA, and trust signals.
 *
 * The property + price context lives in the page's header strip above this
 * card, so the gate deliberately does NOT repeat a property hero image —
 * it stays a clean "do this next" surface.
 */
export function PreBidGate({
  tone,
  icon,
  title,
  body,
  ctaLabel,
  ctaIcon,
  onCta,
  bullets,
  locale,
  priceContext,
}: Props) {
  // Light-theme palette — white card with gold/amber accents. Each tone sets
  // the border ring + the icon-disc treatment.
  const palette = {
    muted: {
      ring: "border-[var(--gold-soft)]",
      iconBg: "bg-gold-faint text-gold ring-1 ring-gold/20",
    },
    warning: {
      ring: "border-amber-300",
      iconBg: "bg-amber-100 text-amber-700",
    },
    gold: {
      ring: "border-[var(--gold-soft)]",
      iconBg: "batta-gradient-gold text-white shadow-[var(--shadow-gold)]",
    },
  }[tone];

  return (
    <div className="mx-auto w-full max-w-[560px]">
      <div
        className={`relative overflow-hidden rounded-3xl border ${palette.ring} bg-white p-6 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.4)] lg:p-8`}
      >
        {tone === "gold" && (
          <div
            aria-hidden
            className="pointer-events-none absolute -top-16 -end-16 h-48 w-48 rounded-full bg-[var(--gold)] opacity-[0.12] blur-3xl"
          />
        )}
        <div className="relative">
          {/* Icon + title */}
          <div className="flex items-center gap-3.5">
            <div className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${palette.iconBg}`}>
              {icon}
            </div>
            <h3 className="text-[20px] font-extrabold leading-tight tracking-tight text-foreground lg:text-[23px]">
              {title}
            </h3>
          </div>

          {/* Deposit gate leads with the amount; other gates show one line. */}
          {priceContext ? (
            <div className="mt-5 rounded-2xl bg-[var(--gold-faint)] p-5 text-center ring-1 ring-[var(--gold-soft)]">
              <div className="text-[9.5px] font-extrabold uppercase tracking-[0.18em] text-[var(--gold)]">
                {priceContext.label}
              </div>
              <div dir="ltr" className="mt-1.5 flex items-baseline justify-center gap-1.5">
                <span className="batta-tabular gradient-gold-text text-[40px] font-extrabold leading-none">
                  {formatTND(priceContext.amount, locale)}
                </span>
                <span className="text-[13px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-muted)]">
                  TND
                </span>
              </div>
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-[var(--foreground-muted)]">
                {body}
              </p>
            </div>
          ) : (
            <p className="mt-4 text-[14px] leading-relaxed text-[var(--foreground-muted)]">
              {body}
            </p>
          )}

          {/* Reassurance rows */}
          {bullets && bullets.length > 0 && (
            <ul className="mt-5 space-y-2">
              {bullets.map((b, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 rounded-xl bg-[var(--surface-2)] p-3 ring-1 ring-[var(--border)]"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gold-faint text-gold ring-1 ring-gold/25">
                    <CheckCircle2 className="size-4" strokeWidth={2.4} />
                  </span>
                  <span className="text-[13.5px] font-semibold leading-snug text-foreground/90">
                    {b}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* CTA */}
          <button
            type="button"
            onClick={onCta}
            className={cn(
              "group mt-6 inline-flex h-14 w-full items-center justify-center gap-2 rounded-full text-[14.5px] font-extrabold transition active:scale-[0.99]",
              tone === "warning"
                ? "bg-amber-400 text-black shadow-[0_8px_24px_-6px_rgba(245,158,11,0.5)]"
                : "batta-gradient-gold text-white shadow-[var(--shadow-gold)]",
            )}
          >
            {ctaIcon}
            {ctaLabel}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </button>

          {/* Trust signals */}
          {tone !== "warning" && (
            <div className="mt-4 flex items-center justify-center gap-4 text-[11px] text-[var(--foreground-subtle)]">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-[var(--gold)]" strokeWidth={2} />
                Paiement sécurisé
              </span>
              <span className="opacity-40">·</span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-3.5 text-[var(--gold)]" strokeWidth={2} />
                Caution remboursable
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
