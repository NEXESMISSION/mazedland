"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { Loader2, X, ArrowLeft } from "lucide-react";

// Receipt-specific rejection presets. Distinct from the property-side
// presets — these address what's wrong with the *justificatif*, not
// the listing. Each chip pre-fills the textarea; the admin can tweak
// the text before sending.
const PRESETS = [
  {
    label: "Reçu illisible / flou",
    text: "Le reçu fourni n'est pas lisible. Merci de reprendre une photo nette en plein jour, avec le montant, la date et la référence visibles, puis de le re-téléverser.",
  },
  {
    label: "Montant incorrect",
    text: "Le montant indiqué sur le reçu ne correspond pas au montant dû. Merci de vérifier la transaction puis de téléverser le justificatif correspondant au paiement attendu.",
  },
  {
    label: "Compte / RIB incorrect",
    text: "Le virement n'a pas été effectué vers le compte officiel de Batta. Merci de refaire le virement avec les coordonnées affichées sur la page de paiement et de téléverser le nouveau reçu.",
  },
  {
    label: "Référence manquante",
    text: "La référence de paiement n'apparaît pas sur le reçu. Merci d'ajouter le numéro de référence ou de fournir un justificatif où elle est visible.",
  },
  {
    label: "Capture d'écran insuffisante",
    text: "Une simple capture d'écran de l'application n'est pas un justificatif suffisant. Merci de fournir le reçu officiel de la banque (PDF) ou la confirmation d'opération signée.",
  },
  {
    label: "Reçu déjà utilisé",
    text: "Ce reçu a déjà été soumis pour un autre paiement et ne peut pas être réutilisé. Merci de fournir un justificatif distinct pour cette transaction.",
  },
];

export function RejectPaymentForm({
  paymentId,
  kind,
}: {
  paymentId: string;
  kind: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    const trimmed = reason.trim();
    if (trimmed.length < 5) {
      toast("Le motif doit faire au moins 5 caractères.", "error");
      return;
    }
    start(async () => {
      const res = await fetch(`/api/admin/payments/${paymentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict: "failed", notes: trimmed }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast(j.detail ?? j.error ?? `Échec (${res.status}).`, "error");
        return;
      }
      toast("Reçu refusé. L'acheteur a été notifié.", "warning");
      // Mirror the property-reject flow: keep the just-refused row
      // visible by landing on the "Refusés" view rather than bouncing
      // back to pending_review where it would disappear.
      router.replace("/admin/payments?view=failed");
    });
  }

  // Listing-fee receipts are rejected differently downstream (the RPC
  // reject_listing_payment also clears the listing flag). The form
  // shape is the same — we just want to surface a slightly different
  // note when the admin is dealing with a seller's listing fee vs a
  // buyer's deposit/buy-now receipt.
  const isListingFee = kind === "listing_fee";

  return (
    <div className="space-y-5">
      <section>
        <label className="batta-eyebrow text-[10px]">
          Motif <span className="text-red-400">*</span>
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex. Reçu illisible — reprenez une photo nette avec la référence visible."
          rows={6}
          maxLength={500}
          autoFocus
          className="mt-1.5 w-full rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-[13.5px] leading-relaxed text-foreground placeholder:text-muted focus:border-[var(--gold)] focus:outline-none focus:ring-1 focus:ring-[var(--gold)]/40"
        />
        <div className="mt-1 flex items-center justify-between text-[10px] text-muted">
          <span>
            {isListingFee
              ? "Le vendeur lit ce message et pourra renvoyer un nouveau reçu."
              : "L'acheteur lit ce message et pourra renvoyer un nouveau reçu."}
          </span>
          <span className="tabular-nums">{reason.length} / 500</span>
        </div>
      </section>

      <section>
        <h3 className="batta-eyebrow text-[10px]">Motifs fréquents</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setReason(p.text)}
              className="rounded-full bg-surface-2 px-3 py-1.5 text-[11.5px] font-semibold text-foreground/85 ring-1 ring-border transition hover:bg-[var(--surface-3,#1a1a1a)] hover:ring-[var(--gold)]/40"
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[10.5px] text-muted">
          Un clic remplace le texte. Vous pouvez ensuite l'éditer librement.
        </p>
      </section>

      <div className="sticky bottom-3 z-10 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link
          href={"/admin/payments?view=pending_review" as `/admin/payments${string}`}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-[var(--radius)] border border-border bg-surface-2 px-5 text-[13px] font-semibold text-foreground hover:bg-[var(--surface-3,#1a1a1a)]"
        >
          <ArrowLeft className="size-3.5" /> Annuler
        </Link>
        <button
          type="button"
          disabled={pending || reason.trim().length < 5}
          onClick={submit}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-[var(--radius)] bg-red-600 px-5 text-[13px] font-bold text-white shadow-[0_10px_30px_-12px_rgba(220,38,38,0.45)] transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" strokeWidth={2.5} />}
          Refuser et notifier
        </button>
      </div>
    </div>
  );
}
