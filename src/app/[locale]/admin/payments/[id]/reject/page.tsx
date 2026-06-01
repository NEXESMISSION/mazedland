import { notFound, redirect as nextRedirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { RejectPaymentForm } from "@/components/admin/RejectPaymentForm";
import { formatTND } from "@/lib/utils";
import Image from "next/image";
import {
  ArrowLeft, ShieldOff, Building2, Smartphone, FileText, ExternalLink,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const KIND_LABELS: Record<string, string> = {
  deposit_lock: "Caution",
  buy_now: "Achat direct",
  final_payment: "Paiement final",
  commission: "Commission",
  inspection_fee: "Frais d'inspection",
  subscription: "Abonnement",
  listing_fee: "Frais d'annonce",
};

/**
 * Dedicated reject surface for an admin receipt review. Parallels the
 * /admin/properties/<id>/reject page — full surface gives room for the
 * payment recap, receipt preview, common-reason chips, and a longer
 * motif than a tight modal allowed. The URL is shareable so a second
 * admin can take over a half-written rejection without losing context.
 */
export default async function RejectPaymentPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    nextRedirect(`/${locale}/login?next=/admin/payments/${id}/reject`);
  }

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user!.id).single();
  if (profile?.role !== "admin") notFound();

  const { data: payment } = await supabase
    .from("payments")
    .select(`
      id, kind, provider, amount, status, receipt_url, admin_notes,
      property:properties(id, title, governorate),
      buyer:profiles!payments_user_id_fkey(id, full_name, phone)
    `)
    .eq("id", id)
    .maybeSingle();

  if (!payment) notFound();

  if (payment.status === "captured" || payment.status === "failed" || payment.status === "refunded") {
    nextRedirect(`/${locale}/admin/payments?view=${payment.status === "captured" ? "captured" : "failed"}`);
  }

  const property = Array.isArray(payment.property) ? payment.property[0] : payment.property;
  const buyer = Array.isArray(payment.buyer) ? payment.buyer[0] : payment.buyer;

  // Generate a short-lived signed URL for the receipt so the admin can
  // inline-preview an image right on the reject form. The bucket policy
  // requires auth, so a raw URL would 401 the <img>.
  let signedReceiptUrl: string | null = null;
  let isPdf = false;
  if (payment.receipt_url) {
    const svc = getServiceSupabase();
    if (svc) {
      const { data: signed } = await svc.storage
        .from("receipts")
        .createSignedUrl(payment.receipt_url, 60 * 30);
      signedReceiptUrl = signed?.signedUrl ?? null;
      isPdf = payment.receipt_url.toLowerCase().endsWith(".pdf");
    }
  }

  const kindLabel = KIND_LABELS[payment.kind] ?? payment.kind;
  const ProviderIcon = payment.provider === "d17" ? Smartphone : Building2;
  const providerLabel = payment.provider === "d17" ? "D17 mobile" : "Virement";

  return (
    <div className="mx-auto max-w-2xl px-4 py-5 lg:py-8">
      <Link
        href={"/admin/payments?view=pending_review" as `/admin/payments${string}`}
        className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Retour à la file d'attente
      </Link>

      <header className="mt-3 flex items-start gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--accent-faint)] text-[var(--danger)] ring-1 ring-[var(--accent-soft)]">
          <ShieldOff className="size-5" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <span className="batta-eyebrow text-[10px] text-[var(--accent-deep)]">Refuser un reçu</span>
          <h1 className="mt-1 text-[22px] font-extrabold leading-tight tracking-tight">
            Motif du refus
          </h1>
          <p className="mt-1 text-[12.5px] text-muted">
            L'acheteur reçoit ce message en notification. Le lien renvoie
            vers la page de re-téléversement avec le motif affiché.
          </p>
        </div>
      </header>

      {/* Payment recap card — amount, kind, provider, buyer, property. */}
      <section className="mt-5 rounded-2xl bg-surface p-4 ring-1 ring-border">
        <div className="flex items-baseline justify-between gap-3">
          <span className="batta-eyebrow text-[10px] text-[var(--gold)]">{kindLabel}</span>
          <div className="batta-tabular text-[20px] font-extrabold text-[var(--gold)]">
            {formatTND(Number(payment.amount), locale)}
            <span className="ms-1 text-[10px] font-bold uppercase text-muted">TND</span>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-foreground/80">
          <ProviderIcon className="size-3.5" /> {providerLabel}
        </div>
        {buyer && (
          <div className="mt-2 text-[12px] text-muted">
            Acheteur : <span className="font-bold text-foreground">{buyer.full_name ?? "—"}</span>
            {buyer.phone && <span className="ms-1.5">· {buyer.phone}</span>}
          </div>
        )}
        {property && (
          <Link
            href={`/admin/properties/${property.id}` as `/admin/properties/${string}`}
            className="mt-2 flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-2 text-[12px] hover:bg-[var(--surface-3,#1a1a1a)]"
          >
            <span className="text-muted">Annonce :</span>
            <span className="line-clamp-1 flex-1 font-semibold">{property.title}</span>
            <ExternalLink className="size-3 text-muted" />
          </Link>
        )}
      </section>

      {/* Receipt preview — inline image, or open-PDF button. The admin
          needs to look at it while writing the motif, so it stays
          attached above the form rather than on a separate tab. */}
      {signedReceiptUrl && (
        <section className="mt-3">
          <p className="batta-eyebrow text-[10px]">Reçu téléversé</p>
          {isPdf ? (
            <a
              href={signedReceiptUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-[12.5px] font-semibold hover:border-[var(--gold-soft)]"
            >
              <FileText className="size-4 text-[var(--gold)]" />
              Ouvrir le PDF
              <ExternalLink className="size-3 text-muted" />
            </a>
          ) : (
            <div className="relative mt-1.5 aspect-video w-full overflow-hidden rounded-xl border border-border bg-surface-2">
              <Image
                src={signedReceiptUrl}
                alt="Reçu"
                fill
                sizes="(max-width: 768px) 100vw, 640px"
                className="object-contain"
                unoptimized
              />
            </div>
          )}
        </section>
      )}

      <div className="mt-5">
        <RejectPaymentForm paymentId={id} kind={payment.kind} />
      </div>
    </div>
  );
}
