"use client";

import { useRouter, Link } from "@/i18n/navigation";
import {
  Tag,
  ShieldCheck,
  CheckCircle2,
  LayoutDashboard,
  Handshake,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { formatTND } from "@/lib/utils";
import type { AuctionWithProperty } from "@/lib/types";

interface Props {
  auction: AuctionWithProperty;
  userId: string | null;
  /** Server-truth: did the active user complete KYC? */
  kycVerified: boolean;
  /** Server-truth: does the active user own this property? */
  isOwner: boolean;
  locale: string;
}

/**
 * Replaces the auction price card + bid CTA on the detail page when
 * `auction.listing_type === 'direct'`. Direct listings have no bidding,
 * no countdown — one fixed price, first KYC-verified buyer wins.
 *
 * The "Acheter" CTA navigates to `/payment/checkout?type=buy_now`,
 * where the user picks a provider and confirms. The unified checkout
 * flow handles gateway redirect → capture → auction close — so this
 * component has no inline POST or confirmation modal of its own.
 */
export function DirectSalePanel({
  auction,
  userId,
  kycVerified,
  isOwner,
  locale,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();

  const price = Number(auction.sale_price ?? 0);
  const isSold =
    auction.status === "ended_sold" || auction.status === "awarded";
  const isCancelled = auction.status === "cancelled";
  const isAvailable =
    !isSold && !isCancelled && auction.status !== "ended_unsold";
  const userBoughtIt =
    isSold &&
    auction.winner_user_id != null &&
    auction.winner_user_id === userId;

  function buy() {
    if (!userId) {
      router.push(`/login?next=/auctions/${auction.id}` as never);
      return;
    }
    if (isOwner) {
      toast("Vous ne pouvez pas acheter votre propre annonce.", "warning");
      return;
    }
    if (!kycVerified) {
      toast(
        "Vous devez vérifier votre identité avant l'achat.",
        "warning",
      );
      router.push("/kyc/start");
      return;
    }
    router.push(
      `/payment/checkout?type=buy_now&auction=${auction.id}` as never,
    );
  }

  return (
    <section className="mx-4 mt-5">
      {/* Calm price + label */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--gold)] inline-flex items-center gap-1.5">
          <Tag className="h-3 w-3" strokeWidth={2.5} />
          Vente directe
        </span>
        {auction.sale_negotiable && !isSold && (
          <span className="text-[11px] font-bold text-[var(--foreground-muted)] inline-flex items-center gap-1">
            <Handshake className="h-3 w-3" />
            Prix négociable
          </span>
        )}
      </div>
      <div className="batta-tabular gradient-gold-text mt-1.5 text-[40px] lg:text-[44px] font-extrabold leading-none">
        {formatTND(price, locale)}
      </div>

      {/* Action — single primary CTA */}
      <div className="mt-4 space-y-2">
        {isAvailable && !isOwner && (
          <button
            type="button"
            onClick={buy}
            className="block h-12 w-full rounded-[var(--radius)] bg-[var(--gold)] text-white font-bold text-[14px] inline-flex items-center justify-center gap-2 shadow-[var(--shadow-gold)] hover:bg-[var(--gold-bright)] active:scale-[0.99] transition-all"
          >
            <Tag className="h-4 w-4" strokeWidth={2.5} />
            {!userId
              ? "Se connecter pour acheter"
              : !kycVerified
                ? "Vérifier l'identité pour acheter"
                : `Acheter ${formatTND(price, locale)}`}
          </button>
        )}

        {isAvailable && isOwner && (
          <Link
            href={`/sell` as never}
            className="block h-12 w-full rounded-[var(--radius)] bg-[var(--surface-2)] border border-[var(--border)] text-foreground font-semibold text-[13px] inline-flex items-center justify-center gap-2 hover:border-[var(--gold-soft)] hover:text-[var(--gold)] transition-colors"
          >
            <LayoutDashboard className="h-4 w-4" />
            Tableau du vendeur
          </Link>
        )}

        {userBoughtIt && (
          <div className="flex items-center justify-between gap-3 py-2 px-1">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-[var(--gold)]">
                Acquis · vous êtes propriétaire
              </div>
              <div className="text-[11px] text-[var(--foreground-muted)] mt-0.5">
                Signature de l&apos;acte chez le notaire à venir.
              </div>
            </div>
            <Link
              href="/account/wins"
              className="shrink-0 text-[12px] font-semibold text-[var(--gold)] hover:underline"
            >
              Mes acquisitions →
            </Link>
          </div>
        )}

        {isSold && !userBoughtIt && (
          <div className="text-center text-[12px] text-[var(--foreground-muted)] py-2">
            Bien vendu — cette annonce n&apos;est plus disponible.
          </div>
        )}

        {isCancelled && (
          <div className="text-center text-[12px] text-[var(--foreground-muted)] py-2">
            Annonce retirée.{" "}
            <Link
              href="/properties"
              className="text-[var(--gold)] font-semibold hover:underline"
            >
              Voir d&apos;autres biens
            </Link>
          </div>
        )}
      </div>

      {/* Trust signals — plain text, no boxes */}
      {isAvailable && !isOwner && (
        <div className="mt-4 space-y-1.5 text-[11px] text-[var(--foreground-muted)] leading-snug">
          <p className="inline-flex items-start gap-1.5">
            <ShieldCheck className="h-3 w-3 text-[var(--gold)] mt-0.5 shrink-0" />
            Vente confirmée au moment de la signature notariée.
          </p>
          <p className="inline-flex items-start gap-1.5">
            <CheckCircle2 className="h-3 w-3 text-[var(--gold)] mt-0.5 shrink-0" />
            Vendeur vérifié KYC · titre foncier contrôlé.
          </p>
        </div>
      )}
    </section>
  );
}
