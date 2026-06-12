"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import {
  Building2,
  Smartphone,
  Copy,
  Check,
  Upload,
  Loader2,
  ArrowRight,
  AlertCircle,
  FileText,
  X,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { formatTND, cn } from "@/lib/utils";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { propertyPhotoUrl, isStaticSeedPath } from "@/lib/imageUrl";
import { compressImage } from "@/lib/imageCompress";
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
  /** When set (listing-fee payments), shows a "Modifier l'annonce" link so the
   *  seller can go back and fix the listing before paying. Full locale-prefixed
   *  href to the edit page (which returns here after saving). */
  editHref?: string;
}

const KIND_TITLES: Record<CheckoutKind, { label: string; body: string }> = {
  deposit: {
    label: "Caution de participation",
    body:
      "Caution remboursable — déduite du prix final si vous gagnez, restituée après la clôture sinon.",
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

// 25 MB raw → modern iPhone photos can be 12-20 MB before compression.
// Images get compressed client-side before upload (final upload typically
// 200-600 KB). PDFs pass through unchanged and the limit is the cap.
const MAX_FILE_MB = 25;
const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
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
  editHref,
}: Props) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [provider, setProvider] = useState<PaymentProvider>(
    instructions[0]?.value ?? "bank_transfer",
  );
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const MAX_RECEIPTS = 3;
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  async function cancelPayment() {
    if (cancelling) return;
    const ok = window.confirm(
      "Annuler ce paiement ? Vous pourrez en démarrer un nouveau à tout moment.",
    );
    if (!ok) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/payments/${paymentId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        toast(data.detail ?? data.error ?? "Annulation impossible.", "error");
        setCancelling(false);
        return;
      }
      setCancelled(true);
    } catch {
      toast("Erreur réseau lors de l'annulation.", "error");
      setCancelling(false);
    }
  }

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
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    const remaining = MAX_RECEIPTS - files.length;
    if (remaining <= 0) {
      toast(`Maximum ${MAX_RECEIPTS} images.`, "warning");
      return;
    }
    const accepted: File[] = [];
    for (const f of picked) {
      if (accepted.length >= remaining) {
        toast(`Maximum ${MAX_RECEIPTS} images — fichiers en trop ignorés.`, "warning");
        break;
      }
      // Some mobile pickers report empty `type` for HEIC files — fall back to
      // extension matching so we don't reject a legitimate photo.
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      const looksImage =
        f.type.startsWith("image/") ||
        ["jpg", "jpeg", "png", "webp", "avif", "heic", "heif"].includes(ext);
      const looksPdf = f.type === "application/pdf" || ext === "pdf";
      if (!looksImage && !looksPdf && !ACCEPTED_TYPES.includes(f.type)) {
        toast(`${f.name} : format non accepté (JPG, PNG, WebP, HEIC, PDF).`, "error");
        continue;
      }
      if (f.size > MAX_FILE_MB * 1024 * 1024) {
        toast(`${f.name} : trop volumineux (max ${MAX_FILE_MB} Mo).`, "error");
        continue;
      }
      accepted.push(f);
    }
    if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted]);
    // Reset so the same file can be re-picked after a removal.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submit() {
    if (files.length === 0 || submitting) return;
    setSubmitting(true);
    // Track every object we put in the bucket this attempt so we can clean them
    // ALL up if a later upload or the attach call fails (no orphans).
    const uploadedPaths: string[] = [];
    try {
      const supabase = getBrowserSupabase();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        toast("Session expirée — reconnectez-vous.", "error");
        setSubmitting(false);
        return;
      }
      const safePid = paymentId.replace(/[^a-z0-9-]/gi, "");

      for (let i = 0; i < files.length; i++) {
        const original = files[i];
        // Compress image receipts before upload (review-only → document-tier
        // WebP, ~250-500 KB, text stays crisp). compressImage also converts
        // HEIC→webp even when the picker reports an empty mime; PDFs pass
        // through untouched.
        let toUpload = original;
        const ext0 = original.name.split(".").pop()?.toLowerCase() ?? "";
        const isPdf = original.type === "application/pdf" || ext0 === "pdf";
        if (!isPdf) {
          try {
            toUpload = await compressImage(original, { maxEdge: 2000, quality: 0.86, format: "webp" });
          } catch {
            toUpload = original;
          }
        }
        // Owner-scoped path per RLS (0023); index suffix keeps the 3 distinct.
        const ext = toUpload.name.split(".").pop()?.toLowerCase() ?? "bin";
        const path = `${auth.user.id}/${safePid}-${Date.now()}-${i}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("receipts")
          .upload(path, toUpload, { cacheControl: "3600", upsert: false, contentType: toUpload.type });
        if (upErr) {
          if (uploadedPaths.length) void supabase.storage.from("receipts").remove(uploadedPaths);
          toast(`Échec du téléversement : ${upErr.message}`, "error");
          setSubmitting(false);
          return;
        }
        uploadedPaths.push(path);
      }

      const res = await fetch(`/api/payments/${paymentId}/receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt_paths: uploadedPaths, provider }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Couldn't attach — clean up every uploaded object so we don't orphan.
        void supabase.storage.from("receipts").remove(uploadedPaths);
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

  if (cancelled) {
    return (
      <div className="min-h-screen bg-background">
        <main className="max-w-md mx-auto px-4 py-10 lg:py-16">
          {/* Obviously-cancelled card — the previous version was a few
              tiny lines on a white page that read as "blank" to several
              testers. The red ring, full-width card surface, and the
              prominent return-to-listing CTA make the state legible at
              a glance. */}
          <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-6 text-center shadow-lg">
            <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-md shadow-red-500/30">
              <X className="h-8 w-8" strokeWidth={2.8} />
            </div>
            <h1 className="mt-4 text-[22px] font-extrabold leading-tight text-red-900">
              Paiement annulé
            </h1>
            <p className="mt-2 text-[13px] text-red-900/80 leading-relaxed">
              Aucun montant n&apos;a été prélevé. Vous pouvez relancer le
              paiement à tout moment depuis l&apos;annonce.
            </p>
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {auction && (
                <a
                  href={
                    kind === "listing_fee"
                      ? `/${locale}/sell`
                      : `/${locale}/auctions/${auction.id}`
                  }
                  className="inline-flex h-11 items-center justify-center rounded-[var(--radius)] bg-white border border-red-200 text-red-900 px-5 text-[13px] font-bold hover:border-red-400"
                >
                  {kind === "listing_fee" ? "Voir mes annonces" : "Retour à l'annonce"}
                </a>
              )}
              <a
                href={`/${locale}`}
                className="inline-flex h-11 items-center justify-center rounded-[var(--radius)] bg-[var(--gold)] text-white px-5 text-[13px] font-bold hover:bg-[var(--gold-bright)]"
              >
                Accueil
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (submitted) {
    // Final "what happens after validation" step depends on what was paid.
    const finalStep =
      kind === "listing_fee"
        ? "Votre annonce passe en ligne automatiquement."
        : kind === "deposit"
          ? "Votre caution devient active — vous pourrez enchérir."
          : "La vente est confirmée et finalisée.";
    const steps = [
      "Notre équipe vérifie votre reçu (moins de 24 h).",
      "Vous recevez une notification : validé ou correction demandée.",
      finalStep,
    ];
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-md px-4 py-12 lg:py-16">
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
            <div className="flex flex-col items-center bg-gradient-to-b from-emerald-500/10 to-transparent px-6 pt-8 pb-6 text-center">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
                <Check className="h-8 w-8" strokeWidth={2.8} />
              </div>
              <h1 className="mt-4 text-[22px] font-extrabold leading-tight">
                Reçu transmis
              </h1>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--foreground-muted)]">
                Justificatif de{" "}
                <span className="font-bold text-foreground">
                  {formatTND(amount, locale)}
                </span>
                {auction ? (
                  <>
                    {" "}pour{" "}
                    <span className="font-bold text-foreground">{auction.title}</span>
                  </>
                ) : null}{" "}
                bien reçu.
              </p>
            </div>

            <ol className="space-y-3 border-t border-[var(--border)] px-6 py-5">
              {steps.map((s, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--gold-faint)] text-[11px] font-extrabold text-[var(--gold)] ring-1 ring-[var(--gold-soft)]">
                    {i + 1}
                  </span>
                  <span className="text-[12.5px] leading-relaxed text-[var(--foreground-muted)]">
                    {s}
                  </span>
                </li>
              ))}
            </ol>

            <div className="flex flex-col gap-2 border-t border-[var(--border)] p-4">
              {kind === "deposit" && auction ? (
                // The caution path's next surface is the bid page — it shows
                // the "receipt under review" gate now and flips to the live
                // composer the moment the caution is validated.
                <a
                  href={`/${locale}/auctions/${auction.id}/bid`}
                  className="inline-flex h-11 items-center justify-center rounded-[var(--radius)] bg-[var(--gold)] px-5 text-[13px] font-bold text-white hover:bg-[var(--gold-bright)]"
                >
                  Accéder à la page d&apos;enchères <ArrowRight className="ml-1.5 h-4 w-4" />
                </a>
              ) : (
                <a
                  href={`/${locale}`}
                  className="inline-flex h-11 items-center justify-center rounded-[var(--radius)] bg-[var(--gold)] px-5 text-[13px] font-bold text-white hover:bg-[var(--gold-bright)]"
                >
                  Accueil <ArrowRight className="ml-1.5 h-4 w-4" />
                </a>
              )}
              {auction && (
                <a
                  href={
                    kind === "listing_fee"
                      ? `/${locale}/sell`
                      : `/${locale}/auctions/${auction.id}`
                  }
                  className="inline-flex h-11 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-5 text-[13px] font-semibold hover:border-[var(--gold-soft)]"
                >
                  {kind === "listing_fee" ? "Voir mes annonces" : "Retour à l'annonce"}
                </a>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-md px-4 py-6 lg:max-w-5xl lg:py-12">
        <div className="lg:grid lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start lg:gap-8">
        {/* LEFT (desktop) / TOP (mobile) — order summary */}
        <div className="space-y-4 lg:sticky lg:top-[calc(var(--desktop-nav-h)+1.5rem)]">
        {/* ── HERO: what you're paying + how much ── */}
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 text-center">
          {auction?.heroPhotoPath && (
            <div className="relative mb-4 hidden aspect-[16/10] overflow-hidden rounded-xl bg-[var(--surface-2)] lg:block">
              <Image
                src={propertyPhotoUrl(auction.heroPhotoPath)}
                alt=""
                fill
                sizes="360px"
                unoptimized={isStaticSeedPath(propertyPhotoUrl(auction.heroPhotoPath))}
                className="object-cover"
              />
            </div>
          )}
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--gold)]">
            {meta.label}
          </div>
          {auction && (
            <div className="mt-0.5 text-[14px] font-bold leading-tight line-clamp-1">
              {auction.title}
            </div>
          )}
          <div className="batta-tabular gradient-gold-text mt-3 text-[40px] font-extrabold leading-none">
            {formatTND(amount, locale)}
            <span className="ms-1 text-[12px] font-bold uppercase text-[var(--foreground-muted)]">
              TND
            </span>
          </div>
          <p className="mx-auto mt-2 max-w-xs text-[11.5px] leading-snug text-[var(--foreground-muted)]">
            {meta.body}
          </p>
          {editHref && (
            // Made a mistake? Go back and fix the listing before paying — saving
            // returns straight here to finish payment (no duplicate listing/fee).
            <a
              href={editHref}
              className="tap-target mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold text-[var(--gold)] ring-1 ring-[var(--gold-soft)] transition hover:bg-[var(--gold-faint)]"
            >
              ← Modifier l&apos;annonce
            </a>
          )}
        </section>

        {reupload && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-900">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>Reçu précédent refusé — vérifiez les coordonnées et renvoyez un nouveau justificatif.</span>
          </div>
        )}
        </div>

        {/* RIGHT (desktop) / BELOW (mobile) — payment steps */}
        <div className="mt-4 space-y-4 lg:mt-0">
        {/* ── STEP 1: choose method (big toggles) ── */}
        <Step n={1} title="Choisissez le mode de paiement" />
        <div className="grid grid-cols-2 gap-2.5">
          {instructions.map((p) => {
            const Icon = PROVIDER_ICONS[p.value];
            const isActive = provider === p.value;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => setProvider(p.value)}
                aria-pressed={isActive}
                className={cn(
                  "relative flex flex-col items-center gap-2 rounded-2xl border-2 p-4 transition",
                  isActive
                    ? "border-[var(--gold)] bg-[var(--gold-faint)]"
                    : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--gold-soft)]",
                )}
              >
                {isActive && (
                  <span className="absolute right-2 top-2 inline-flex size-5 items-center justify-center rounded-full bg-[var(--gold)] text-white">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                )}
                <span
                  className={cn(
                    "inline-flex size-11 items-center justify-center rounded-xl",
                    isActive ? "bg-[var(--gold)] text-white" : "bg-[var(--surface-2)] text-[var(--foreground-muted)]",
                  )}
                >
                  <Icon className="size-5" strokeWidth={2} />
                </span>
                <span className="text-[13px] font-bold text-foreground">
                  {p.value === "bank_transfer" ? "Virement (RIB)" : "D17 mobile"}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── STEP 2: pay — copyable bank details ── */}
        {active && (
          <>
            <Step n={2} title="Payez avec ces coordonnées" />
            <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
              {active.fields.map((field, i) => (
                <div
                  key={field.label}
                  className={cn(
                    "flex items-center justify-between gap-3 px-4 py-3",
                    i > 0 && "border-t border-[var(--border)]",
                  )}
                >
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-[var(--foreground-muted)]">
                      {field.label}
                    </div>
                    <div className={cn("mt-0.5 text-[14px] font-bold text-foreground break-words", field.mono && "batta-tabular")}>
                      {field.value}
                    </div>
                  </div>
                  {field.copyable && (
                    <button
                      type="button"
                      onClick={() => copyValue(field.label, field.value)}
                      className={cn(
                        "shrink-0 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition",
                        copiedField === field.label
                          ? "bg-[var(--gold)] text-white"
                          : "bg-[var(--surface-2)] text-foreground hover:bg-[var(--gold-faint)] hover:text-[var(--gold)]",
                      )}
                    >
                      {copiedField === field.label ? (
                        <><Check className="size-3.5" strokeWidth={2.5} /> Copié</>
                      ) : (
                        <><Copy className="size-3.5" strokeWidth={2} /> Copier</>
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── STEP 3: upload receipt ── */}
        <Step n={3} title="Téléversez le reçu du virement" />
        <div className="space-y-2.5">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-2xl border border-[var(--gold-soft)] bg-[var(--gold-faint)]/40 p-3.5">
              <FileText className="size-5 shrink-0 text-[var(--gold)]" strokeWidth={2} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{f.name}</div>
                <div className="text-[11px] text-[var(--foreground-muted)]">
                  {(f.size / 1024).toFixed(0)} Ko
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--foreground-muted)] hover:border-red-300 hover:text-red-600"
                aria-label={`Retirer ${f.name}`}
              >
                <X className="size-4" strokeWidth={2} />
              </button>
            </div>
          ))}
          {files.length < MAX_RECEIPTS && (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-[var(--gold-soft)] bg-[var(--gold-faint)]/30 p-7 text-center transition hover:border-[var(--gold)] hover:bg-[var(--gold-faint)]/60">
              <Upload className="size-7 text-[var(--gold)]" strokeWidth={1.8} />
              <span className="text-[14px] font-bold text-foreground">
                {files.length === 0 ? "Choisir une photo ou un PDF" : "Ajouter une autre image"}
              </span>
              <span className="text-[11px] text-[var(--foreground-muted)]">
                JPG · PNG · HEIC · PDF · max {MAX_FILE_MB} Mo · jusqu&apos;à {MAX_RECEIPTS} images ({files.length}/{MAX_RECEIPTS})
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES.join(",")}
                multiple
                onChange={onPickFile}
                className="sr-only"
              />
            </label>
          )}
        </div>

        {/* ── Big submit ── */}
        <button
          type="button"
          onClick={submit}
          disabled={files.length === 0 || submitting}
          className={cn(
            "inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-extrabold transition-all",
            files.length === 0 || submitting
              ? "cursor-not-allowed bg-[var(--surface-2)] text-[var(--foreground-muted)]"
              : "bg-[var(--gold)] text-white shadow-[var(--shadow-gold)] hover:bg-[var(--gold-bright)]",
          )}
        >
          {submitting ? (
            <><Loader2 className="size-5 animate-spin" /> Envoi…</>
          ) : (
            <><Upload className="size-5" strokeWidth={2.5} /> Envoyer {files.length > 1 ? `les ${files.length} reçus` : "le reçu"}</>
          )}
        </button>
        <p className="text-center text-[11px] text-[var(--foreground-muted)]">
          {files.length > 0 ? "Validation sous 24 h — vous serez notifié(e)." : "Téléversez d'abord le reçu pour activer le bouton."}
        </p>

        {/* Cancel — small, out of the way */}
        {!reupload && (
          <button
            type="button"
            onClick={cancelPayment}
            disabled={cancelling}
            className="mx-auto block text-[12px] font-semibold text-[var(--foreground-subtle)] underline underline-offset-2 hover:text-red-500 disabled:opacity-50"
          >
            {cancelling ? "Annulation…" : "Annuler ce paiement"}
          </button>
        )}
        </div>
        </div>
      </main>
    </div>
  );
}

function Step({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2.5 pt-1">
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--gold)] text-[13px] font-extrabold text-white">
        {n}
      </span>
      <span className="text-[14px] font-bold text-foreground">{title}</span>
    </div>
  );
}
