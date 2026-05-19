"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wallet, CheckCircle2, Loader2 } from "lucide-react";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { formatTND } from "@/lib/utils";
import { isValidIban, normalizeIban } from "@/lib/iban";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Maximum withdrawable amount, in TND. */
  available: number;
  locale: string;
}

const PAYOUT_ERROR_LABELS: Record<string, string> = {
  auth: "Vous devez vous reconnecter.",
  invalid_amount: "Montant invalide.",
  invalid_iban: "IBAN invalide.",
  insufficient_balance: "Solde insuffisant pour ce retrait.",
  cross_origin_blocked: "Origine non autorisée.",
};

function payoutErrorLabel(code: string | undefined): string {
  if (!code) return "La demande de retrait a échoué.";
  return PAYOUT_ERROR_LABELS[code] ?? code;
}

/**
 * Modal flow for a seller to request a payout against their available
 * balance. We snapshot the IBAN at request-time on the row — changing
 * the bank account later doesn't redirect an in-flight payout.
 */
export function PayoutRequestModal({ open, onClose, available, locale }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [amountStr, setAmountStr] = useState<string>(String(Math.floor(available)));
  const [iban, setIban] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const amount = (() => {
    const n = Number(amountStr);
    return Number.isFinite(n) ? n : 0;
  })();
  const amountValid = amount > 0 && amount <= available;
  // mod-97 checksum, not just length. Cuts down on payouts going
  // nowhere because of a transposed digit — the typo is caught
  // before the user even submits, with a clear error.
  const normalizedIban = normalizeIban(iban);
  const ibanValid = isValidIban(normalizedIban);
  // Show a "looks wrong" hint only after the user has typed enough
  // to make the verdict meaningful — avoids red text on every keystroke.
  const ibanShowError = normalizedIban.length >= 15 && !ibanValid;

  async function submit() {
    if (!amountValid || !ibanValid || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/seller/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, iban: normalizedIban }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(payoutErrorLabel(data.error), "error");
        setSubmitting(false);
        return;
      }
      toast(
        `Retrait demandé : ${formatTND(amount, locale)}. Traitement sous 2 à 5 jours ouvrés.`,
        "success",
      );
      router.refresh();
      onClose();
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Erreur réseau lors de la demande.",
        "error",
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Demande de retrait"
      description={`Solde disponible : ${formatTND(available, locale)}`}
    >
      <div className="space-y-5">
        {/* Amount input */}
        <div>
          <label className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--foreground-muted)]">
            Montant
          </label>
          <div className="mt-1.5 flex items-stretch h-12 rounded-[var(--radius)] overflow-hidden border border-[var(--border)] focus-within:border-[var(--gold)] transition-colors">
            <input
              type="text"
              inputMode="numeric"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value.replace(/\D/g, ""))}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 bg-transparent text-center text-xl font-extrabold batta-tabular focus:outline-none"
            />
            <span className="px-4 flex items-center bg-[var(--surface-2)] text-[11px] uppercase tracking-wider font-bold text-[var(--foreground-muted)]">
              TND
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px]">
            <button
              type="button"
              onClick={() => setAmountStr(String(Math.floor(available)))}
              className="text-[var(--gold)] hover:underline font-semibold"
            >
              Tout retirer
            </button>
            {amount > available && (
              <span className="text-[var(--danger)] font-semibold">
                Au-dessus du solde disponible
              </span>
            )}
          </div>
        </div>

        {/* IBAN input */}
        <div>
          <label className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--foreground-muted)]">
            IBAN (compte bancaire)
          </label>
          <input
            type="text"
            value={iban}
            onChange={(e) => setIban(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            placeholder="TN59 1000 6035 1832 5478 5689"
            className="mt-1.5 w-full h-12 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] px-4 text-[13px] font-mono focus:outline-none focus:border-[var(--gold)] transition-colors"
            maxLength={34}
            autoComplete="off"
          />
          {ibanShowError ? (
            <p className="mt-1.5 text-[11px] text-red-400">
              Cet IBAN n&apos;est pas valide — vérifiez les chiffres.
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] text-[var(--foreground-subtle)]">
              Votre IBAN tunisien (commence par TN, 24 caractères).
            </p>
          )}
        </div>

        {/* Disclosure */}
        <div className="rounded-[var(--radius)] bg-[var(--surface-2)] p-3 text-[11px] text-[var(--foreground-muted)] leading-relaxed">
          Les retraits sont traités en 2 à 5 jours ouvrés. Vous recevrez une
          confirmation par e-mail dès le virement émis.
        </div>
      </div>

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={onClose}>
          Annuler
        </Button>
        <Button
          size="md"
          onClick={submit}
          disabled={!amountValid || !ibanValid || submitting}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          {submitting ? "Envoi…" : `Demander ${formatTND(amount, locale)}`}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/* Wrapper button that owns the modal-open state — keeps the page server
 * component clean. */
export function PayoutRequestTrigger({
  available,
  locale,
  disabled,
}: {
  available: number;
  locale: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="md"
        onClick={() => setOpen(true)}
        disabled={disabled || available <= 0}
        className="lg:h-12 lg:rounded-full"
      >
        <Wallet className="h-4 w-4" />
        Demander un retrait
      </Button>
      <PayoutRequestModal
        open={open}
        onClose={() => setOpen(false)}
        available={available}
        locale={locale}
      />
    </>
  );
}
