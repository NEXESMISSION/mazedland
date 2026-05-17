"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import {
  Gavel,
  Lock,
  ShieldCheck,
  Wallet,
  LogIn,
  Info,
  Minus,
  Plus,
  Ban,
  CheckCircle2,
  Eye,
  Trophy,
  Clock,
} from "lucide-react";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { PreBidGate } from "./PreBidGate";
import { Countdown } from "./Countdown";
import { nextMinBid, dutchCurrentPrice } from "@/lib/auction-engine";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { formatTND, minBidIncrement } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { AuctionWithProperty } from "@/lib/types";

// Error codes raised by the place_bid RPC. Surfacing raw codes reads as
// a bug; map to readable French so the user understands which rule fired.
const BID_ERROR_LABELS: Record<string, string> = {
  auction_closed: "Cette enchère est terminée.",
  auction_expired: "Cette enchère a expiré.",
  auction_not_found: "Enchère introuvable.",
  kyc_required: "Vérification d'identité requise pour enchérir.",
  deposit_required: "Vous devez verrouiller la caution avant d'enchérir.",
  self_bid_forbidden: "Vous ne pouvez pas enchérir sur votre propre bien.",
  below_opening: "Votre offre est inférieure au prix d'ouverture.",
  below_min_increment: "Votre offre est inférieure à l'incrément minimum.",
  dutch_price_drifted: "Le prix a baissé entre-temps — réessayez.",
  invalid_amount: "Montant invalide.",
  auth: "Vous devez vous reconnecter pour enchérir.",
};

function bidErrorLabel(code: string | undefined): string {
  if (!code) return "Échec de l'enchère.";
  return BID_ERROR_LABELS[code] ?? code;
}

interface Props {
  auction: AuctionWithProperty;
  userId: string | null;
  kycVerified: boolean;
  hasActiveDeposit: boolean;
  isOwner: boolean;
  depositAmount: number;
  totalBids: number;
  locale: string;
}

/**
 * The full bid widget. Handles every gate (login / KYC / deposit / owner /
 * not-live) up-front and branches into a type-specific composer (English /
 * Dutch / Sealed) once the user has cleared every check. Always renders
 * a confirmation modal before submitting — there's no one-click bid.
 */
