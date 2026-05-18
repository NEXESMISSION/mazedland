"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { compressImage } from "@/lib/imageCompress";
import type { PropertyType } from "@/lib/types";
import {
  Camera,
  FileText,
  Trash2,
  CheckCircle2,
  Upload,
  Check,
  AlertCircle,
  Star,
  ArrowUpToLine,
  Megaphone,
  ChevronRight,
  ChevronLeft,
  Loader2,
} from "lucide-react";

const TYPES: PropertyType[] = ["apartment", "house", "villa", "land", "commercial", "office", "warehouse", "farm"];

const GOVERNORATES = [
  "Tunis", "Ariana", "Ben Arous", "Manouba",
  "Sousse", "Monastir", "Mahdia", "Nabeul",
  "Sfax", "Bizerte", "Gabès", "Médenine",
  "Kairouan", "Béja", "Jendouba", "Kef",
  "Kasserine", "Sidi Bouzid", "Gafsa", "Tozeur",
  "Kebili", "Tataouine", "Siliana", "Zaghouan",
];

type LegalDocKind = {
  id: string;
  label: string;
  description: string | null;
  required: boolean;
  sort_order: number;
};

export type SellFormPricing = {
  listing_fee_tnd: number;
  promo_home_featured_tnd: number;
  promo_top_listed_tnd: number;
  promo_banner_tnd: number;
};

export type SellFormInitial = {
  id: string;
  title: string;
  description: string | null;
  type: PropertyType;
  area_sqm: number | null;
  rooms: number | null;
  bathrooms: number | null;
  floor: number | null;
  year_built: number | null;
  governorate: string;
  delegation: string | null;
  address: string | null;
};

/**
 * Property listing form — two-step in new mode:
 *
 *   Step 1: Details (fields + photos + legal docs from the admin catalog).
 *   Step 2: Promotions picker — base listing fee plus opt-in placements
 *           (home rail, top of search, banner). Prices come from
 *           app_settings (set in /admin/settings).
 *
 *   Submit (new mode): insert property + upload photos & docs →
 *   POST /api/listings/<id>/initiate-payment with promo selections →
 *   redirect to /payment/checkout?payment=<id> for IBAN/D17 + receipt upload.
 *
 *   Edit mode keeps a single submit and carries forward any prior
 *   captured listing_fee payment — sellers don't re-pay to fix a rejected
 *   listing.
 */
