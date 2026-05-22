"use client";

import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import {
  Trophy,
  Heart,
  XCircle,
  Hourglass,
  Wallet,
  ArrowRight,
} from "lucide-react";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { formatTND } from "@/lib/utils";
import type { AuctionWithProperty } from "@/lib/types";

interface Props {
  auction: AuctionWithProperty;
  userId: string | null | undefined;
  locale: string;
}

type Outcome =
  | { kind: "winner"; finalPrice: number }
  | { kind: "outbid"; winningPrice: number | null }
  | { kind: "sixth_offer_window"; winningPrice: number; deadline: string }
  | { kind: "cancelled" };

// Final-state set for Batta. `sixth_offer_window` is final from the
// composer's POV — the user can't place a regular bid anymore; they'd
// need the dedicated 1/6 form on the detail page.
const FINAL_STATES = new Set([
  "ended_sold",
  "ended_unsold",
  "cancelled",
  "sixth_offer_window",
  "awarded",
]);

/**
 * Pops once when an auction the user participated in reaches a final
 * state — either on initial load (navigated to a freshly-ended auction)
 * or mid-session via the auction prop changing after a router.refresh().
 * Per-user-per-auction "seen" flag in localStorage so we don't re-pop on
 * every reload.
 */
export function AuctionEndModal({ auction, userId, locale }: Props) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!userId) return;
    if (!FINAL_STATES.has(auction.status)) return;

    const seenKey = `auction-end-seen:${auction.id}:${userId}`;
    if (typeof window !== "undefined" && localStorage.getItem(seenKey)) return;

    let cancelled = false;
    (async () => {
      const supabase = getBrowserSupabase();

      // Only pop for users who actually placed at least one bid. Spectators
      // who happened to load the page shouldn't see a "you lost" modal.
      const { count } = await supabase
        .from("bids")
        .select("id", { count: "exact", head: true })
        .eq("auction_id", auction.id)
        .eq("bidder_id", userId);
      if ((count ?? 0) === 0) return;
      if (cancelled) return;

      if (auction.status === "cancelled") {
        setOutcome({ kind: "cancelled" });
      } else if (
        auction.status === "sixth_offer_window" &&
        auction.winner_amount &&
        auction.sixth_offer_deadline
      ) {
        setOutcome({
          kind: "sixth_offer_window",
          winningPrice: Number(auction.winner_amount),
          deadline: auction.sixth_offer_deadline,
        });
      } else if (auction.winner_user_id === userId) {
        setOutcome({
          kind: "winner",
          finalPrice: Number(auction.winner_amount ?? auction.current_price ?? 0),
        });
      } else {
        setOutcome({
          kind: "outbid",
          winningPrice: auction.winner_amount ? Number(auction.winner_amount) : null,
        });
      }
      setOpen(true);
      try {
        localStorage.setItem(seenKey, String(Date.now()));
      } catch {
        /* private-mode storage may throw — silently ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    auction.id,
    auction.status,
    auction.winner_user_id,
    auction.winner_amount,
    auction.current_price,
    auction.sixth_offer_deadline,
    userId,
  ]);

  if (!outcome) return null;

  const view = (() => {
    switch (outcome.kind) {
      case "winner":
        return {
          icon: (
            <div className="relative h-20 w-20 mx-auto">
              <div className="absolute inset-0 rounded-full bg-[var(--gold-faint)] animate-ping" />
              <div className="relative h-20 w-20 rounded-full bg-[var(--gold)] flex items-center justify-center shadow-[var(--shadow-gold)]">
                <Trophy className="h-10 w-10 text-white" />
              </div>
            </div>
          ),
          title: "Adjugé · vous avez gagné",
          body: `Votre offre gagnante : ${formatTND(outcome.finalPrice, locale)}. Prochaine étape : signature de l'acte chez le notaire dans les délais légaux.`,
          primary: (
            <Link
              href={{ pathname: "/account/activity", query: { tab: "gagnees" } }}
              className="block"
            >
              <Button size="md" fullWidth>
                <Trophy className="h-4 w-4" />
                Mes acquisitions
              </Button>
            </Link>
          ),
        };
      case "outbid":
        return {
          icon: (
            <div className="h-20 w-20 mx-auto rounded-full bg-[var(--surface-2)] flex items-center justify-center text-[var(--foreground-muted)]">
              <Heart className="h-10 w-10" />
            </div>
          ),
          title: "Cette enchère est terminée",
          body: outcome.winningPrice
            ? `L'offre gagnante était de ${formatTND(outcome.winningPrice, locale)}. Votre caution vous sera remboursée après la clôture.`
            : "Votre caution vous sera remboursée après la clôture. Bonne chance pour la prochaine.",
          primary: (
            <Link href="/properties" className="block">
              <Button size="md" fullWidth>
                <ArrowRight className="h-4 w-4" />
                Autres enchères
              </Button>
            </Link>
          ),
        };
      case "sixth_offer_window":
        return {
          icon: (
            <div className="h-20 w-20 mx-auto rounded-full bg-amber-500/15 flex items-center justify-center text-amber-400">
              <Hourglass className="h-10 w-10" />
            </div>
          ),
          title: "Fenêtre de surenchère du 1/6 ouverte",
          body: `Adjudication provisoire à ${formatTND(outcome.winningPrice, locale)}. Vous pouvez déposer une surenchère légale jusqu'au ${new Date(outcome.deadline).toLocaleDateString("fr-FR")} (+1/6 minimum).`,
          primary: (
            <Button size="md" fullWidth onClick={() => setOpen(false)}>
              <Wallet className="h-4 w-4" />
              Voir le formulaire
            </Button>
          ),
        };
      case "cancelled":
        return {
          icon: (
            <div className="h-20 w-20 mx-auto rounded-full bg-red-500/15 flex items-center justify-center text-[var(--danger)]">
              <XCircle className="h-10 w-10" />
            </div>
          ),
          title: "Enchère annulée",
          body: "L'enchère a été annulée par le vendeur ou l'administration. Votre caution sera remboursée intégralement.",
          primary: (
            <Link href="/properties" className="block">
              <Button size="md" fullWidth>
                Autres enchères
              </Button>
            </Link>
          ),
        };
    }
  })();

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="">
      <div className="text-center space-y-4 py-2">
        {view.icon}
        <div>
          <h2 className="text-xl font-extrabold">{view.title}</h2>
          <p className="text-sm text-[var(--foreground-muted)] mt-2 leading-relaxed">
            {view.body}
          </p>
        </div>
      </div>
      <ModalFooter>
        <Button variant="ghost" size="md" onClick={() => setOpen(false)}>
          Fermer
        </Button>
        {view.primary}
      </ModalFooter>
    </Modal>
  );
}