export function BidComposer({
  auction,
  userId,
  kycVerified,
  hasActiveDeposit,
  isOwner,
  depositAmount,
  totalBids,
  locale,
}: Props) {
  const router = useRouter();
  const isLive = auction.status === "live" || auction.status === "extending";

  // ─── Gate 0: auction not live → ended banner (winner or generic) ──────
  if (!isLive) {
    const userWon =
      auction.winner_user_id != null && auction.winner_user_id === userId;
    return userWon ? (
      <WinnerBanner amount={auction.winner_amount} locale={locale} />
    ) : (
      <EndedBanner auctionId={auction.id} />
    );
  }

  // ─── Gate 1: anonymous ────────────────────────────────────────────────
  if (!userId) {
    return (
      <PreBidGate
        tone="muted"
        icon={<LogIn className="h-7 w-7" />}
        title="Connectez-vous pour enchérir"
        body="Vous aurez besoin d'un compte vérifié, puis de verrouiller la caution pour rejoindre cette enchère."
        ctaLabel="Se connecter"
        onCta={() =>
          router.push(`/login?next=/auctions/${auction.id}/bid` as never)
        }
        auction={auction}
        totalBids={totalBids}
        locale={locale}
      />
    );
  }

  // ─── Gate 2: owner of the property ────────────────────────────────────
  if (isOwner) {
    return (
      <PreBidGate
        tone="muted"
        icon={<Ban className="h-7 w-7" />}
        title="Vous publiez cette enchère"
        body="Le vendeur d'un bien ne peut pas y enchérir. Cette règle protège l'intégrité du marché."
        ctaLabel="Voir le tableau du vendeur"
        onCta={() => router.push(`/auctions/${auction.id}` as never)}
        auction={auction}
        totalBids={totalBids}
        locale={locale}
      />
    );
  }

  // ─── Gate 3: KYC not verified ─────────────────────────────────────────
  if (!kycVerified) {
    return (
      <PreBidGate
        tone="warning"
        icon={<ShieldCheck className="h-7 w-7" />}
        title="Vérifiez votre identité pour participer"
        body="Nous devons confirmer votre identité une seule fois avant que vous puissiez enchérir. La vérification prend deux minutes."
        ctaLabel="Commencer la vérification"
        ctaIcon={<ShieldCheck className="h-4 w-4" />}
        onCta={() => router.push("/kyc/start")}
        auction={auction}
        totalBids={totalBids}
        locale={locale}
      />
    );
  }

  // ─── Gate 4: no active deposit ────────────────────────────────────────
  if (!hasActiveDeposit) {
    return (
      <PreBidGate
        tone="gold"
        icon={<Wallet className="h-7 w-7" />}
        title="Verrouillez la caution pour rejoindre l'enchère"
        body={`Caution remboursable de ${formatTND(depositAmount, locale)} — débloque l'enchère immédiatement.`}
        ctaLabel={`Payer ${formatTND(depositAmount, locale)}`}
        ctaIcon={<Wallet className="h-4 w-4" />}
        onCta={() =>
          router.push(
            `/payment/checkout?type=deposit&auction=${auction.id}` as never,
          )
        }
        auction={auction}
        totalBids={totalBids}
        locale={locale}
        bullets={[
          "Montant fixe (10% du prix d'ouverture) — réserve votre place",
          "Intégralement remboursée sous 24 heures si vous ne gagnez pas",
          "Déduite du prix final si vous remportez l'enchère",
        ]}
      />
    );
  }

  // All gates passed → type-specific composer
  return (
    <ActiveComposer
      auction={auction}
      userId={userId}
      totalBids={totalBids}
      locale={locale}
    />
  );
}

/* ════════════════════════════════════════════════════════════════════ */
/*  ENDED STATES                                                        */
/* ════════════════════════════════════════════════════════════════════ */

function WinnerBanner({
  amount,
  locale,
}: {
  amount: number | null;
  locale: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--gold)]/30 bg-[var(--gold)]/10 px-6 py-5 text-center">
      <div className="mx-auto mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--gold)] text-black shadow-[var(--shadow-gold)]">
        <Trophy className="h-5 w-5" />
      </div>
      <div className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[var(--gold)]">
        Adjugé · vous avez gagné
      </div>
      <div className="batta-tabular mt-1 text-2xl font-extrabold gradient-gold-text">
        {amount != null ? formatTND(amount, locale) : "—"}
      </div>
      <div className="mt-1.5 text-xs text-[var(--foreground-muted)]">
        Prochaine étape : signature de l'acte chez le notaire.
      </div>
    </div>
  );
}