export function SellForm({
  initial,
  pricing,
}: {
  initial?: SellFormInitial;
  pricing: SellFormPricing;
}) {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const isRTL = locale === "ar";
  const isEdit = !!initial;
  const ChevronNext = isRTL ? ChevronLeft : ChevronRight;
  const ChevronPrev = isRTL ? ChevronRight : ChevronLeft;

  // ─── Field state ─────────────────────────────────────────────────────
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [type, setType] = useState<PropertyType>(initial?.type ?? "apartment");
  const [areaSqm, setAreaSqm] = useState<string>(
    initial?.area_sqm != null ? String(initial.area_sqm) : "",
  );
  const [rooms, setRooms] = useState<string>(
    initial?.rooms != null ? String(initial.rooms) : "",
  );
  const [bathrooms, setBathrooms] = useState<string>(
    initial?.bathrooms != null ? String(initial.bathrooms) : "",
  );
  const [floor, setFloor] = useState<string>(
    initial?.floor != null ? String(initial.floor) : "",
  );
  const [yearBuilt, setYearBuilt] = useState<string>(
    initial?.year_built != null ? String(initial.year_built) : "",
  );
  const [governorate, setGovernorate] = useState(initial?.governorate ?? "Tunis");
  const [delegation, setDelegation] = useState(initial?.delegation ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [photos, setPhotos] = useState<File[]>([]);

  // Per-kind upload state keyed by legal_doc_kinds.id.
  const [docFiles, setDocFiles] = useState<Record<string, File>>({});
  const [docKinds, setDocKinds] = useState<LegalDocKind[]>([]);
  const [docKindsLoading, setDocKindsLoading] = useState(true);

  // ─── Promo + flow state ──────────────────────────────────────────────
  const [step, setStep] = useState<1 | 2>(1);
  const [promoHome, setPromoHome] = useState(false);
  const [promoTop, setPromoTop] = useState(false);
  const [promoBanner, setPromoBanner] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Fetch the admin-controlled catalog for the currently-selected property
  // type. Refetches whenever `type` changes.
  useEffect(() => {
    let cancelled = false;
    setDocKindsLoading(true);
    const supabase = getBrowserSupabase();
    supabase
      .from("legal_doc_kinds")
      .select("id, label, description, required, sort_order")
      .eq("property_type", type)
      .order("sort_order")
      .order("label")
      .then(({ data }: { data: LegalDocKind[] | null }) => {
        if (cancelled) return;
        setDocKinds(data ?? []);
        // Drop any picked file whose kind no longer applies to the new type.
        setDocFiles((prev) => {
          const allowed = new Set((data ?? []).map((k) => k.id));
          const next: Record<string, File> = {};
          for (const [id, f] of Object.entries(prev)) {
            if (allowed.has(id)) next[id] = f;
          }
          return next;
        });
        setDocKindsLoading(false);
      });
    return () => { cancelled = true; };
  }, [type]);

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const next = [...photos, ...Array.from(files)].slice(0, 10);
    setPhotos(next);
  }

  function setDocFile(kindId: string, file: File | null) {
    setDocFiles((prev) => {
      const next = { ...prev };
      if (file) next[kindId] = file;
      else delete next[kindId];
      return next;
    });
  }

  // ─── Totals ──────────────────────────────────────────────────────────
  const total = useMemo(() => {
    return (
      pricing.listing_fee_tnd +
      (promoHome ? pricing.promo_home_featured_tnd : 0) +
      (promoTop ? pricing.promo_top_listed_tnd : 0) +
      (promoBanner ? pricing.promo_banner_tnd : 0)
    );
  }, [pricing, promoHome, promoTop, promoBanner]);

  // ─── Step-1 validation (advance to promos, or submit in edit mode) ───
  function validateDetails(): string | null {
    if (!title.trim()) return t("sell.form.errorTitleRequired");
    if (!isEdit && photos.length === 0) return t("sell.form.errorPhotoRequired");
    if (!isEdit) {
      const missingRequired = docKinds
        .filter((k) => k.required)
        .find((k) => !docFiles[k.id]);
      if (missingRequired) {
        return t("sell.form.errorMissingDoc").replace(
          "{label}",
          missingRequired.label,
        );
      }
    }
    return null;
  }

  function onNext(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const err = validateDetails();
    if (err) { setError(err); return; }
    if (isEdit) {
      void doSubmit();
    } else {
      setStep(2);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function onFinalSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    void doSubmit();
  }

  async function doSubmit() {
    startTransition(async () => {
      const supabase = getBrowserSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError(t("sell.form.errorNotSignedIn")); return; }

      try {
        // 1. Create or update the property row.
        let propId: string;
        if (isEdit && initial) {
          const { error: uErr } = await supabase
            .from("properties")
            .update({
              title, description: description || null, type,
              area_sqm: areaSqm ? Number(areaSqm) : null,
              rooms: rooms ? Number(rooms) : null,
              bathrooms: bathrooms ? Number(bathrooms) : null,
              floor: floor ? Number(floor) : null,
              year_built: yearBuilt ? Number(yearBuilt) : null,
              governorate, delegation: delegation || null, address: address || null,
              status: "pending_review",
              rejection_reason: null,
            })
            .eq("id", initial.id);
          if (uErr) throw new Error(uErr.message);
          propId = initial.id;
        } else {
          const { data: prop, error: pErr } = await supabase
            .from("properties")
            .insert({
              owner_id: user.id,
              title, description: description || null, type,
              area_sqm: areaSqm ? Number(areaSqm) : null,
              rooms: rooms ? Number(rooms) : null,
              bathrooms: bathrooms ? Number(bathrooms) : null,
              floor: floor ? Number(floor) : null,
              year_built: yearBuilt ? Number(yearBuilt) : null,
              governorate, delegation: delegation || null, address: address || null,
              status: "pending_review",
            })
            .select("id")
            .single();
          if (pErr || !prop) throw new Error(pErr?.message ?? "property insert failed");
          propId = prop.id;
        }

        // 2. Photos.
        if (photos.length > 0) {
          const compressed = await Promise.all(
            photos.map((file) =>
              compressImage(file, { maxEdge: 1600, quality: 0.8, format: "webp" }),
            ),
          );
          const photoUploads = await Promise.all(
            compressed.map(async (file, i) => {
              const ext = file.name.split(".").pop()?.toLowerCase() || "webp";
              const path = `${user.id}/${propId}/photo-${Date.now()}-${i}.${ext}`;
              const { error } = await supabase.storage.from("properties").upload(path, file, {
                contentType: file.type, upsert: false,
              });
              if (error) throw new Error(`photo ${i}: ${error.message}`);
              return { storage_path: path, sort_order: i };
            }),
          );
          await supabase.from("property_photos").insert(
            photoUploads.map((p) => ({ ...p, property_id: propId })),
          );
        }

        // 3. Docs — per-kind, label snapshot stored on property_documents.kind.
        const docEntries = Object.entries(docFiles);
        if (docEntries.length > 0) {
          const labelById = new Map(docKinds.map((k) => [k.id, k.label]));
          const docUploads = await Promise.all(
            docEntries.map(async ([kindId, file], i) => {
              const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
              const path = `${user.id}/${propId}/doc-${Date.now()}-${i}.${ext}`;
              const { error } = await supabase.storage
                .from("property-documents")
                .upload(path, file, { contentType: file.type, upsert: false });
              if (error) throw new Error(`doc ${i}: ${error.message}`);
              return {
                property_id: propId,
                kind: labelById.get(kindId) ?? "Autre",
                storage_path: path,
              };
            }),
          );
          await supabase.from("property_documents").insert(docUploads);
        }

        // 4. Edit mode: carry-over rule — no new payment, return to dashboard.
        if (isEdit) {
          setSuccess(true);
          setTimeout(() => router.replace("/sell"), 2000);
          return;
        }

        // 5. New-mode: initiate listing-fee payment, then redirect to checkout.
        const res = await fetch(`/api/listings/${propId}/initiate-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            promos: {
              home_featured: promoHome,
              top_listed: promoTop,
              banner: promoBanner,
            },
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.detail ?? data.error ?? "payment_init_failed");
        }
        const { paymentId } = (await res.json()) as { paymentId: string };
        router.replace(
          `/payment/checkout?payment=${encodeURIComponent(paymentId)}` as `/payment/checkout`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Submit failed");
      }
    });
  }

  if (success) {
    return (
      <div className="batta-tone-ok mt-6 rounded-2xl p-6 text-center">
        <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
        <h2 className="mt-3 text-lg font-bold text-batta-cream">
          {isEdit ? t("sell.savedTitle") : t("sell.successTitle")}
        </h2>
        <p className="mt-1 text-xs text-batta-ink/65">
          {isEdit ? t("sell.savedBody") : t("sell.successBody")}
        </p>
      </div>
    );
  }

  // ─── Step 2: Promo picker ──────────────────────────────────────────────
  if (step === 2 && !isEdit) {
    return (
      <form onSubmit={onFinalSubmit} className="mt-5 space-y-4">
        <StepHeader current={2} />

        <header>
          <h2 className="text-[18px] font-extrabold leading-tight text-foreground">
            {t("sell.promo.title")}
          </h2>
          <p className="mt-1 text-[12px] text-[var(--foreground-muted)]">
            {t("sell.promo.subtitle")}
          </p>
        </header>

        <PromoRow
          icon={<Star className="size-4" />}
          title={t("sell.promo.homeFeaturedTitle")}
          body={t("sell.promo.homeFeaturedBody")}
          price={pricing.promo_home_featured_tnd}
          checked={promoHome}
          onChange={setPromoHome}
        />
        <PromoRow
          icon={<ArrowUpToLine className="size-4" />}
          title={t("sell.promo.topListedTitle")}
          body={t("sell.promo.topListedBody")}
          price={pricing.promo_top_listed_tnd}
          checked={promoTop}
          onChange={setPromoTop}
        />
        <PromoRow
          icon={<Megaphone className="size-4" />}
          title={t("sell.promo.bannerTitle")}
          body={t("sell.promo.bannerBody")}
          price={pricing.promo_banner_tnd}
          checked={promoBanner}
          onChange={setPromoBanner}
        />

        {/* Totals */}
        <div className="rounded-2xl border border-[var(--gold)]/25 bg-gradient-to-br from-[var(--surface)] to-[#1a1408] p-4">
          <div className="flex items-baseline justify-between text-[12.5px]">
            <span className="text-[var(--foreground-muted)]">
              {t("sell.promo.baseFee")}
            </span>
            <span className="batta-tabular font-semibold text-foreground">
              {pricing.listing_fee_tnd.toFixed(2)} TND
            </span>
          </div>
          {promoHome && (
            <PromoLine label={t("sell.promo.homeFeaturedShort")} price={pricing.promo_home_featured_tnd} />
          )}
          {promoTop && (
            <PromoLine label={t("sell.promo.topListedShort")} price={pricing.promo_top_listed_tnd} />
          )}
          {promoBanner && (
            <PromoLine label={t("sell.promo.bannerShort")} price={pricing.promo_banner_tnd} />
          )}
          <div className="mt-3 flex items-baseline justify-between border-t border-[var(--border)] pt-3">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[var(--gold)]">
              {t("sell.promo.total")}
            </span>
            <span className="batta-tabular gradient-gold-text text-[24px] font-extrabold leading-none">
              {total.toFixed(2)}{" "}
              <span className="text-[10px] font-bold uppercase text-[var(--foreground-muted)]">
                TND
              </span>
            </span>
          </div>
        </div>

        {error && (
          <p className="batta-tone-bad rounded-lg px-3 py-2 text-xs inline-flex items-start gap-1.5">
            <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
            {error}
          </p>
        )}

        <div className="sticky bottom-[calc(var(--batta-bottombar-h)+var(--batta-safe-bottom)+12px)] z-20 mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setStep(1)}
            disabled={isPending}
            className="tap-target inline-flex h-12 items-center justify-center gap-1.5 rounded-full border border-batta-gold/30 bg-batta-surface px-4 text-[13px] font-bold text-foreground disabled:opacity-50"
          >
            <ChevronPrev className="size-4" />
            {t("sell.promo.back")}
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="batta-btn-luxe tap-target flex-1 px-5 py-3.5 text-[13.5px] disabled:opacity-50"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("sell.promo.submitting")}
              </>
            ) : (
              <>
                {t("sell.promo.continueToPayment")}
                <ChevronNext className="size-4" />
              </>
            )}
          </button>
        </div>
      </form>
    );
  }

  // ─── Step 1: Details ─────────────────────────────────────────────────
  return (
    <form onSubmit={onNext} className="mt-5 space-y-4">
      {!isEdit && <StepHeader current={1} />}

      <Field
        label={t("sell.form.titleLabel")} required
        placeholder={t("sell.form.titlePh")}
        value={title} onChange={setTitle} dir={isRTL ? "rtl" : "ltr"}
      />
      <TextArea
        label={t("sell.form.descriptionLabel")}
        placeholder={t("sell.form.descriptionPh")}
        value={description} onChange={setDescription} dir={isRTL ? "rtl" : "ltr"}
      />

      <Select label={t("sell.form.type")} value={type} onChange={(v) => setType(v as PropertyType)}>
        {TYPES.map((tp) => (
          <option key={tp} value={tp}>{t(`property.types.${tp}`)}</option>
        ))}
      </Select>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("sell.form.area")} type="number" value={areaSqm} onChange={setAreaSqm} />
        <Field label={t("sell.form.rooms")} type="number" value={rooms} onChange={setRooms} />
        <Field label={t("sell.form.bathrooms")} type="number" value={bathrooms} onChange={setBathrooms} />
        <Field label={t("sell.form.floor")} type="number" value={floor} onChange={setFloor} />
      </div>
      <Field label={t("sell.form.yearBuilt")} type="number" value={yearBuilt} onChange={setYearBuilt} />

      <Select label={t("sell.form.governorate")} value={governorate} onChange={setGovernorate}>
        {GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
      </Select>
      <Field label={t("sell.form.delegation")} value={delegation} onChange={setDelegation} />
      <Field label={t("sell.form.address")} value={address} onChange={setAddress} />

      {/* Photos */}
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold text-batta-ink/80">
            {t("sell.form.photos")} <span className="text-batta-muted">({photos.length}/10)</span>
          </span>
        </div>
        <p className="mt-0.5 text-[10px] text-batta-muted">{t("sell.form.photosHint")}</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {photos.map((f, i) => (
            <div key={i} className="relative aspect-square overflow-hidden rounded-lg bg-batta-surface-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={URL.createObjectURL(f)} alt="" className="size-full object-cover" />
              <button
                type="button"
                onClick={() => setPhotos((p) => p.filter((_, idx) => idx !== i))}
                className="absolute top-1 inline-flex size-6 items-center justify-center rounded-full bg-black/60 text-white ltr:right-1 rtl:left-1"
                aria-label="Remove"
              >
                <Trash2 className="size-3" />
              </button>
              {i === 0 && (
                <span className="absolute bottom-1 rounded-full bg-batta-gold px-1.5 py-0.5 text-[9px] font-bold text-white ltr:left-1 rtl:right-1">
                  COVER
                </span>
              )}
            </div>
          ))}
          {photos.length < 10 && (
            <label className="tap-target flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-batta-gold/30 bg-batta-surface-2 text-batta-cream/70">
              <Camera className="size-5" />
              <span className="mt-1 text-[10px]">+</span>
              <input
                type="file" accept="image/*" multiple
                className="hidden"
                onChange={(e) => addPhotos(e.target.files)}
              />
            </label>
          )}
        </div>
      </div>

      {/* Documents — admin-controlled per-type catalog */}
      <div>
        <span className="text-xs font-semibold text-batta-ink/80">{t("sell.form.documents")}</span>
        <p className="mt-0.5 text-[10px] text-batta-muted">{t("sell.form.documentsHint")}</p>

        {docKindsLoading ? (
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-batta-surface-2 px-3 py-2 text-[11px] text-batta-muted">
            <Loader2 className="size-3 animate-spin" />
            {t("sell.form.documentsLoading")}
          </div>
        ) : docKinds.length === 0 ? (
          <p className="mt-2 rounded-lg bg-batta-surface-2 px-3 py-2 text-[11px] text-batta-muted">
            {t("sell.form.documentsNone")}
          </p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {docKinds.map((kind) => (
              <DocKindRow
                key={kind.id}
                kind={kind}
                file={docFiles[kind.id]}
                onPick={(f) => setDocFile(kind.id, f)}
                onClear={() => setDocFile(kind.id, null)}
              />
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="batta-tone-bad rounded-lg px-3 py-2 text-xs inline-flex items-start gap-1.5">
          <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="batta-btn-luxe tap-target sticky bottom-[calc(var(--batta-bottombar-h)+var(--batta-safe-bottom)+12px)] z-20 mt-4 w-full px-5 py-3.5 text-[13.5px] disabled:opacity-50"
      >
        {isEdit ? (
          isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {t("sell.saving")}
            </>
          ) : (
            t("sell.saveChanges")
          )
        ) : (
          <>
            {t("sell.form.continueToPromos")}
            <ChevronNext className="size-4" />
          </>
        )}
      </button>
    </form>
  );
}

function StepHeader({ current }: { current: 1 | 2 }) {
  const t = useTranslations();
  return (
    <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.16em]">
      <span
        className={
          current === 1
            ? "text-[var(--gold)]"
            : "text-[var(--foreground-muted)]"
        }
      >
        1. {t("sell.steps.details")}
      </span>
      <span className="h-px flex-1 bg-[var(--border)]" aria-hidden />
      <span
        className={
          current === 2
            ? "text-[var(--gold)]"
            : "text-[var(--foreground-muted)]"
        }
      >
        2. {t("sell.steps.options")}
      </span>
    </div>
  );
}

function PromoRow({
  icon,
  title,
  body,
  price,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  price: number;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={
        "w-full rounded-2xl p-4 text-start ring-1 transition " +
        (checked
          ? "bg-[var(--gold-faint)] ring-[var(--gold)]/40"
          : "bg-surface ring-border hover:ring-gold/30")
      }
    >
      <div className="flex items-start gap-3">
        <span
          className={
            "inline-flex size-9 shrink-0 items-center justify-center rounded-full " +
            (checked
              ? "bg-[var(--gold)] text-white"
              : "bg-[var(--surface-2)] text-[var(--gold)]")
          }
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13.5px] font-bold text-foreground">{title}</span>
            <span className="batta-tabular shrink-0 text-[13px] font-extrabold text-[var(--gold)]">
              + {price.toFixed(2)}{" "}
              <span className="text-[9px] font-bold uppercase text-[var(--foreground-muted)]">TND</span>
            </span>
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--foreground-muted)]">
            {body}
          </p>
        </div>
        <span
          aria-hidden
          className={
            "inline-flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition " +
            (checked
              ? "border-[var(--gold)] bg-[var(--gold)] text-white"
              : "border-[var(--border)] bg-transparent")
          }
        >
          {checked && <Check className="size-3" strokeWidth={3} />}
        </span>
      </div>
    </button>
  );
}

function PromoLine({ label, price }: { label: string; price: number }) {
  return (
    <div className="mt-1 flex items-baseline justify-between text-[12px]">
      <span className="text-[var(--foreground-muted)] truncate">+ {label}</span>
      <span className="batta-tabular font-semibold text-foreground">
        {price.toFixed(2)} TND
      </span>
    </div>
  );
}

function Field({
  label, type = "text", value, onChange, required, placeholder, dir,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  dir?: "ltr" | "rtl";
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-batta-ink/80">
        {label}{required && <span className="text-red-500"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        dir={dir}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-3 py-2.5 text-sm text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
      />
    </label>
  );
}

function TextArea({
  label, value, onChange, placeholder, dir,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  dir?: "ltr" | "rtl";
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-batta-ink/80">{label}</span>
      <textarea
        rows={4}
        value={value}
        placeholder={placeholder}
        dir={dir}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-3 py-2.5 text-sm text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
      />
    </label>
  );
}

function Select({
  label, value, onChange, children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-batta-ink/80">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-3 py-2.5 text-sm text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
      >
        {children}
      </select>
    </label>
  );
}

function DocKindRow({
  kind,
  file,
  onPick,
  onClear,
}: {
  kind: LegalDocKind;
  file: File | undefined;
  onPick: (file: File | null) => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-batta-gold/30 bg-batta-surface-2 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs font-bold text-batta-cream">{kind.label}</span>
            {kind.required && (
              <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-red-300">
                Requis
              </span>
            )}
          </div>
          {kind.description && (
            <p className="mt-0.5 text-[10.5px] leading-snug text-batta-muted">
              {kind.description}
            </p>
          )}
        </div>
        {file ? (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-1 text-[10px] font-bold text-red-300"
            aria-label="Remove"
          >
            <Trash2 className="size-3" />
          </button>
        ) : null}
      </div>

      {file ? (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-batta-cream">
          <FileText className="size-3.5 text-batta-blue" />
          <span className="truncate">{file.name}</span>
          <Check className="size-3 text-emerald-500" strokeWidth={3} />
        </div>
      ) : (
        <label className="tap-target mt-2 inline-flex w-full cursor-pointer items-center justify-center gap-1 rounded-md bg-batta-gold/12 px-2 py-1.5 text-xs font-semibold text-batta-gold-bright ring-1 ring-batta-gold/30">
          <Upload className="size-3" />
          + Pick file
          <input
            type="file"
            accept=".pdf,image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              onPick(f ?? null);
              e.target.value = "";
            }}
          />
        </label>
      )}
    </div>
  );
}
