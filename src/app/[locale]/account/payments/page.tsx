import { redirect, Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getLocale } from "next-intl/server";
import { formatTND } from "@/lib/utils";
import { Wallet, FileText, ArrowRight, ChevronRight } from "lucide-react";
import { FocusRowHighlight } from "@/components/ui/FocusRowHighlight";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const KIND_LABELS: Record<string, string> = {
  deposit_lock: "Caution de participation",
  buy_now: "Achat direct",
  final_payment: "Paiement final",
  commission: "Commission",
  inspection_fee: "Frais d'inspection",
  subscription: "Abonnement",
  deposit_release: "Remboursement de caution",
  listing_fee: "Frais d'annonce",
};

const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "En attente de reçu", tone: "bg-surface-2 text-muted ring-1 ring-border" },
  pending_review: { label: "Reçu en vérification", tone: "batta-tone-warn" },
  authorized: { label: "Autorisé", tone: "batta-tone-warn" },
  captured: { label: "Payé", tone: "batta-tone-ok" },
  refunded: { label: "Remboursé", tone: "bg-surface-2 text-muted ring-1 ring-border" },
  failed: { label: "Refusé", tone: "batta-tone-bad" },
  cancelled: { label: "Annulé", tone: "bg-surface-2 text-muted ring-1 ring-border" },
};

type Row = {
  id: string;
  kind: string;
  provider: string;
  amount: number;
  status: string;
  receipt_url: string | null;
  created_at: string;
  auction_id: string | null;
  property_id: string | null;
};

export default async function MyPaymentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const dateLocale = await getLocale();
  const supabase = await getServerSupabase();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale: locale as "ar" | "fr" | "en" });

  const { data } = await supabase
    .from("payments")
    .select("id, kind, provider, amount, status, receipt_url, created_at, auction_id, property_id")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const payments = (data ?? []) as Row[];

  // Sign receipts for the ones that have one (private bucket).
  const signed = new Map<string, string>();
  await Promise.all(
    payments
      .filter((p) => p.receipt_url)
      .map(async (p) => {
        const { data: s } = await supabase.storage
          .from("receipts")
          .createSignedUrl(p.receipt_url as string, 3600);
        if (s?.signedUrl) signed.set(p.id, s.signedUrl);
      }),
  );

  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 pt-4 pb-16 lg:max-w-[var(--max-w-content)]">
      <FocusRowHighlight idPrefix="pay-" />
      <span className="batta-eyebrow">Historique</span>
      <h1 className="mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight">
        Mes paiements
      </h1>
      <p className="mt-1.5 text-[12px] text-muted">
        Cautions, frais d&apos;annonce, achats et remboursements.
      </p>

      {payments.length === 0 ? (
        <div className="batta-frame-gold relative mt-6 px-6 py-10 text-center">
          <Wallet className="mx-auto size-8 text-gold" strokeWidth={2} />
          <p className="mt-3 text-[13px] text-muted">Aucun paiement pour le moment.</p>
          <Link
            href="/properties"
            className="batta-btn-luxe tap-target mt-5 inline-flex px-5 py-2.5 text-[12.5px]"
          >
            Parcourir les enchères
          </Link>
        </div>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {payments.map((p) => {
            const st = STATUS[p.status] ?? { label: p.status, tone: "bg-surface-2 text-muted ring-1 ring-border" };
            const canResume = p.status === "pending" || p.status === "pending_review";
            const entityHref = p.auction_id
              ? (`/auctions/${p.auction_id}` as `/auctions/${string}`)
              : null;
            const receipt = signed.get(p.id);
            return (
              <li
                key={p.id}
                id={`pay-${p.id}`}
                className="overflow-hidden rounded-xl bg-surface ring-1 ring-border"
              >
                <div className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-gold">
                      {KIND_LABELS[p.kind] ?? p.kind}
                    </div>
                    <div className="batta-tabular mt-1 text-[18px] font-extrabold text-foreground">
                      {formatTND(Number(p.amount), dateLocale)}{" "}
                      <span className="text-[10px] font-bold uppercase text-muted">TND</span>
                    </div>
                    <div className="mt-1 text-[11px] text-muted">
                      {new Date(p.created_at).toLocaleDateString(dateLocale, {
                        day: "2-digit", month: "short", year: "numeric",
                      })}
                      {" · "}
                      {p.provider === "d17" ? "D17" : p.provider === "bank_transfer" ? "Virement" : p.provider}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.14em] ${st.tone}`}>
                    {st.label}
                  </span>
                </div>

                {(canResume || receipt || entityHref) && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
                    {canResume && (
                      <Link
                        href={`/payment/checkout?payment=${p.id}` as `/payment/checkout`}
                        className="batta-gold-fill tap-target inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.12em] shadow-[var(--shadow-gold)]"
                      >
                        {p.status === "pending" ? "Téléverser le reçu" : "Voir le reçu"}
                        <ArrowRight className="size-3" strokeWidth={2.5} />
                      </Link>
                    )}
                    {receipt && (
                      <a
                        href={receipt}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tap-target inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[11px] font-semibold text-foreground hover:border-gold-soft/50"
                      >
                        <FileText className="size-3 text-gold" strokeWidth={2} />
                        Reçu
                      </a>
                    )}
                    {entityHref && (
                      <Link
                        href={entityHref}
                        className="tap-target ms-auto inline-flex items-center gap-1 text-[11px] font-bold text-muted hover:text-gold-bright"
                      >
                        Voir l&apos;annonce
                        <ChevronRight className="size-3.5" />
                      </Link>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
