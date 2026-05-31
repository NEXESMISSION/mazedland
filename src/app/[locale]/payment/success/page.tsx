import { redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatTND } from "@/lib/utils";
import { CheckCircle2, ArrowRight, Loader2 } from "lucide-react";
import { SuccessAutoRedirect } from "./SuccessAutoRedirect";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  deposit_lock: "Caution verrouillée",
  buy_now: "Achat finalisé",
  final_payment: "Paiement final reçu",
  inspection_fee: "Inspection payée",
  commission: "Commission acquittée",
  subscription: "Abonnement activé",
};

const KIND_SUBLABEL: Record<string, string> = {
  deposit_lock: "Vous pouvez maintenant enchérir sur cette enchère.",
  buy_now: "L'enchère est clôturée — vous êtes l'adjudicataire.",
  final_payment: "Le bien est à vous — signature notariale à venir.",
  inspection_fee: "L'inspecteur a été notifié.",
  commission: "Merci pour votre participation.",
  subscription: "Votre abonnement est actif.",
};

/**
 * Post-payment confirmation page. Shows the transaction summary and
 * auto-redirects to the return URL passed by the initiating endpoint
 * (auction page, bid page, sell dashboard, etc.).
 *
 * The page is server-side so the TX details are loaded with no client
 * round-trip. The auto-redirect is a small client component that fires
 * after 1.8s — fast enough to feel snappy, slow enough to read.
 */
export default async function PaymentSuccess({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; return?: string }>;
}) {
  const { id, return: returnUrl } = await searchParams;
  const locale = await getLocale();
  const safeReturn = returnUrl && returnUrl.startsWith("/") ? returnUrl : "/";

  // No id → bare success state (rare, but possible if a webhook lands
  // and the user followed a return URL that didn't carry the id).
  if (!id) {
    return (
      <SuccessShell
        title="Paiement reçu"
        body="Nous avons enregistré votre paiement. Vous serez notifié dès que tout est confirmé."
        returnUrl={safeReturn}
      />
    );
  }

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    // Anonymous landing on /payment/success — sketchy but not necessarily
    // wrong (provider redirected with stale session). Bounce to /login
    // with the return URL preserved so the user lands back here after
    // signing in.
    redirect(`/${locale}/login?next=/payment/success?id=${id}`);
  }

  const { data: payment } = await supabase
    .from("payments")
    .select("id, kind, amount, status, currency, created_at, auction_id")
    .eq("id", id)
    .maybeSingle();

  if (!payment) {
    return (
      <SuccessShell
        title="Reçu introuvable"
        body="Nous n'avons pas trouvé ce paiement. Si la somme a été débitée, contactez le support avec le numéro de référence ci-dessus."
        returnUrl={safeReturn}
        id={id}
      />
    );
  }

  const kindLabel = KIND_LABEL[payment.kind as string] ?? "Paiement reçu";
  const subLabel =
    KIND_SUBLABEL[payment.kind as string] ??
    "Nous avons enregistré votre paiement.";
  const isCaptured = payment.status === "captured";

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-var(--desktop-nav-h))] w-full max-w-md flex-col items-center justify-center px-4 py-10">
      <SuccessAutoRedirect to={safeReturn} delayMs={1800} enabled={isCaptured} />
      <div className="w-full rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-7 text-center shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
        {/* Big tick */}
        <div className="relative mx-auto h-16 w-16">
          {isCaptured && (
            <div
              className="absolute inset-0 rounded-full bg-emerald-500/30 animate-ping"
              aria-hidden
            />
          )}
          <div
            className={`relative h-16 w-16 rounded-full flex items-center justify-center ${
              isCaptured
                ? "bg-emerald-500 text-white shadow-[0_0_30px_rgba(16,185,129,0.4)]"
                : "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40"
            }`}
          >
            {isCaptured ? (
              <CheckCircle2 className="h-9 w-9" strokeWidth={2.2} />
            ) : (
              <Loader2 className="h-7 w-7 animate-spin" />
            )}
          </div>
        </div>

        <div className="mt-5 text-[10px] uppercase tracking-[0.18em] font-extrabold text-[var(--gold)]">
          {isCaptured ? "Paiement confirmé" : "En attente de confirmation"}
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">
          {kindLabel}
        </h1>
        <p className="mt-2 text-sm text-[var(--foreground-muted)] leading-relaxed">
          {subLabel}
        </p>

        {/* TX details */}
        <dl className="mt-6 space-y-2 rounded-[var(--radius)] bg-[var(--surface-2)] p-4 text-start">
          <Row label="Montant">
            <span className="batta-tabular font-bold gradient-gold-text">
              {formatTND(Number(payment.amount), locale)} {payment.currency}
            </span>
          </Row>
          <Row label="Référence">
            <span className="font-mono text-[11px] text-foreground">
              {payment.id.slice(0, 8)}…{payment.id.slice(-4)}
            </span>
          </Row>
          <Row label="Date">
            <span className="font-mono text-[11px] text-foreground">
              {new Date(payment.created_at).toLocaleString("fr-FR", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </Row>
          <Row label="Statut">
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                isCaptured
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-amber-500/15 text-amber-300"
              }`}
            >
              {payment.status}
            </span>
          </Row>
        </dl>

        {/* Auto-redirect notice + manual CTA */}
        {isCaptured ? (
          <>
            <p className="mt-5 text-[11px] text-[var(--foreground-subtle)] inline-flex items-center justify-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Redirection automatique…
            </p>
            <Link
              href={safeReturn as `/${string}`}
              className="mt-3 inline-flex items-center justify-center gap-2 w-full h-12 rounded-[var(--radius)] bg-gradient-to-b from-[var(--gold-bright)] to-[var(--gold)] text-black font-bold text-[14px] shadow-[var(--shadow-gold)] active:scale-[0.99] transition-all"
            >
              Continuer
              <ArrowRight className="h-4 w-4" />
            </Link>
          </>
        ) : (
          <Link
            href={safeReturn as `/${string}`}
            className="mt-5 inline-flex items-center justify-center gap-2 w-full h-12 rounded-[var(--radius)] bg-[var(--surface-2)] border border-[var(--border)] text-foreground font-semibold text-[14px] hover:border-[var(--gold-soft)] transition-colors"
          >
            Retour
          </Link>
        )}
      </div>
    </div>
  );
}

function SuccessShell({
  title,
  body,
  returnUrl,
  id,
}: {
  title: string;
  body: string;
  returnUrl: string;
  id?: string;
}) {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-var(--desktop-nav-h))] w-full max-w-md flex-col items-center justify-center px-4 py-10">
      <div className="w-full rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-7 text-center">
        <div className="mx-auto h-14 w-14 rounded-full bg-[var(--gold-faint)] flex items-center justify-center">
          <CheckCircle2 className="h-7 w-7 text-[var(--gold)]" />
        </div>
        <h1 className="mt-4 text-xl font-extrabold">{title}</h1>
        <p className="mt-2 text-sm text-[var(--foreground-muted)]">{body}</p>
        {id && (
          <p className="mt-3 font-mono text-[10px] text-[var(--foreground-subtle)]">
            Réf · {id}
          </p>
        )}
        <Link
          href={returnUrl as `/${string}`}
          className="mt-5 inline-flex items-center justify-center gap-2 w-full h-11 rounded-[var(--radius)] bg-[var(--surface-2)] border border-[var(--border)] text-foreground font-semibold text-[13px] hover:border-[var(--gold-soft)] transition-colors"
        >
          Retour
        </Link>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <dt className="text-[10px] uppercase tracking-[0.14em] font-bold text-[var(--foreground-muted)]">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}
