"use client";

import Image from "next/image";
import { CheckCircle2, ArrowRight, ShieldCheck, Clock, Gavel, Users, MapPin } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Countdown } from "./Countdown";
import { formatTND } from "@/lib/utils";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { cn } from "@/lib/utils";
import type { AuctionWithProperty } from "@/lib/types";

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
}

/**
 * Replaces the bid composer when the user can't actually bid yet — login,
 * KYC, deposit, or own-listing. Looks distinctly *not* like a bid form so
 * the user knows the next step is something else.
 *
 * Mobile (<lg): compact card stack.
 * Desktop (lg+): magazine-style 2-col — property hero on the start,
 *   gate card on the end with bigger typography and trust signals.
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
  auction,
  totalBids,
  locale,
}: Props) {
  const property = auction.property;
  const photos = property.photos?.sort((a, b) => a.sort_order - b.sort_order) ?? [];
  const heroPhoto = photos[0];
  const currentPrice = auction.current_price ?? auction.opening_price;

  const palette = {
    muted: {
      ring: "border-[var(--border)]",
      bg: "bg-[var(--surface)]",
      iconBg: "bg-[var(--surface-2)] text-[var(--foreground-muted)]",
    },
    warning: {
      ring: "border-amber-500/40",
      bg: "bg-amber-500/5",
      iconBg: "bg-amber-500/15 text-amber-400",
    },
    gold: {
      ring: "border-[var(--gold)]/40",
      bg: "bg-gradient-to-br from-[var(--surface)] to-[#1a1408]",
      iconBg:
        "bg-[var(--gold-faint)] text-[var(--gold)] shadow-[var(--shadow-gold)]",
    },
  }[tone];

  return (
    <>
      {/* ─── MOBILE — compact stack ─── */}
      <div className="lg:hidden space-y-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="batta-tabular text-2xl font-extrabold leading-none gradient-gold-text">
            {formatTND(currentPrice, locale)}
          </div>
          <div className="inline-flex items-center gap-2 text-[11px] text-[var(--foreground-muted)]">
            <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded-full bg-[var(--gold-faint)] border border-[var(--gold)]/30 text-[var(--gold)] text-[10px] font-bold uppercase tracking-[0.15em]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)] pulse-gold" />
              En direct
            </span>
            <Countdown endsAt={auction.ends_at} />
            <span className="text-[var(--border-strong)]">·</span>
            <span className="batta-tabular">
              {totalBids} {totalBids === 1 ? "offre" : "offres"}
            </span>
          </div>
        </div>

        <div className={`rounded-[var(--radius-md)] border ${palette.ring} ${palette.bg} p-5 space-y-4`}>
          <div className="flex items-start gap-3">
            <div className={`h-12 w-12 rounded-full ${palette.iconBg} flex items-center justify-center shrink-0`}>
              {icon}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-extrabold text-base leading-tight">{title}</h3>
              <p className="text-xs text-[var(--foreground-muted)] mt-1.5 leading-relaxed">{body}</p>
            </div>
          </div>

          {bullets && bullets.length > 0 && (
            <ul className="space-y-1.5 text-xs text-[var(--foreground-muted)] ms-1">
              {bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[var(--gold)] shrink-0 mt-0.5" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}

          <Button onClick={onCta} size="md" fullWidth>
            {ctaIcon}
            {ctaLabel}
          </Button>
        </div>
      </div>

      {/* ─── DESKTOP — magazine 2-col ─── */}
      <div className="hidden lg:grid grid-cols-[1.1fr_1fr] gap-8 xl:gap-10 items-start">
        {/* Property hero */}
        <div className="relative rounded-[28px] overflow-hidden ring-1 ring-white/10 bg-[var(--surface)] aspect-[4/3]">
          {heroPhoto ? (
            <Image
              src={propertyPhotoUrl(heroPhoto.storage_path)}
              alt={property.title}
              fill
              sizes="(min-width: 1280px) 580px, 50vw"
              className="object-cover"
              draggable={false}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-7xl text-foreground/15">
              🏛️
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/20" />

          <div className="absolute inset-x-0 top-0 p-5 flex items-start justify-between gap-3">
            <span className="inline-flex items-center gap-2 px-3 h-8 rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/40 backdrop-blur-md">
              <span className="relative flex h-2 w-2">
                <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
                <span className="relative h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">
                En direct
              </span>
            </span>
            <span className="inline-flex items-center gap-2 px-3 h-8 rounded-full bg-black/60 backdrop-blur-md ring-1 ring-white/10 text-white">
              <Clock className="h-3.5 w-3.5 text-[var(--gold)]" />
              <Countdown endsAt={auction.ends_at} />
            </span>
          </div>

          <div className="absolute inset-x-0 bottom-0 p-7">
            <div className="text-[10px] uppercase tracking-[0.22em] font-bold text-[var(--gold)] mb-1.5">
              Vous enchérissez sur
            </div>
            <h2 className="text-3xl xl:text-[34px] font-black text-white leading-[1.05] tracking-tight">
              {property.title}
            </h2>
            <div className="mt-1.5 inline-flex items-center gap-1.5 text-base text-white/75 font-light">
              <MapPin className="h-4 w-4" />
              <span>
                {property.governorate}
                {property.delegation ? ` · ${property.delegation}` : ""}
              </span>
            </div>

            <div className="mt-5 flex items-end justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-white/60">
                  Prix actuel
                </div>
                <div className="batta-tabular mt-1 text-[34px] xl:text-[40px] font-black gradient-gold-text leading-none">
                  {formatTND(currentPrice, locale)}
                </div>
              </div>
              <div className="flex items-center gap-4 text-white/85 text-[13px] pb-1.5">
                <span className="inline-flex items-center gap-1.5 batta-tabular">
                  <Gavel className="h-4 w-4 text-[var(--gold)]" />
                  {totalBids} {totalBids === 1 ? "offre" : "offres"}
                </span>
                <span className="inline-flex items-center gap-1.5 batta-tabular">
                  <Users className="h-4 w-4 text-[var(--gold)]" />
                  {auction.type === "sealed" ? "—" : "1"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Gate card */}
        <div className={`relative overflow-hidden rounded-[28px] border ${palette.ring} ${palette.bg} p-9 xl:p-10`}>
          {tone === "gold" && (
            <div
              aria-hidden
              className="pointer-events-none absolute -top-20 -end-20 h-56 w-56 rounded-full bg-[var(--gold)] blur-3xl opacity-20"
            />
          )}
          <div className="relative space-y-7">
            <div className={`h-16 w-16 rounded-2xl ${palette.iconBg} flex items-center justify-center`}>
              {icon}
            </div>
            <div>
              <h3 className="text-3xl xl:text-[34px] font-black tracking-tight leading-[1.1]">
                {title}
              </h3>
              <p className="mt-3 text-[15px] text-[var(--foreground-muted)] leading-relaxed">
                {body}
              </p>
            </div>

            {bullets && bullets.length > 0 && (
              <ul className="space-y-3">
                {bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-3 rounded-xl bg-black/20 ring-1 ring-white/5 p-3.5">
                    <span className="h-7 w-7 rounded-full bg-[var(--gold)]/20 ring-1 ring-[var(--gold)]/40 text-[var(--gold)] flex items-center justify-center shrink-0">
                      <CheckCircle2 className="h-4 w-4" />
                    </span>
                    <span className="text-[14px] text-foreground/90 leading-snug">{b}</span>
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              onClick={onCta}
              className={cn(
                "group inline-flex items-center justify-center gap-2 w-full h-14 rounded-full font-extrabold text-[15px] transition-transform hover:scale-[1.01] active:scale-[0.99]",
                tone === "gold"
                  ? "bg-[var(--gold)] text-black shadow-[var(--shadow-gold)]"
                  : tone === "warning"
                    ? "bg-amber-400 text-black shadow-[0_8px_24px_-4px_rgba(245,158,11,0.5)]"
                    : "bg-foreground text-background",
              )}
            >
              {ctaIcon}
              {ctaLabel}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>

            {tone === "gold" && (
              <div className="flex items-center justify-center gap-4 text-[11px] text-[var(--foreground-subtle)] pt-1">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-[var(--gold)]" />
                  Paiement sécurisé
                </span>
                <span className="text-[var(--border-strong)]">·</span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-[var(--gold)]" />
                  Remboursement sous 24 h
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
