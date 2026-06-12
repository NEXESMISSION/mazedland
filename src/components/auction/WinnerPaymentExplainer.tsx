import { CheckCircle2, XCircle, CalendarClock } from "lucide-react";
import { formatTND } from "@/lib/utils";

/**
 * "What happens now that you've won" — a clear, highlighted explainer shown to
 * the final winner who still owes the balance. Spells out the 14-day deadline,
 * the balance math (final price − caution already paid), and BOTH outcomes:
 * pay → the property is officially yours; don't pay → caution forfeited +
 * account banned. This removes the "wait, what do I do / what's at stake?"
 * confusion the bare "Payer le solde" button left.
 *
 * winnerBalance = what's still owed; caution = winnerAmount − winnerBalance.
 */
export function WinnerPaymentExplainer({
  winnerAmount,
  winnerBalance,
  finalPaymentDueAt,
  days,
  locale,
}: {
  winnerAmount: number;
  winnerBalance: number;
  finalPaymentDueAt: string | null;
  /** Admin-configured payment window in days (default 14). */
  days: number;
  locale: string;
}) {
  const caution = Math.max(0, winnerAmount - winnerBalance);
  const dueDate = finalPaymentDueAt
    ? new Date(finalPaymentDueAt).toLocaleDateString(locale, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="mt-3 rounded-2xl border border-[var(--border)] bg-surface p-4">
      <div className="flex items-center gap-2 text-[13px] font-extrabold text-foreground">
        <CalendarClock className="size-4 text-[var(--gold)]" strokeWidth={2.2} />
        Que se passe-t-il maintenant ?
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--foreground-muted)]">
        Vous êtes l&apos;adjudicataire. Il vous reste{" "}
        <span className="font-bold text-foreground">{days} jours</span> pour régler le solde
        {dueDate ? (
          <>
            {" "}— avant le <span className="font-bold text-foreground">{dueDate}</span>
          </>
        ) : null}
        .
      </p>

      {/* Balance math — final price − caution already locked = what's owed. */}
      <div className="mt-3 space-y-1.5 rounded-xl bg-[var(--surface-2)] p-3 text-[12px]">
        <Row label="Prix de vente final" value={`${formatTND(winnerAmount, locale)} TND`} />
        <Row label="Caution déjà versée" value={`− ${formatTND(caution, locale)} TND`} />
        <div className="mt-1 flex items-center justify-between border-t border-[var(--border)] pt-1.5">
          <span className="font-bold text-foreground">Reste à payer</span>
          <span className="batta-tabular font-extrabold text-[var(--gold)]">
            {formatTND(winnerBalance, locale)} TND
          </span>
        </div>
      </div>

      {/* Both outcomes, unmistakable. */}
      <div className="mt-3 space-y-2">
        <div className="flex items-start gap-2.5 rounded-xl bg-emerald-50 p-2.5 ring-1 ring-emerald-200">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" strokeWidth={2.4} />
          <span className="text-[12px] leading-snug text-emerald-900">
            <span className="font-bold">Si vous payez :</span> le bien devient
            officiellement le vôtre — signature de l&apos;acte chez le notaire.
          </span>
        </div>
        <div className="flex items-start gap-2.5 rounded-xl bg-red-50 p-2.5 ring-1 ring-red-200">
          <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" strokeWidth={2.4} />
          <span className="text-[12px] leading-snug text-red-900">
            <span className="font-bold">Si vous ne payez pas :</span> vous perdez votre
            caution ({formatTND(caution, locale)} TND) et votre compte est banni.
          </span>
        </div>
      </div>

      <p className="mt-2.5 text-[11px] leading-snug text-[var(--foreground-subtle)]">
        Ce mécanisme garantit le sérieux de chaque enchérisseur.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--foreground-muted)]">{label}</span>
      <span className="batta-tabular text-foreground">{value}</span>
    </div>
  );
}
