"use client";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  Building2,
  Smartphone,
  Copy,
  Check,
  Upload,
  Loader2,
  ShieldCheck,
  ArrowRight,
  FileText,
  X,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { formatTND, cn } from "@/lib/utils";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { ProviderInstructions } from "@/lib/payments";
import type { PaymentProvider } from "@/lib/payments/types";
import type { CheckoutKind } from "./page";

interface Props {
  paymentId: string;
  kind: CheckoutKind;
  amount: number;
  auction: {
    id: string;
    title: string;
    governorate: string;
    heroPhotoPath: string | null;
  } | null;
  instructions: ProviderInstructions[];
  locale: string;
  /** True when re-uploading after a rejection (or a refresh). */
  reupload: boolean;
}

const KIND_TITLES: Record<CheckoutKind, { label: string; body: string }> = {
  deposit: {
    label: "Caution de participation",
    body:
      "10% du prix d'ouverture — remboursée sous 24 h si vous ne remportez pas l'enchère.",
  },
  buy_now: {
    label: "Achat",
    body: "Paiement plein de l'annonce — clôture immédiatement la vente.",
  },
  final_payment: {
    label: "Paiement final",
    body: "Solde du prix d'adjudication, déduction faite de la caution.",
  },
  listing_fee: {
    label: "Frais d'annonce",
    body:
      "Frais de publication + options choisies. Votre annonce passe en ligne dès validation du reçu.",
  },
};

const PROVIDER_ICONS: Record<PaymentProvider, typeof Building2> = {
  bank_transfer: Building2,
  d17: Smartphone,
};

const MAX_FILE_MB = 8;
const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
];

