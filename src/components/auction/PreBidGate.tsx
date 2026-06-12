"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ArrowRight, ShieldCheck, Clock } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/client";
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
  /** ISO start time — when set, the gate renders a live segmented
   *  "ouverture dans" countdown (registered-but-scheduled state). */
  startsAt?: string;
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
  startsAt,
  auction,
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

          {/* Live "ouverture dans" countdown — registered-waiting state. */}
          {startsAt && <OpensCountdown startsAt={startsAt} auctionId={auction.id} />}

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

/**
 * Big segmented "ouverture dans" countdown for the registered-waiting gate —
 * J/H/MIN/SEC tiles plus the exact opening date underneath, so "when can I
 * bid?" reads at a glance. Once the clock hits zero, a light 4s status poll
 * watches for the cron flipping the auction live (≤1 min) and reloads the
 * page the moment it does — the gate swaps into the real bid composer
 * within seconds, without the user touching anything.
 */
function OpensCountdown({ startsAt, auctionId }: { startsAt: string; auctionId: string }) {
  // SSR: render dashes so server/client markup matches; the first effect
  // tick replaces them within ~16ms (same pattern as Countdown.tsx).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ms = now === null ? null : Math.max(0, new Date(startsAt).getTime() - now);
  const opened = ms !== null && ms === 0;

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    const supabase = getBrowserSupabase();
    const startedAt = Date.now();
    // The cron flips scheduled→live within ~1 min. Stop polling after 5 min
    // so a page left open at countdown-zero (cron stalled, user walked away)
    // doesn't hammer the auctions table forever.
    const MAX_POLL_MS = 300_000;
    const check = async () => {
      if (cancelled || Date.now() - startedAt > MAX_POLL_MS) return;
      // Don't poll a hidden tab — resumes on the next visible tick anyway.
      if (typeof document !== "undefined" && document.hidden) return;
      const { data } = await supabase
        .from("auctions")
        .select("status")
        .eq("id", auctionId)
        .maybeSingle();
      if (!cancelled && (data?.status === "live" || data?.status === "extending")) {
        window.location.reload();
      }
    };
    void check();
    const id = setInterval(check, 6000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [opened, auctionId]);

  const d = ms === null ? null : Math.floor(ms / 86_400_000);
  const h = ms === null ? null : Math.floor((ms % 86_400_000) / 3_600_000);
  const m = ms === null ? null : Math.floor((ms % 3_600_000) / 60_000);
  const s = ms === null ? null : Math.floor((ms % 60_000) / 1000);

  const openDate = new Date(startsAt).toLocaleString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Day tile only when there's at least a day left — closer than that,
  // three tiles read faster.
  const tiles: { v: string; label: string }[] = [
    ...(d === null || d > 0
      ? [{ v: d === null ? "—" : String(d), label: d === 1 ? "jour" : "jours" }]
      : []),
    { v: h === null ? "—" : pad2(h), label: "heures" },
    { v: m === null ? "—" : pad2(m), label: "min" },
    { v: s === null ? "—" : pad2(s), label: "sec" },
  ];

  return (
    <div className="mt-5 rounded-2xl bg-[var(--gold-faint)] p-5 ring-1 ring-[var(--gold-soft)]">
      <div className="text-center text-[9.5px] font-extrabold uppercase tracking-[0.18em] text-[var(--gold)]">
        {opened ? "Ouverture en cours…" : "Ouverture dans"}
      </div>
      {opened ? (
        <p className="mt-2 text-center text-[13px] font-semibold leading-relaxed text-foreground">
          L&apos;enchère démarre — la page se met à jour automatiquement.
        </p>
      ) : (
        <>
          <div dir="ltr" className="mt-3 flex items-stretch justify-center gap-2">
            {tiles.map((t) => (
              <div
                key={t.label}
                className="min-w-[64px] rounded-xl bg-[var(--surface)] px-2 py-2.5 text-center ring-1 ring-[var(--border)]"
              >
                <div className="batta-tabular text-[26px] font-extrabold leading-none text-foreground">
                  {t.v}
                </div>
                <div className="mt-1 text-[9.5px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-muted)]">
                  {t.label}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-center text-[11.5px] text-[var(--foreground-muted)]">
            Ouvre le <span className="font-semibold text-foreground">{openDate}</span>
          </p>
        </>
      )}
    </div>
  );
}

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}
