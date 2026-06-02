"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
  already_highest: "Vous êtes déjà le meilleur enchérisseur.",
  sealed_one_bid: "Vous avez déjà soumis une offre pour cette enchère.",
  auth: "Vous devez vous reconnecter pour enchérir.",
};

function bidErrorLabel(code: string | undefined): string {
  if (!code) return "Échec de l'enchère.";
  return BID_ERROR_LABELS[code] ?? code;
}

/**
 * Human-friendly "opens in 3 j 4 h" / "opens dans 12 min" string used by
 * the not-yet-started gate. We snap to coarse units because the gate
 * card doesn't tick — re-fetching on auction page nav is the implicit
 * refresh.
 */
function formatStartsIn(startsAt: string | null): string {
  if (!startsAt) return "bientôt";
  const ms = new Date(startsAt).getTime() - Date.now();
  if (ms <= 0) return "dans un instant";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `dans ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `dans ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "demain" : `dans ${d} j`;
}

interface Props {
  auction: AuctionWithProperty;
  userId: string | null;
  kycVerified: boolean;
  /** Raw kyc_status from profiles. When provided, the KYC gate branches
   *  on "submitted" (waiting on admin) and "rejected" (must redo) instead
   *  of bucketing everything under "Vérifiez votre identité" — that wording
   *  told a user who had ALREADY submitted to start over, which is
   *  exactly the confusion the user flagged.
   *  Optional for backward compat with old callers that only pass the
   *  boolean. */
  kycStatus?: string | null;
  hasActiveDeposit: boolean;
  /** Caution receipt uploaded, waiting on admin validation (no captured
   *  deposit yet). Shows a "we're checking it" gate instead of pay-again. */
  depositUnderReview?: boolean;
  isOwner: boolean;
  depositAmount: number;
  /** Admin setting: false when entry is free (free mode or free window). */
  depositRequired?: boolean;
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
  kycStatus = null,
  hasActiveDeposit,
  depositUnderReview = false,
  isOwner,
  depositAmount,
  depositRequired = true,
  totalBids,
  locale,
}: Props) {
  const router = useRouter();
  const [joiningFree, setJoiningFree] = useState(false);

  // Free entry: register a zero participation row, then refresh so the
  // composer shows. No payment, no checkout redirect.
  async function joinFree() {
    if (joiningFree) return;
    setJoiningFree(true);
    try {
      const res = await fetch(`/api/auctions/${auction.id}/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        setJoiningFree(false);
        return;
      }
      router.refresh();
    } catch {
      setJoiningFree(false);
    }
  }
  const isLive = auction.status === "live" || auction.status === "extending";
  const isScheduled = auction.status === "scheduled";

  // ─── Gate 0: truly ENDED (not scheduled) → winner / ended banner ──────
  //     Scheduled auctions deliberately fall THROUGH the gates below so the
  //     user can reserve their place (pay the deposit / register) before
  //     the auction opens — the deposit endpoint already permits the
  //     scheduled state. They simply can't place a bid until it goes live.
  if (!isLive && !isScheduled) {
    const userWon =
      auction.winner_user_id != null && auction.winner_user_id === userId;
    return userWon ? (
      <WinnerBanner amount={auction.winner_amount} locale={locale} />
    ) : (
      <EndedBanner
        auctionId={auction.id}
        winnerAmount={auction.winner_amount}
        locale={locale}
      />
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
  // Branch on the raw kyc_status so a user who's ALREADY submitted their
  // dossier doesn't get told to start over — that was the source of the
  // "I sent verification and you're still asking me to verify" confusion.
  //   submitted/pending  → calm "we're reviewing it" gate, no CTA to redo
  //   rejected           → explain it was refused, CTA to redo
  //   anything else      → original "Vérifiez votre identité"
  if (!kycVerified) {
    const status = kycStatus ?? "";
    if (status === "submitted" || status === "pending") {
      return (
        <PreBidGate
          tone="muted"
          icon={<Clock className="h-7 w-7" />}
          title="Vérification en cours"
          body="Votre dossier est en cours d'examen — généralement sous 24 à 48 h ouvrées. Vous pourrez enchérir dès que notre équipe valide votre identité; un email vous préviendra."
          ctaLabel="Voir le statut"
          ctaIcon={<Eye className="h-4 w-4" />}
          onCta={() => router.push("/kyc/status")}
          auction={auction}
          totalBids={totalBids}
          locale={locale}
        />
      );
    }
    if (status === "rejected") {
      return (
        <PreBidGate
          tone="warning"
          icon={<ShieldCheck className="h-7 w-7" />}
          title="Vérification refusée"
          body="Vos documents n'ont pas pu être validés. Reprenez la vérification avec des photos plus nettes et lisibles."
          ctaLabel="Reprendre la vérification"
          ctaIcon={<ShieldCheck className="h-4 w-4" />}
          onCta={() => router.push("/kyc/start")}
          auction={auction}
          totalBids={totalBids}
          locale={locale}
        />
      );
    }
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
    // Receipt already uploaded → don't ask them to pay again. Show a calm
    // "we're checking it" state with a link to track the payment.
    if (depositUnderReview) {
      return (
        <PreBidGate
          tone="warning"
          icon={<Clock className="h-7 w-7" />}
          title="Caution en cours de validation"
          body="Nous avons bien reçu votre reçu. Vous pourrez enchérir dès qu'un administrateur l'a validé — vous serez notifié(e)."
          ctaLabel="Suivre mon paiement"
          onCta={() => router.push("/account/payments")}
          auction={auction}
          totalBids={totalBids}
          locale={locale}
          bullets={["Reçu reçu", "Vérification en cours", "Notification dès validation"]}
        />
      );
    }
    // Free entry (admin set deposit to free, or the free window is open):
    // one tap registers participation — no payment, no checkout.
    if (!depositRequired) {
      return (
        <PreBidGate
          tone="gold"
          icon={<Wallet className="h-7 w-7" />}
          title="Participation gratuite"
          body="Aucune caution requise — rejoignez l'enchère en un clic."
          ctaLabel={joiningFree ? "Inscription…" : "Participer gratuitement"}
          ctaIcon={<Wallet className="h-4 w-4" />}
          onCta={joinFree}
          auction={auction}
          totalBids={totalBids}
          locale={locale}
          bullets={["Gratuit", "Place réservée", "Enchère immédiate"]}
        />
      );
    }
    return (
      <PreBidGate
        tone="gold"
        icon={<Wallet className="h-7 w-7" />}
        title="Réservez votre place"
        body={
          isScheduled
            ? `L'enchère ouvre ${formatStartsIn(auction.starts_at)}.`
            : "Une caution remboursable, déduite du prix final si vous gagnez."
        }
        ctaLabel={isScheduled ? "Réserver ma place" : "Payer la caution"}
        ctaIcon={<Wallet className="h-4 w-4" />}
        onCta={() =>
          router.push(
            `/payment/checkout?type=deposit&auction=${auction.id}` as never,
          )
        }
        auction={auction}
        totalBids={totalBids}
        locale={locale}
        priceContext={{
          label: "Caution requise",
          amount: depositAmount,
        }}
        bullets={["Remboursable", "Bloque votre place", "Déduite si vous gagnez"]}
      />
    );
  }

  // Registered but the auction hasn't opened yet → "you're in, opens in X".
  // (Gates above let a scheduled-auction user pay the deposit early.)
  if (isScheduled) {
    return (
      <PreBidGate
        tone="gold"
        icon={<Clock className="h-7 w-7" />}
        title="Vous êtes inscrit(e) ✓"
        body={`Votre place est réservée. L'enchère ouvre ${formatStartsIn(auction.starts_at)} — vous pourrez enchérir dès le démarrage.`}
        ctaLabel="Voir l'annonce"
        onCta={() => router.push(`/auctions/${auction.id}` as never)}
        auction={auction}
        totalBids={totalBids}
        locale={locale}
      />
    );
  }

  // All gates passed + live → type-specific composer
  return (
    <ActiveComposer
      auction={auction}
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
  const router = useRouter();
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--gold)]/40 bg-gradient-to-b from-[var(--gold)]/15 via-[var(--gold)]/5 to-transparent px-6 py-8 text-center">
      {/* Soft sparkle field behind the trophy — pure CSS, no deps,
          auto-runs once on mount via the keyframes in globals.css. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 batta-celebrate-burst"
      />

      <div className="relative mx-auto h-20 w-20">
        {/* Double-ping halo. The outer ring uses a slow ping with a
            delay so the two waves stagger and read as ambient pulse,
            not a frantic strobe. */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-[var(--gold)]/30 animate-ping"
        />
        <span
          aria-hidden
          className="absolute inset-2 rounded-full bg-[var(--gold)]/25 animate-ping [animation-delay:600ms]"
        />
        <div className="relative h-20 w-20 rounded-full bg-[var(--gold)] flex items-center justify-center shadow-[0_0_60px_rgba(30,58,138,0.55)] batta-celebrate-pop">
          <Trophy className="h-10 w-10 text-white" strokeWidth={2.2} />
        </div>
      </div>

      <div className="relative mt-5 text-[10px] font-extrabold uppercase tracking-[0.22em] text-[var(--gold)]">
        Bravo · vous êtes adjudicataire
      </div>
      <div className="batta-tabular relative mt-2 text-[34px] font-extrabold leading-none gradient-gold-text">
        {amount != null ? formatTND(amount, locale) : "—"}
      </div>
      <p className="relative mt-3 text-xs text-[var(--foreground-muted)] leading-relaxed max-w-[260px] mx-auto">
        Prochaine étape : signature chez le notaire. Vous recevrez les
        instructions par email.
      </p>

      <div className="relative mt-5 space-y-2">
        <Button
          size="md"
          fullWidth
          onClick={() =>
            router.push(
              { pathname: "/account/activity", query: { tab: "gagnees" } } as never,
            )
          }
        >
          <Trophy className="h-4 w-4" />
          Voir mes acquisitions
        </Button>
        <Button
          size="md"
          fullWidth
          variant="ghost"
          onClick={() => router.push("/account/payments" as never)}
        >
          Suivre le paiement
        </Button>
      </div>
    </div>
  );
}

