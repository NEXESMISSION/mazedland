import { Link } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { XCircle, ArrowLeft, LifeBuoy } from "lucide-react";
import { formatTND } from "@/lib/utils";

export const dynamic = "force-dynamic";

const FAIL_REASONS: Record<string, string> = {
  insufficient_funds: "Solde insuffisant sur le compte ou la carte.",
  card_declined: "Votre banque a refusé la transaction.",
  expired: "Le délai de paiement a expiré.",
  cancelled: "Vous avez annulé le paiement.",
  network: "Problème de connexion avec la passerelle.",
  unknown: "La passerelle a refusé la transaction sans détail.",
};

/**
 * Post-payment failure page. Shows the reason (if the provider passed
 * one through the failUrl) and offers retry + support CTAs. Pulls the
 * payment row so support can quickly trace the failed reference.
 */
export default async function PaymentFailed({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; reason?: string; return?: string }>;
}) {
  const { id, reason, return: returnUrl } = await searchParams;
  const locale = await getLocale();
  const safeReturn = returnUrl && returnUrl.startsWith("/") ? returnUrl : "/";

  let payment: {
    id: string;
    amount: number;
    kind: string;
    auction_id: string | null;
  } | null = null;
  if (id) {
    const supabase = await getServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase
        .from("payments")
        .select("id, amount, kind, auction_id")
        .eq("id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      payment = data as typeof payment;
    }
  }

  const reasonText = (reason && FAIL_REASONS[reason]) ?? FAIL_REASONS.unknown;

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-7 text-center shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
        <div className="mx-auto h-16 w-16 rounded-full bg-red-500/15 ring-1 ring-red-500/30 flex items-center justify-center">
          <XCircle className="h-9 w-9 text-red-300" strokeWidth={2.2} />
        </div>

        <div className="mt-5 text-[10px] uppercase tracking-[0.18em] font-extrabold text-[var(--danger)]">
          Paiement refusé
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">
          La transaction n&apos;a pas abouti
        </h1>
        <p className="mt-2 text-sm text-[var(--foreground-muted)] leading-relaxed">
          {reasonText}
        </p>

        {payment && (
          <dl className="mt-6 space-y-2 rounded-[var(--radius)] bg-[var(--surface-2)] p-4 text-start">
            <div className="flex items-center justify-between text-[12px]">
              <dt className="text-[10px] uppercase tracking-[0.14em] font-bold text-[var(--foreground-muted)]">
                Montant tenté
              </dt>
              <dd className="batta-tabular font-bold text-foreground">
                {formatTND(Number(payment.amount), locale)} TND
              </dd>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <dt className="text-[10px] uppercase tracking-[0.14em] font-bold text-[var(--foreground-muted)]">
                Référence
              </dt>
              <dd className="font-mono text-[11px] text-foreground">
                {payment.id.slice(0, 8)}…{payment.id.slice(-4)}
              </dd>
            </div>
            <p className="pt-2 text-[10px] text-[var(--foreground-subtle)] leading-relaxed">
              Aucun débit n&apos;a été effectué sur votre compte. Vous pouvez
              réessayer immédiatement.
            </p>
          </dl>
        )}

        <div className="mt-6 space-y-2">
          <Link
            href={safeReturn as `/${string}`}
            className="inline-flex items-center justify-center gap-2 w-full h-12 rounded-[var(--radius)] bg-gradient-to-b from-[var(--gold-bright)] to-[var(--gold)] text-black font-bold text-[14px] shadow-[var(--shadow-gold)] active:scale-[0.99] transition-all"
          >
            <ArrowLeft className="h-4 w-4" />
            Réessayer
          </Link>
          <Link
            href="/contact"
            className="inline-flex items-center justify-center gap-2 w-full h-12 rounded-[var(--radius)] bg-[var(--surface-2)] border border-[var(--border)] text-foreground font-semibold text-[13px] hover:border-[var(--gold-soft)] transition-colors"
          >
            <LifeBuoy className="h-4 w-4" />
            Contacter le support
          </Link>
        </div>
      </div>
    </div>
  );
}