export function CheckoutClient({
  paymentId,
  kind,
  amount,
  auction,
  instructions,
  locale,
  reupload,
}: Props) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [provider, setProvider] = useState<PaymentProvider>(
    instructions[0]?.value ?? "bank_transfer",
  );
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const active = useMemo(
    () => instructions.find((p) => p.value === provider) ?? instructions[0],
    [provider, instructions],
  );
  const meta = KIND_TITLES[kind];

  async function copyValue(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(label);
      setTimeout(() => setCopiedField(null), 1400);
    } catch {
      toast("Impossible de copier.", "warning");
    }
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!ACCEPTED_TYPES.includes(f.type)) {
      toast("Formats acceptés : JPG, PNG, WebP, HEIC, PDF.", "error");
      return;
    }
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      toast(`Fichier trop volumineux (max ${MAX_FILE_MB} Mo).`, "error");
      return;
    }
    setFile(f);
  }

  async function submit() {
    if (!file || submitting) return;
    setSubmitting(true);
    try {
      const supabase = getBrowserSupabase();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        toast("Session expirée — reconnectez-vous.", "error");
        setSubmitting(false);
        return;
      }
      // Path under the receipts bucket — owner-scoped per RLS in
      // migration 0023.
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
      const safePid = paymentId.replace(/[^a-z0-9-]/gi, "");
      const path = `${auth.user.id}/${safePid}-${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("receipts")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        });
      if (upErr) {
        toast(`Échec du téléversement : ${upErr.message}`, "error");
        setSubmitting(false);
        return;
      }

      const res = await fetch(`/api/payments/${paymentId}/receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt_path: path, provider }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error ?? "Échec de la soumission.", "error");
        setSubmitting(false);
        return;
      }
      setSubmitted(true);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Erreur réseau.", "error");
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-background">
        <main className="max-w-2xl mx-auto px-4 lg:px-8 py-10 lg:py-16 text-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[var(--gold-faint)]">
            <Check className="h-8 w-8 text-[var(--gold)]" strokeWidth={2.5} />
          </div>
          <h1 className="mt-4 text-[22px] font-extrabold leading-tight">
            Reçu transmis
          </h1>
          <p className="mt-2 text-[13px] text-[var(--foreground-muted)] leading-relaxed max-w-md mx-auto">
            Notre équipe vérifie votre paiement sous 24 h. Vous recevrez
            une notification dès que le reçu est validé ou si une
            correction est nécessaire.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-2 justify-center">
            {auction && (
              <a
                href={`/${locale}/auctions/${auction.id}`}
                className="inline-flex h-11 items-center justify-center rounded-[var(--radius)] bg-[var(--surface-2)] border border-[var(--border)] px-5 text-[13px] font-semibold hover:border-[var(--gold-soft)]"
              >
                Retour à l&apos;annonce
              </a>
            )}
            <a
              href={`/${locale}`}
              className="inline-flex h-11 items-center justify-center rounded-[var(--radius)] bg-[var(--gold)] text-white px-5 text-[13px] font-bold hover:bg-[var(--gold-bright)]"
            >
              Accueil <ArrowRight className="ml-1.5 h-4 w-4" />
            </a>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="max-w-2xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-5">
        {/* Summary card */}
        <section className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
          {auction && (
            <div className="flex gap-3 p-3">
              <div className="relative h-20 w-20 shrink-0 rounded-xl overflow-hidden bg-[var(--surface-2)]">
                {auction.heroPhotoPath ? (
                  <Image
                    src={propertyPhotoUrl(auction.heroPhotoPath)}
                    alt={auction.title}
                    fill
                    sizes="80px"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-2xl text-foreground/15">
                    🏛️
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--gold)]">
                  {meta.label}
                </div>
                <h1 className="mt-0.5 text-[15px] font-bold leading-tight line-clamp-2">
                  {auction.title}
                </h1>
                <div className="mt-1 text-[11px] text-[var(--foreground-muted)]">
                  {auction.governorate}
                </div>
              </div>
            </div>
          )}
          <div className="border-t border-[var(--border)] bg-[var(--surface-2)]/40 px-4 py-3 flex items-baseline justify-between gap-3">
            <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--foreground-muted)]">
              Montant à payer
            </span>
            <span className="batta-tabular text-2xl font-extrabold text-[var(--gold)]">
              {formatTND(amount, locale)}
            </span>
          </div>
          <p className="px-4 pb-3 pt-2 text-[11px] text-[var(--foreground-muted)] leading-relaxed">
            {meta.body}
          </p>
        </section>

        {reupload && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2.5 text-[12px] text-red-900">
            Votre reçu précédent a été refusé. Vérifiez les détails ci-dessous
            et téléversez un nouveau justificatif.
          </div>
        )}

        {/* Provider tabs */}
        <section>
          <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--foreground-muted)] mb-2 inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3 w-3 text-[var(--gold)]" />
            Mode de paiement
          </div>
          <div className="grid grid-cols-2 gap-2">
            {instructions.map((p) => {
              const Icon = PROVIDER_ICONS[p.value];
              const isActive = provider === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setProvider(p.value)}
                  className={cn(
                    "rounded-xl border p-3 transition-colors flex items-center gap-2.5 text-start",
                    isActive
                      ? "border-[var(--gold)] bg-[var(--gold-faint)]"
                      : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--gold-soft)]",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      isActive
                        ? "bg-[var(--gold)] text-white"
                        : "bg-[var(--surface-2)] text-[var(--foreground-muted)]",
                    )}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold">{p.shortLabel}</div>
                    <div className="text-[10px] text-[var(--foreground-muted)] line-clamp-1">
                      {p.value === "bank_transfer" ? "RIB / IBAN" : "Mobile money"}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Instructions */}
        {active && (
          <section className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4 space-y-3">
            <div>
              <h2 className="text-[14px] font-bold">{active.label}</h2>
              <p className="mt-1 text-[12px] text-[var(--foreground-muted)] leading-relaxed">
                {active.description}
              </p>
            </div>
            <ol className="space-y-2.5">
              {active.fields.map((field) => (
                <li
                  key={field.label}
                  className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-2)]/60 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-[var(--foreground-muted)]">
                      {field.label}
                    </div>
                    <div
                      className={cn(
                        "mt-0.5 text-[13px] font-bold text-foreground break-words",
                        field.mono && "batta-tabular",
                      )}
                    >
                      {field.value}
                    </div>
                  </div>
                  {field.copyable && (
                    <button
                      type="button"
                      onClick={() => copyValue(field.label, field.value)}
                      className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-muted)] hover:border-[var(--gold-soft)] hover:text-[var(--gold)]"
                      aria-label={`Copier ${field.label}`}
                    >
                      {copiedField === field.label ? (
                        <Check className="h-3.5 w-3.5 text-[var(--gold)]" strokeWidth={2.5} />
                      ) : (
                        <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                      )}
                    </button>
                  )}
                </li>
              ))}
            </ol>
            <div className="rounded-lg bg-[var(--gold-faint)] px-3 py-2 text-[11.5px] text-[var(--gold-deep)] leading-relaxed">
              <strong className="font-bold">Étape suivante : </strong>
              {active.nextStep}
            </div>
          </section>
        )}

        {/* Receipt upload */}
        <section className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--foreground-muted)] mb-2 inline-flex items-center gap-1.5">
            <Upload className="h-3 w-3 text-[var(--gold)]" />
            Téléverser le reçu
          </div>
          {file ? (
            <div className="flex items-center gap-3 rounded-lg border border-[var(--gold-soft)] bg-[var(--gold-faint)]/40 p-3">
              <FileText className="h-5 w-5 text-[var(--gold)]" strokeWidth={2} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold truncate">{file.name}</div>
                <div className="text-[11px] text-[var(--foreground-muted)]">
                  {(file.size / 1024).toFixed(0)} Ko · {file.type.split("/")[1] ?? "fichier"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--foreground-muted)] hover:border-red-300 hover:text-red-600"
                aria-label="Retirer le fichier"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--border)] bg-[var(--surface-2)]/40 p-6 text-center cursor-pointer hover:border-[var(--gold-soft)] hover:bg-[var(--gold-faint)]/30 transition-colors">
              <Upload className="h-6 w-6 text-[var(--foreground-muted)]" strokeWidth={1.8} />
              <span className="text-[13px] font-semibold">
                Sélectionner une photo ou un PDF
              </span>
              <span className="text-[11px] text-[var(--foreground-muted)]">
                JPG · PNG · PDF · max {MAX_FILE_MB} Mo
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES.join(",")}
                onChange={onPickFile}
                className="sr-only"
              />
            </label>
          )}
        </section>

        {/* Submit */}
        <button
          type="button"
          onClick={submit}
          disabled={!file || submitting}
          className={cn(
            "block w-full rounded-[var(--radius)] h-12 font-bold text-[14px] inline-flex items-center justify-center gap-2 transition-all",
            !file || submitting
              ? "bg-[var(--surface-2)] text-[var(--foreground-muted)] cursor-not-allowed"
              : "bg-[var(--gold)] text-white hover:bg-[var(--gold-bright)] shadow-[var(--shadow-gold)]",
          )}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Envoi en cours…
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" strokeWidth={2.5} />
              Envoyer le reçu pour validation
            </>
          )}
        </button>

        <p className="text-center text-[11px] text-[var(--foreground-muted)] leading-relaxed">
          Délai de validation typique : moins de 24 h. Vous serez notifié(e)
          dès que l&apos;équipe Batta a vérifié votre paiement.
        </p>
      </main>
    </div>
  );
}