function EndedBanner({
  auctionId,
  winnerAmount,
  locale,
}: {
  auctionId: string;
  winnerAmount: number | null;
  locale: string;
}) {
  const router = useRouter();
  return (
    <div className="space-y-5 py-6 text-center">
      <div className="mx-auto h-14 w-14 rounded-full bg-[var(--surface-2)] ring-1 ring-[var(--border)] text-[var(--foreground-muted)] flex items-center justify-center">
        <Lock className="h-6 w-6" strokeWidth={1.8} />
      </div>
      <div>
        <div className="text-lg font-extrabold">Enchère terminée</div>
        <p className="mt-2 text-xs text-[var(--foreground-muted)] leading-relaxed max-w-xs mx-auto">
          Les offres ne sont plus acceptées sur ce lot.
        </p>
      </div>

      {winnerAmount != null && (
        <div className="mx-auto max-w-[280px] rounded-xl bg-[var(--surface)] border border-[var(--border)] px-4 py-3 text-start">
          <div className="batta-eyebrow text-[9px]">Offre gagnante</div>
          <div className="batta-tabular mt-0.5 text-[18px] font-extrabold text-foreground">
            {formatTND(winnerAmount, locale)}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-[280px] flex items-start gap-2 rounded-xl bg-[var(--gold-faint)] border border-[var(--gold-soft)]/30 px-3.5 py-2.5 text-start">
        <Wallet className="size-4 shrink-0 text-[var(--gold)] mt-0.5" strokeWidth={2} />
        <div className="text-[11px] leading-snug text-[var(--foreground-muted)]">
          Votre caution sera remboursée sous 7 jours ouvrés sur votre méthode
          de paiement initiale.
        </div>
      </div>

      <div className="space-y-2 max-w-[280px] mx-auto">
        <Button
          size="md"
          fullWidth
          onClick={() => router.push("/properties" as never)}
        >
          Voir d&apos;autres enchères
        </Button>
        <Button
          size="md"
          fullWidth
          variant="ghost"
          onClick={() =>
            router.push(
              { pathname: "/account/activity", query: { tab: "terminees" } } as never,
            )
          }
        >
          Mes activités
        </Button>
      </div>

      {/* Hidden a11y label so screen readers know the auction id for
          this banner — visible UI no longer surfaces it because the
          auctionId-as-button-CTA wasn't useful. */}
      <span className="sr-only">Enchère {auctionId}</span>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════ */
/*  ACTIVE COMPOSER (English / Dutch / Sealed)                          */
/* ════════════════════════════════════════════════════════════════════ */

function ActiveComposer({
  auction,
  totalBids,
  locale,
}: {
  auction: AuctionWithProperty;
  totalBids: number;
  locale: string;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const isDutch = auction.type === "dutch";
  const isSealed = auction.type === "sealed";
  const isEnglish = auction.type === "english";
  const typeLabel = isEnglish ? "Anglaise" : isSealed ? "Cachetée" : "Hollandaise";

  // Live current price — for Dutch this ticks down every 10s; for
  // English/sealed it tracks the server's current_price.
  const [currentPrice, setCurrentPrice] = useState<number>(
    auction.current_price ?? auction.opening_price,
  );
  // Two floors, not one:
  //
  //   minNext     — what the INPUT auto-bumps to (and what the
  //                 +/- buttons clamp to). Always increment-based —
  //                 currentPrice + bidIncrement(). Drives the
  //                 "Minimum · incrément X" label, the +5% / +10%
  //                 presets, and the auto-bump effect that follows
  //                 the live price up. Self-raise users get the
  //                 same friendly suggestion as everyone else
  //                 instead of a +1-TND chase.
  //
  // (The DB place_bid RPC is the authority on the accepted minimum — for the
  // current top bidder it allows currentPrice + 1 TND; see migration 0046.
  // The client only needs to suggest minNext, so we don't recompute that
  // server-side floor here.)
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

  // Presence heartbeat lives in <AuctionPresencePing> (mounted by the bid
  // page), NOT here — having BidComposer ping too just doubled the
  // auction_presence write load on every bid-page viewer. One owner only.

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
  // Shared "last activity" timestamp — bumped by every realtime event
  // (UPDATE current_price or INSERT bid) AND by the polling fallback
  // when it detects a missed update. The poll loop reads this ref to
  // pick its next cadence: hot (1 s) while activity is fresh, cold
  // (4 s) once nothing has happened for 30 s. Cuts ~60% of poll
  // traffic on idle auctions without changing the live-bid feel.
  const lastActivityRef = useRef<number>(0);

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
          new: { current_price: number | null; status: string; ends_at: string | null };
        }) => {
          const next = payload.new;
          // Mark this auction as "hot" — the adaptive safety-net poll
          // downstream stays on its tighter cadence for the next 30 s.
          lastActivityRef.current = Date.now();
          // English / sealed: track the server's authoritative
          // current_price (already reflects proxy resolution + sealed
          // masking). Skip for Dutch — its ticker is the source of truth.
          if (!isDutch && next.current_price != null) {
            setCurrentPrice(Number(next.current_price));
          }
          // Anti-snipe extension OR terminal status: pull the latest
          // server render so the Countdown gets the new ends_at and the
          // page shape (ended banner, etc.) matches reality without a
          // manual refresh.
          if (
            (next.ends_at && next.ends_at !== auction.ends_at) ||
            next.status === "ended_sold" ||
            next.status === "ended_unsold" ||
            next.status === "awarded" ||
            next.status === "cancelled" ||
            next.status === "sixth_offer_window" ||
            next.status === "extending"
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
          lastActivityRef.current = Date.now();
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

  // Polling fallback — a SAFETY NET, not the live channel. Realtime
  // (the channel above) is the primary path: it pushes every price /
  // status / bid change instantly. This poll only exists to reconcile
  // the rare event Supabase Realtime drops. So the cadence is slow on
  // purpose — going faster just hammers the DB from every open browser
  // without improving the live feel (realtime already covers that).
  //
  // At tens of thousands of concurrent viewers, a 1 s poll meant ~Nk
  // direct DB queries/second per hot auction. These intervals collapse
  // that by ~7–30× while realtime keeps the UI instant.
  //
  //   HOT  (7 s)  — activity in the last 30 s. Tighter reconcile window
  //                 right after a bid, in case a realtime echo was lost.
  //   COLD (30 s) — quiet for 30 s. Idle auctions + background tabs.
  //
  // The hot/cold switch is driven by `lastActivityRef`, which the
  // realtime handlers above also bump.
  //
  // Pauses while the tab is hidden so we don't spam the DB for users
  // who tabbed away. Skipped for Dutch — its price is driven by the
  // local ticker, not the bids stream.
  useEffect(() => {
    if (isDutch) return;
    const supabase = getBrowserSupabase();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const HOT_INTERVAL_MS = 7_000;
    const COLD_INTERVAL_MS = 30_000;
    const HOT_WINDOW_MS = 30_000;

    function nextInterval(): number {
      const age = Date.now() - lastActivityRef.current;
      return age < HOT_WINDOW_MS ? HOT_INTERVAL_MS : COLD_INTERVAL_MS;
    }

    async function pollOnce() {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) {
        // Re-arm anyway — when the tab returns the visibility handler
        // fires pollOnce(), which restarts the chain.
        schedule();
        return;
      }
      try {
        const { data, error } = await supabase
          .from("auctions")
          .select("current_price, status, ends_at")
          .eq("id", auction.id)
          .maybeSingle();
        if (error || !data || cancelled) {
          schedule();
          return;
        }
        // Functional set: skip the update when nothing changed to avoid
        // a re-render on every poll. When something DID change, that's
        // either a missed realtime event or a fresh one — bump the
        // activity ref so the cadence stays hot.
        if (data.current_price != null) {
          setCurrentPrice((prev) => {
            const next = Number(data.current_price);
            if (next === prev) return prev;
            lastActivityRef.current = Date.now();
            return next;
          });
        }
        const s = data.status as string;
        const endsAtChanged =
          data.ends_at != null && data.ends_at !== auction.ends_at;
        if (
          endsAtChanged ||
          s === "ended_sold" ||
          s === "ended_unsold" ||
          s === "awarded" ||
          s === "cancelled" ||
          s === "sixth_offer_window" ||
          s === "extending"
        ) {
          router.refresh();
        }
      } catch {
        /* transient network blip — try again on the next tick */
      }
      schedule();
    }

    function schedule() {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(pollOnce, nextInterval());
    }

    pollOnce();
    function onVis() {
      if (!document.hidden) pollOnce();
    }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
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
    // Offline guard. The fetch() below would throw a generic
    // TypeError("Failed to fetch") on a dropped connection and the
    // user would see "Échec de l'enchère" with no hint that it was
    // the network. We surface the real cause before we even try.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast(
        "Pas de connexion — vérifiez votre réseau puis réessayez.",
        "warning",
      );
      return;
    }
    setSubmitting(true);
    startTransition(async () => {
      try {
        // Per-attempt timeout — without this a stalled connection
        // (mobile dead zone, ISP black-hole) leaves the button stuck
        // on "Envoi…" indefinitely while the user has no idea what
        // to do. 15 s is generous for a healthy network and short
        // enough that giving up + retrying still completes inside an
        // anti-snipe window.
        const REQUEST_TIMEOUT_MS = 15_000;
        const postBid = () => {
          const ctrl = new AbortController();
          const tid = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
          return fetch(`/api/auctions/${auction.id}/bid`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ amount: submitAmount }),
            signal: ctrl.signal,
          }).finally(() => clearTimeout(tid));
        };
        // One retry on a transient 5xx or network error. In the last
        // seconds of an English auction every lost click counts; a
        // single backoff doubles the success rate against gateway
        // hiccups without spamming the engine if it's truly down.
        let res: Response;
        try {
          res = await postBid();
          if (res.status >= 500) {
            await new Promise((r) => setTimeout(r, 350));
            res = await postBid();
          }
        } catch (e) {
          // Network-level failure OR our own AbortController firing on
          // the 15 s timeout. Either way: one retry, then surface a
          // distinct message for timeout so the user knows it's a
          // slow connection (not a server error).
          const wasTimeout = e instanceof DOMException && e.name === "AbortError";
          await new Promise((r) => setTimeout(r, 500));
          try {
            res = await postBid();
          } catch {
            toast(
              wasTimeout
                ? "La connexion est trop lente — réessayez quand votre réseau est stable."
                : "Connexion instable — votre offre n'a pas pu être envoyée.",
              "error",
            );
            return;
          }
        }
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
    <div className="space-y-3 lg:space-y-5">
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
              <span className="font-bold ms-3">
                {typeLabel}
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
            • <strong className="text-foreground">Caution :</strong> montant remboursable verrouillé par enchère, restitué après la clôture si vous ne gagnez pas.
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
            className="px-4 lg:px-6 bg-[var(--surface-2)] text-[var(--gold)] border-e border-[var(--border-strong)] hover:bg-[var(--gold-faint)] active:bg-[var(--gold-soft)]/40 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
          >
            <Minus className="h-4 w-4 lg:h-5 lg:w-5" strokeWidth={2.75} />
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
            className="px-4 lg:px-6 bg-[var(--surface-2)] text-[var(--gold)] border-s border-[var(--border-strong)] hover:bg-[var(--gold-faint)] active:bg-[var(--gold-soft)]/40 flex items-center justify-center transition-colors"
          >
            <Plus className="h-4 w-4 lg:h-5 lg:w-5" strokeWidth={2.75} />
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
                "h-8 lg:h-9 px-3 lg:px-4 rounded-full text-[11px] lg:text-[12px] font-bold batta-tabular transition-colors",
                amount === p.amount
                  ? "bg-[var(--gold)] text-white shadow-[var(--shadow-gold)]"
                  : "bg-white border border-[var(--border-strong)] text-foreground hover:border-[var(--gold)] hover:text-[var(--gold)]",
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
