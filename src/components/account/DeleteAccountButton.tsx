"use client";

import { useState, useTransition } from "react";
import { useLocale } from "next-intl";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { Trash2, AlertTriangle } from "lucide-react";

/**
 * Account self-deletion (GDPR erasure). Two-step + typed confirmation so a
 * destructive, irreversible action can't be a single accidental tap.
 *
 * Server side (POST /api/account/delete) refuses while money is in flight
 * and returns { blockers } — we surface each as a toast so the user knows
 * exactly what to settle first (prefer toasts over inline error blocks).
 */
const BLOCKER_FR: Record<string, string> = {
  active_listings:
    "Vous avez une annonce en cours d'enchère. Attendez sa clôture avant de supprimer votre compte.",
  unpaid_win:
    "Vous avez une enchère remportée non réglée. Réglez le solde avant de supprimer votre compte.",
  pending_payments:
    "Un paiement est en cours de vérification. Attendez sa validation avant de supprimer votre compte.",
  pending_payout:
    "Un virement de vos gains est en cours. Attendez son règlement avant de supprimer votre compte.",
};

const CONFIRM_WORD = "SUPPRIMER";

export function DeleteAccountButton({ label }: { label: string }) {
  const locale = useLocale();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pending, start] = useTransition();

  function onDelete() {
    if (confirmText.trim().toUpperCase() !== CONFIRM_WORD) return;
    start(async () => {
      try {
        const res = await fetch("/api/account/delete", {
          method: "POST",
          headers: { Accept: "application/json" },
        });

        if (res.status === 409) {
          const body = (await res.json().catch(() => ({}))) as {
            blockers?: string[];
          };
          const blockers = body.blockers ?? [];
          if (blockers.length === 0) {
            toast("Suppression impossible pour le moment.", "warning");
          } else {
            blockers.forEach((b) =>
              toast(BLOCKER_FR[b] ?? "Une opération est encore en cours.", "warning"),
            );
          }
          return;
        }

        if (!res.ok) {
          toast("La suppression a échoué. Réessayez plus tard.", "error");
          return;
        }

        // Success — drop any local auth/KYC state and hard-navigate home.
        try {
          sessionStorage.removeItem("batta_kyc_draft");
        } catch {
          /* sessionStorage unavailable */
        }
        try {
          await getBrowserSupabase().auth.signOut();
        } catch {
          /* already signed out server-side */
        }
        toast("Votre compte a été supprimé.", "success");
        window.location.assign(`/${locale}`);
      } catch {
        toast("La suppression a échoué. Vérifiez votre connexion.", "error");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tap-target w-full px-5 py-3 text-[13px] font-semibold text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded-xl transition-colors inline-flex items-center justify-center gap-2"
      >
        <Trash2 className="size-4" strokeWidth={2} />
        {label}
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--danger)]/40 bg-[var(--danger)]/[0.06] p-4">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="size-5 shrink-0 text-[var(--danger)]" strokeWidth={2} />
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-foreground">
            Supprimer définitivement votre compte ?
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            Cette action est irréversible. Vos données personnelles et vos pièces
            d&apos;identité seront effacées. Tapez{" "}
            <span className="font-bold text-[var(--danger)]">{CONFIRM_WORD}</span> pour
            confirmer.
          </p>
        </div>
      </div>

      <input
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder={CONFIRM_WORD}
        autoComplete="off"
        autoCapitalize="characters"
        className="mt-3 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[14px] text-foreground outline-none focus:border-[var(--danger)]"
      />

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setConfirmText("");
          }}
          disabled={pending}
          className="batta-btn-ghost-gold tap-target flex-1 px-4 py-2.5 text-[13px] disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending || confirmText.trim().toUpperCase() !== CONFIRM_WORD}
          className="tap-target flex-1 rounded-xl bg-[var(--danger)] px-4 py-2.5 text-[13px] font-bold text-white transition-opacity disabled:opacity-40"
        >
          {pending ? "Suppression…" : "Supprimer"}
        </button>
      </div>
    </div>
  );
}