function EndedBanner({ auctionId }: { auctionId: string }) {
  const router = useRouter();
  return (
    <div className="space-y-4 py-6 text-center">
      <div className="mx-auto h-12 w-12 rounded-full bg-red-500/15 ring-1 ring-red-500/30 text-red-300 flex items-center justify-center">
        <Lock className="h-5 w-5" />
      </div>
      <div>
        <div className="text-base font-extrabold">Cette enchère est terminée</div>
        <p className="mt-1.5 text-xs text-[var(--foreground-muted)] leading-relaxed max-w-xs mx-auto">
          Les offres ne sont plus acceptées. Consultez les détails pour voir le résultat.
        </p>
      </div>
      <Button
        size="md"
        fullWidth
        variant="secondary"
        onClick={() => router.push(`/auctions/${auctionId}` as never)}
      >
        Voir le résultat
      </Button>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════ */
/*  ACTIVE COMPOSER (English / Dutch / Sealed)                          */
/* ════════════════════════════════════════════════════════════════════ */

function ActiveComposer({
  auction,
  userId,
  totalBids,
  locale,
}: {
  auction: AuctionWithProperty;
  userId: string;
  totalBids: number;
  locale: string;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const isDutch = auction.type === "dutch";
  const isSealed = auction.type === "sealed";
  const isEnglish = auction.type === "english";

  // Live current price — for Dutch this ticks down every 10s; for
  // English/sealed it tracks the server's current_price.
  const [currentPrice, setCurrentPrice] = useState<number>(
    auction.current_price ?? auction.opening_price,
  );
  const minNext = nextMinBid(auction, currentPrice);
  const inc = minBidIncrement(currentPrice);

  // English/sealed amount input. Sealed uses opening_price as the floor;
  // English uses minNext.
  const initialAmount = isSealed ? auction.opening_price : minNext;
  const [amountStr, setAmountStr] = useState<string>(String(initialAmount));
  const amount = (() => {
    const n = Number(amountStr);
    return Number.isFinite(n) ? n : 0;
  })();
  function setAmount(v: number) {
    setAmountStr(String(Math.max(0, Math.floor(v))));
  }

  const [showConfirm, setShowConfirm] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Live bid count — seeded from the server-rendered totalBids, bumped
  // by the realtime bids INSERT subscription below. Without this the
  // composer's "X offres" label stayed stuck on its initial value even
  // as other bidders fired in.
  const [bidsCount, setBidsCount] = useState<number>(totalBids);
  const [recentBidFlash, setRecentBidFlash] = useState(false);

  // Buy-now is only offered on auction-type listings that opted in with
  // a buy_now_price. Direct-sale listings have their own DirectSalePanel
  // on the detail page and never reach this composer.
  const buyNowPrice = auction.buy_now_price != null ? Number(auction.buy_now_price) : null;
  const showBuyNow = buyNowPrice != null && buyNowPrice > 0 && !isDutch;

  // ─── Realtime: single channel, two listeners ─────────────────────────
  // One Supabase channel carries every postgres_changes event we care
  // about for this auction:
  //   - auctions UPDATE → price ticks + status transitions
  //   - bids     INSERT → counter bump + gold-flash pulse
  // Combining them halves the WebSocket overhead and gives us a single
  // cleanup point on unmount or auction.id change.
  //
  // For Dutch we still subscribe — Dutch has no "live bidders" per se,
  // but the auction row updates (status → ended_sold) when someone else
  // accepts, and we need to react. The local 10s ticker keeps driving
  // the Dutch displayed price independently.
  useEffect(() => {
    const supabase = getBrowserSupabase();
    let flashTimer: ReturnType<typeof setTimeout> | null = null;

    const channel = supabase
      .channel(`bid-composer:${auction.id}`)
      .on(
        "postgres_changes" as unknown as never,
        {
          event: "UPDATE",
          schema: "public",
          table: "auctions",
          filter: `id=eq.${auction.id}`,
        } as never,
        (payload: {
          new: { current_price: number | null; status: string };
        }) => {
          const next = payload.new;
          // English / sealed: track the server's authoritative
          // current_price (already reflects proxy resolution + sealed
          // masking). Skip for Dutch — its ticker is the source of truth.
          if (!isDutch && next.current_price != null) {
            setCurrentPrice(Number(next.current_price));
          }
          if (
            next.status === "ended_sold" ||
            next.status === "ended_unsold" ||
            next.status === "awarded" ||
            next.status === "cancelled" ||
            next.status === "sixth_offer_window"
          ) {
            router.refresh();
          }
        },
      )
      .on(
        "postgres_changes" as unknown as never,
        {
          event: "INSERT",
          schema: "public",
          table: "bids",
          filter: `auction_id=eq.${auction.id}`,
        } as never,
        () => {
          setBidsCount((c) => c + 1);
          setRecentBidFlash(true);
          if (flashTimer) clearTimeout(flashTimer);
          flashTimer = setTimeout(() => setRecentBidFlash(false), 1500);
        },
      )
      .subscribe();

    return () => {
      if (flashTimer) clearTimeout(flashTimer);
      supabase.removeChannel(channel);
    };
  }, [auction.id, isDutch, router]);

  // Dutch live ticker — recompute the asked price every 10s. Without
  // this the price only refreshed on full page reload, and accepting a
  // Dutch auction would lock in a stale value.
  useEffect(() => {
    if (!isDutch) return;
    function tick() {
      const next = dutchCurrentPrice(auction);
      setCurrentPrice(next);
    }
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, [auction, isDutch]);

  // Re-clamp the input upward if the live price overtook it (English only).
  useEffect(() => {
    if (isEnglish) {
      setAmount(amount < minNext ? minNext : amount);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minNext, isEnglish]);

  // English-only presets (Minimum / +5% / +10%).
  const presets = useMemo(() => {
    if (!isEnglish) return [];
    const round = (n: number) => Math.round(n / inc) * inc;
    const five = Math.max(minNext, round(currentPrice * 1.05));
    const ten = Math.max(minNext, round(currentPrice * 1.1));
    const out = [{ key: "min", label: "Minimum", amount: minNext }];
    if (five > minNext) out.push({ key: "5", label: "+5%", amount: five });
    if (ten > five) out.push({ key: "10", label: "+10%", amount: ten });
    return out;
  }, [isEnglish, minNext, inc, currentPrice]);

  // The amount we'll actually submit. Dutch posts the live asked price.
  const submitAmount = isDutch ? currentPrice : amount;

  function openConfirm() {
    if (isEnglish && amount < minNext) {
      toast(`Minimum : ${formatTND(minNext, locale)}`, "warning");
      return;
    }
    if (isSealed && amount < auction.opening_price) {
      toast(
        `Minimum : ${formatTND(auction.opening_price, locale)} (prix d'ouverture)`,
        "warning",
      );
      return;
    }
    setShowConfirm(true);
  }

  async function placeBid() {
    setSubmitting(true);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/auctions/${auction.id}/bid`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: submitAmount }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          // If the auction closed under us, the cached panel is stale —
          // pull the fresh row so the next render shows the ended state
          // (winner banner if we were the winner, generic ended otherwise).
          if (
            data.error === "auction_closed" ||
            data.error === "auction_expired"
          ) {
            router.refresh();
          }
          toast(bidErrorLabel(data.error), "error");
          return;
        }
        const data = (await res.json()) as {
          ok: boolean;
          current_price?: number | null;
        };
        const newPrice = isSealed
          ? currentPrice
          : Number(data.current_price ?? currentPrice);
        setCurrentPrice(newPrice);
        if (isEnglish) setAmount(nextMinBid(auction, newPrice));
        toast(
          isDutch
            ? `Adjugé à ${formatTND(submitAmount, locale)}`
            : `Offre envoyée : ${formatTND(submitAmount, locale)}`,
          "success",
        );
        // For Dutch the auction is now ended_sold server-side. For English
        // a refresh keeps the bid history / countdown in sync.
        router.refresh();
      } finally {
        setSubmitting(false);
        setShowConfirm(false);
      }
    });
  }

  // Buy-now is just a navigation now — /payment/checkout handles the
  // confirmation step (provider selection + amount review) before
  // POSTing to /api/auctions/[id]/buy-now and redirecting through the
  // gateway. No inline modal needed.
  function goBuyNow() {
    router.push(
      `/payment/checkout?type=buy_now&auction=${auction.id}` as never,
    );
  }

  const ctaLabel = isDutch
    ? `Accepter ${formatTND(currentPrice, locale)}`
    : isSealed
      ? `Soumettre ${formatTND(amount, locale)}`
      : `Enchérir à ${formatTND(amount, locale)}`;

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Status strip — live pulse + countdown + Rules link */}
      <div className="flex items-center gap-2 text-[11px] lg:text-[12px] text-[var(--foreground-muted)] flex-wrap">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)] pulse-gold" />
          <span className="text-[10px] lg:text-[11px] font-bold text-[var(--gold)] uppercase tracking-[0.2em]">
            En direct
          </span>
        </span>
        <span className="text-[var(--border-strong)]">·</span>
        <Countdown endsAt={auction.ends_at} />
        <button
          onClick={() => setShowRules(true)}
          className="ms-auto inline-flex items-center gap-1 hover:text-[var(--gold)]"
        >
          <Info className="h-3 w-3" />
          Règles
        </button>
      </div>

      {/* Price block */}
      <div>
        <div className="text-[10px] lg:text-[11px] uppercase tracking-[0.2em] lg:tracking-[0.22em] font-bold text-[var(--foreground-subtle)] lg:text-[var(--foreground-muted)] mb-1 lg:mb-1.5">
          {isDutch ? "Prix demandé" : "Prix actuel"}
        </div>
        <div className="text-3xl lg:text-[44px] xl:text-[52px] font-extrabold lg:font-black batta-tabular leading-none gradient-gold-text">
          <span key={currentPrice} className="inline-block">
            {formatTND(currentPrice, locale)}
          </span>
        </div>
        <div className="text-[11px] lg:text-[12px] text-[var(--foreground-muted)] mt-2 lg:mt-3 batta-tabular">
          <span
            className={cn(
              "inline-flex items-center gap-1 transition-colors",
              recentBidFlash && "text-[var(--gold)] font-bold",
            )}
          >
            {recentBidFlash && (
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)] pulse-gold" />
            )}
            {bidsCount} {bidsCount === 1 ? "offre" : "offres"}
          </span>
          {isDutch && (
            <>
              <span className="mx-1 text-[var(--border-strong)]">·</span>
              <span>Baisse de {formatTND(auction.dutch_decrement ?? 0, locale)} toutes les {Math.round((auction.dutch_tick_seconds ?? 60) / 60)} min</span>
            </>
          )}
        </div>
      </div>

      <div className="h-px bg-[var(--border)]" />

      {/* Type-specific input section */}
      {isDutch ? (
        <DutchInfo auction={auction} locale={locale} />
      ) : (
        <AmountInput
          isEnglish={isEnglish}
          isSealed={isSealed}
          amount={amount}
          amountStr={amountStr}
          setAmountStr={setAmountStr}
          minBid={isSealed ? auction.opening_price : minNext}
          increment={inc}
          presets={presets}
          onSetAmount={setAmount}
          currentPrice={currentPrice}
          locale={locale}
        />
      )}

      {/* CTA — sticky on mobile so users never lose it while scrolling */}
      <div
        className={cn(
          "space-y-2.5",
          "sticky bottom-0 z-30 -mx-4 px-4 py-3",
          "bg-white/95 backdrop-blur-xl",
          "border-t border-[var(--border)]",
          "pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
          "lg:static lg:bottom-auto lg:mx-0 lg:px-0 lg:py-0",
          "lg:bg-transparent lg:backdrop-blur-none",
          "lg:border-0 lg:pb-0",
        )}
      >
        <Button
          size="md"
          fullWidth
          onClick={openConfirm}
          disabled={submitting}
          className="lg:h-14 lg:text-base lg:rounded-full"
        >
          <Gavel className="h-4 w-4 lg:h-5 lg:w-5" />
          {ctaLabel}
        </Button>
        {isSealed && (
          <p className="text-center text-[11px] text-[var(--foreground-subtle)] inline-flex items-center justify-center gap-1.5 w-full">
            <Eye className="h-3 w-3" />
            Votre montant reste privé jusqu'à la clôture.
          </p>
        )}

        {/* Buy-now escape hatch — small text link, navigates to the
            unified checkout. */}
        {showBuyNow && (
          <button
            type="button"
            onClick={goBuyNow}
            className="block w-full text-center text-[12px] text-[var(--foreground-muted)] hover:text-[var(--gold)] py-1"
          >
            ou achat immédiat à{" "}
            <span className="font-bold text-foreground">
              {formatTND(buyNowPrice!, locale)}
            </span>
          </button>
        )}
      </div>

      {/* Confirmation modal */}
      <Modal
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        title="Confirmer l'offre"
      >
        <div className="space-y-5">
          <div className="text-center py-2">
            <div className="text-4xl font-extrabold gradient-gold-text batta-tabular leading-none">
              {formatTND(submitAmount, locale)}
            </div>
            {isEnglish && submitAmount > currentPrice && (
              <div className="mt-3 inline-flex items-center gap-2 text-[11px] text-[var(--foreground-muted)] batta-tabular">
                <span className="line-through opacity-60">
                  {formatTND(currentPrice, locale)}
                </span>
                <span className="text-[var(--gold)] font-bold">
                  +{formatTND(submitAmount - currentPrice, locale)}
                </span>
              </div>
            )}
          </div>
          <div className="rounded-[var(--radius)] bg-[var(--surface-2)] divide-y divide-[var(--border)]">
            <Row label="Bien">
              <span className="font-bold truncate ms-3">
                {auction.property.title}
              </span>
            </Row>
            <Row label="Type">
              <span className="font-bold ms-3 uppercase tracking-wider">
                {auction.type}
              </span>
            </Row>
            <Row label="Restant">
              <Countdown endsAt={auction.ends_at} />
            </Row>
          </div>
          <p className="text-[11px] text-center text-[var(--foreground-subtle)] leading-relaxed">
            {isDutch
              ? "Le prix Dutch ne se renégocie pas — accepter adjuge immédiatement."
              : isSealed
                ? "Votre offre est confidentielle jusqu'à la clôture. Aucune annulation après envoi."
                : "Votre offre est enregistrée immédiatement et visible par les autres enchérisseurs."}
          </p>
        </div>
        <ModalFooter>
          <Button variant="ghost" size="md" onClick={() => setShowConfirm(false)}>
            Annuler
          </Button>
          <Button size="md" onClick={placeBid} disabled={submitting}>
            <CheckCircle2 className="h-4 w-4" />
            {submitting ? "Envoi…" : `Confirmer ${formatTND(submitAmount, locale)}`}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Rules modal */}
      <Modal
        open={showRules}
        onClose={() => setShowRules(false)}
        title="Règles de l'enchère"
      >
        <ul className="space-y-3 text-sm text-[var(--foreground-muted)] leading-relaxed">
          <li>
            • <strong className="text-foreground">Caution :</strong> 10% du prix d'ouverture, verrouillée par enchère, remboursée sous 24 h si vous ne gagnez pas.
          </li>
          {isEnglish && (
            <li>
              • <strong className="text-foreground">Anti-sniping :</strong> Toute offre dans les dernières minutes prolonge l'enchère.
            </li>
          )}
          {isDutch && (
            <li>
              • <strong className="text-foreground">Dutch :</strong> Le prix baisse à intervalles fixes. La première personne qui accepte remporte l'enchère immédiatement.
            </li>
          )}
          {isSealed && (
            <li>
              • <strong className="text-foreground">Sealed-bid :</strong> Une seule offre privée par participant. Les montants sont révélés à la clôture.
            </li>
          )}
          <li>
            • <strong className="text-foreground">Surenchère du 1/6 :</strong> Loi tunisienne — surenchère légale d'au moins 1/6 du prix adjugé, dans les 8 jours.
          </li>
          <li>
            • <strong className="text-foreground">Retrait après victoire :</strong> Caution saisie + bannissement.
          </li>
        </ul>
      </Modal>

    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 text-xs">
      <span className="text-[10px] uppercase tracking-[0.15em] font-bold text-[var(--foreground-muted)]">
        {label}
      </span>
      {children}
    </div>
  );
}

function DutchInfo({
  auction,
  locale,
}: {
  auction: AuctionWithProperty;
  locale: string;
}) {
  const floor = auction.dutch_floor_price ?? auction.opening_price;
  const start = auction.dutch_start_price ?? auction.opening_price;
  return (
    <div className="rounded-xl bg-[var(--surface-2)] border border-[var(--border)] p-4 space-y-2 text-[11px] text-[var(--foreground-muted)]">
      <div className="flex justify-between">
        <span>Prix de départ</span>
        <span className="batta-tabular font-bold text-foreground">
          {formatTND(start, locale)}
        </span>
      </div>
      <div className="flex justify-between">
        <span>Plancher (prix minimum)</span>
        <span className="batta-tabular font-bold text-foreground">
          {formatTND(floor, locale)}
        </span>
      </div>
      <p className="pt-2 text-[10px] leading-relaxed">
        Le prix baisse automatiquement. La première personne qui clique sur « Accepter » l'emporte immédiatement.
      </p>
    </div>
  );
}

function AmountInput({
  isEnglish,
  isSealed,
  amount,
  amountStr,
  setAmountStr,
  minBid,
  increment,
  presets,
  onSetAmount,
  currentPrice,
  locale,
}: {
  isEnglish: boolean;
  isSealed: boolean;
  amount: number;
  amountStr: string;
  setAmountStr: (v: string) => void;
  minBid: number;
  increment: number;
  presets: { key: string; label: string; amount: number }[];
  onSetAmount: (v: number) => void;
  currentPrice: number;
  locale: string;
}) {
  return (
    <div className="space-y-2 lg:space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] lg:text-[11px] uppercase tracking-[0.2em] lg:tracking-[0.22em] font-bold text-[var(--foreground-muted)]">
          {isSealed ? "Votre offre privée" : "Votre offre"}
        </span>
        <span
          className={cn(
            "batta-tabular font-bold text-[11px] lg:text-[12px]",
            amount < minBid
              ? "text-[var(--danger)]"
              : amount === minBid
                ? "text-[var(--foreground-subtle)]"
                : "text-[var(--gold)]",
          )}
        >
          {amount < minBid
            ? `< ${formatTND(minBid, locale)}`
            : isSealed
              ? `Min ${formatTND(minBid, locale)}`
              : amount === minBid
                ? `Minimum · incrément ${formatTND(increment, locale)}`
                : `+${formatTND(amount - currentPrice, locale)}`}
        </span>
      </div>

      <div
        className={cn(
          "flex items-stretch h-12 lg:h-16 rounded-[var(--radius)] lg:rounded-2xl overflow-hidden border transition-colors",
          amount < minBid
            ? "border-[var(--danger)]/50"
            : "border-[var(--border)] focus-within:border-[var(--gold)]",
        )}
      >
        {isEnglish && (
          <button
            onClick={() => onSetAmount(Math.max(minBid, amount - increment))}
            disabled={amount <= minBid}
            aria-label="Réduire"
            className="px-3 lg:px-5 bg-[var(--surface-2)] hover:bg-[var(--surface-3)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
          >
            <Minus className="h-4 w-4 lg:h-5 lg:w-5" />
          </button>
        )}
        <input
          type="text"
          inputMode="numeric"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value.replace(/\D/g, ""))}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => {
            const n = Number(amountStr);
            const clamped = Number.isFinite(n) && n >= minBid ? n : minBid;
            setAmountStr(String(clamped));
          }}
          className="flex-1 bg-transparent text-center text-xl lg:text-2xl xl:text-3xl font-extrabold batta-tabular focus:outline-none"
          aria-label="Votre offre"
        />
        {isEnglish && (
          <button
            onClick={() => onSetAmount(Math.max(minBid, amount) + increment)}
            aria-label="Incrément"
            className="px-3 lg:px-5 bg-[var(--surface-2)] hover:bg-[var(--surface-3)] flex items-center justify-center"
          >
            <Plus className="h-4 w-4 lg:h-5 lg:w-5" />
          </button>
        )}
      </div>

      {isEnglish && presets.length > 0 && (
        <div className="flex items-center gap-1.5 lg:gap-2">
          {presets.map((p) => (
            <button
              key={p.key}
              onClick={() => onSetAmount(p.amount)}
              className={cn(
                "h-7 lg:h-9 px-2.5 lg:px-4 rounded-full text-[11px] lg:text-[12px] font-bold batta-tabular transition-colors",
                amount === p.amount
                  ? "bg-[var(--gold)] text-black"
                  : "bg-[var(--surface-2)] border border-[var(--border)] text-[var(--foreground-muted)] hover:border-[var(--gold)]/50 hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
