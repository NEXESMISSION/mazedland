"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
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
  Gavel,
  Tag,
} from "lucide-react";

export type ListingType = "auction" | "direct";

const TYPES: PropertyType[] = ["apartment", "house", "villa", "land", "commercial", "office", "warehouse", "farm"];

/**
 * Which Caractéristiques fields make sense for each property type.
 * Surface is universal — a property without a surface is meaningless.
 * The rest are typed in/out: land has no rooms, a warehouse has no
 * bathrooms or floor, etc. When the user switches type, the now-
 * irrelevant fields are cleared from local state AND sent as null on
 * submit, so the DB never carries "3 bathrooms" on a land listing.
 *
 * Add a new PropertyType? Append a row here and the form will pick it
 * up — no further changes needed.
 */
type FeatureField = "area" | "rooms" | "bathrooms" | "floor" | "year_built";
const TYPE_FEATURES: Record<PropertyType, Record<FeatureField, boolean>> = {
  apartment:  { area: true,  rooms: true,  bathrooms: true,  floor: true,  year_built: true  },
  house:      { area: true,  rooms: true,  bathrooms: true,  floor: false, year_built: true  },
  villa:      { area: true,  rooms: true,  bathrooms: true,  floor: false, year_built: true  },
  land:       { area: true,  rooms: false, bathrooms: false, floor: false, year_built: false },
  commercial: { area: true,  rooms: false, bathrooms: true,  floor: true,  year_built: true  },
  office:     { area: true,  rooms: true,  bathrooms: true,  floor: true,  year_built: true  },
  warehouse:  { area: true,  rooms: false, bathrooms: false, floor: false, year_built: true  },
  farm:       { area: true,  rooms: false, bathrooms: false, floor: false, year_built: true  },
};

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
  listing_fee_offer_tnd: number;
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
  listing_type: ListingType;
  sale_price: number | null;
  sale_negotiable: boolean;
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
  const isEdit = !!initial;
  const ChevronNext = ChevronRight;

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

  // Listing intent — "enchère" (auction) or "offre directe" (fixed-price
  // sale). Drives the fee shown in step 2 and whether the seller still
  // has to schedule an auction after admin approval.
  const [listingType, setListingType] = useState<ListingType>(
    initial?.listing_type ?? "auction",
  );
  const [salePrice, setSalePrice] = useState<string>(
    initial?.sale_price != null ? String(initial.sale_price) : "",
  );
  const [saleNegotiable, setSaleNegotiable] = useState<boolean>(
    initial?.sale_negotiable ?? false,
  );

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
  // Base fee depends on the listing intent — auction vs offer can be
  // priced differently by the admin in /admin/settings.
  const baseFee =
    listingType === "direct"
      ? pricing.listing_fee_offer_tnd
      : pricing.listing_fee_tnd;
  const total = useMemo(() => {
    return (
      baseFee +
      (promoHome ? pricing.promo_home_featured_tnd : 0) +
      (promoTop ? pricing.promo_top_listed_tnd : 0) +
      (promoBanner ? pricing.promo_banner_tnd : 0)
    );
  }, [baseFee, pricing, promoHome, promoTop, promoBanner]);

  // ─── Step-1 validation (advance to promos, or submit in edit mode) ───
  function validateDetails(): string | null {
    if (!title.trim()) return t("sell.form.errorTitleRequired");
    if (listingType === "direct") {
      const p = Number(salePrice);
      if (!p || p <= 0) return "Veuillez indiquer un prix de vente valide.";
    }
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
        // Listing-type guard rails for the DB CHECK constraint:
        // sale_price must be set when direct, must be NULL when auction.
        const isDirect = listingType === "direct";
        const salePriceVal = isDirect && salePrice ? Number(salePrice) : null;
        const saleNegotiableVal = isDirect ? saleNegotiable : false;

        // Force-null any feature field that the current PropertyType
        // doesn't expose. Belt-and-braces — the form already clears
        // hidden fields on type switch, but this guarantees a clean
        // DB row even if a stale value somehow survived (e.g. an
        // initial value preloaded into state for an edit).
        const visible = TYPE_FEATURES[type];
        const features = {
          area_sqm:   visible.area       && areaSqm   ? Number(areaSqm)   : null,
          rooms:      visible.rooms      && rooms     ? Number(rooms)     : null,
          bathrooms:  visible.bathrooms  && bathrooms ? Number(bathrooms) : null,
          floor:      visible.floor      && floor     ? Number(floor)     : null,
          year_built: visible.year_built && yearBuilt ? Number(yearBuilt) : null,
        };

        if (isEdit && initial) {
          const { error: uErr } = await supabase
            .from("properties")
            .update({
              title, description: description || null, type,
              ...features,
              governorate, delegation: delegation || null, address: address || null,
              listing_type: listingType,
              sale_price: salePriceVal,
              sale_negotiable: saleNegotiableVal,
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
              ...features,
              governorate, delegation: delegation || null, address: address || null,
              listing_type: listingType,
              sale_price: salePriceVal,
              sale_negotiable: saleNegotiableVal,
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
        // listing_type is sent so the API can charge the right fee
        // (offers and auctions are priced separately in app_settings).
        const res = await fetch(`/api/listings/${propId}/initiate-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            listing_type: listingType,
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
              {listingType === "direct"
                ? "Frais — Offre directe"
                : t("sell.promo.baseFee")}
            </span>
            <span className="batta-tabular font-semibold text-foreground">
              {baseFee.toFixed(2)} TND
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
            <ChevronLeft className="size-4" />
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

      {/* 1. LISTING TYPE — first, because it changes downstream pricing
          and the schedule step. Big, obvious radio cards. */}
      <Section
        title="Type d'annonce"
        hint="Choisissez le mode de mise en vente. Les frais d'annonce sont indiqués sur chaque option."
      >
        <div className="grid grid-cols-2 gap-2.5">
          <ListingTypeOption
            active={listingType === "auction"}
            icon={<Gavel className="size-4" strokeWidth={2.2} />}
            label="Enchère"
            sub="Le prix monte avec les offres reçues."
            price={pricing.listing_fee_tnd}
            onClick={() => setListingType("auction")}
          />
          <ListingTypeOption
            active={listingType === "direct"}
            icon={<Tag className="size-4" strokeWidth={2.2} />}
            label="Offre directe"
            sub="Prix fixe, vente sans enchère."
            price={pricing.listing_fee_offer_tnd}
            onClick={() => setListingType("direct")}
          />
        </div>

        {listingType === "direct" && (
          <div className="mt-1 grid gap-3 rounded-xl bg-[var(--gold-faint)] p-3 ring-1 ring-[var(--gold-soft)]">
            <Field
              label="Prix de vente (TND)"
              type="number"
              value={salePrice}
              onChange={setSalePrice}
              required
            />
            <label className="inline-flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={saleNegotiable}
                onChange={(e) => setSaleNegotiable(e.target.checked)}
                className="size-4 rounded border-[var(--border)] accent-[var(--gold)]"
              />
              <span className="text-[12.5px] font-semibold text-foreground">
                Prix négociable
              </span>
              <span className="text-[11px] text-[var(--foreground-muted)]">
                — les acheteurs peuvent vous faire une offre
              </span>
            </label>
          </div>
        )}
      </Section>

      {/* 2. ANNONCE — title + description */}
      <Section
        title="Informations principales"
        hint="Le titre est la première chose que les acheteurs voient. Soyez précis."
      >
        <Field
          label={t("sell.form.titleLabel")}
          required
          placeholder={t("sell.form.titlePh")}
          value={title}
          onChange={setTitle}
        />
        <TextArea
          label={t("sell.form.descriptionLabel")}
          placeholder={t("sell.form.descriptionPh")}
          value={description}
          onChange={setDescription}
        />
      </Section>

      {/* 3. CARACTÉRISTIQUES — physical attributes of the property */}
      <Section
        title="Caractéristiques"
        hint="Toutes ces informations apparaissent sur la fiche publique."
      >
        <Select
          label={t("sell.form.type")}
          value={type}
          onChange={(v) => {
            const next = v as PropertyType;
            const visible = TYPE_FEATURES[next];
            // Clear any field that's no longer relevant for the new
            // type so a stale "3 bathrooms" doesn't follow the user
            // from apartment → land.
            if (!visible.rooms) setRooms("");
            if (!visible.bathrooms) setBathrooms("");
            if (!visible.floor) setFloor("");
            if (!visible.year_built) setYearBuilt("");
            setType(next);
          }}
        >
          {TYPES.map((tp) => (
            <option key={tp} value={tp}>
              {t(`property.types.${tp}`)}
            </option>
          ))}
        </Select>

        {/* Render only the feature fields relevant to the chosen type.
            Surface is shown for every type (a property without surface
            is unsellable). The 2-col grid keeps the row tidy whether
            we render 1 field or 4 — single-field types just leave one
            slot blank on lg+, which is fine. */}
        {(() => {
          const visible = TYPE_FEATURES[type];
          return (
            <>
              <div className="grid grid-cols-2 gap-3">
                {visible.area && (
                  <Field
                    label={t("sell.form.area")}
                    type="number"
                    value={areaSqm}
                    onChange={setAreaSqm}
                  />
                )}
                {visible.rooms && (
                  <Field
                    label={t("sell.form.rooms")}
                    type="number"
                    value={rooms}
                    onChange={setRooms}
                  />
                )}
                {visible.bathrooms && (
                  <Field
                    label={t("sell.form.bathrooms")}
                    type="number"
                    value={bathrooms}
                    onChange={setBathrooms}
                  />
                )}
                {visible.floor && (
                  <Field
                    label={t("sell.form.floor")}
                    type="number"
                    value={floor}
                    onChange={setFloor}
                  />
                )}
              </div>
              {visible.year_built && (
                <Field
                  label={t("sell.form.yearBuilt")}
                  type="number"
                  value={yearBuilt}
                  onChange={setYearBuilt}
                />
              )}
            </>
          );
        })()}
      </Section>

      {/* 4. LOCALISATION */}
      <Section title="Localisation">
        <Select
          label={t("sell.form.governorate")}
          value={governorate}
          onChange={setGovernorate}
        >
          {GOVERNORATES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t("sell.form.delegation")}
            value={delegation}
            onChange={setDelegation}
          />
          <Field
            label={t("sell.form.address")}
            value={address}
            onChange={setAddress}
          />
        </div>
      </Section>

      {/* 5. PHOTOS */}
      <Section
        title={`${t("sell.form.photos")} · ${photos.length}/10`}
        hint={t("sell.form.photosHint")}
      >
        <div className="grid grid-cols-3 gap-2.5">
          {photos.map((f, i) => (
            <div
              key={i}
              className="relative aspect-square overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] shadow-sm"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={URL.createObjectURL(f)}
                alt=""
                className="size-full object-cover"
              />
              {/* Soft bottom scrim — keeps the COVER pill + delete
                  button readable on any photo */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent" />
              <button
                type="button"
                onClick={() =>
                  setPhotos((p) => p.filter((_, idx) => idx !== i))
                }
                className="absolute right-1.5 top-1.5 inline-flex size-7 items-center justify-center rounded-full bg-white/95 text-red-500 shadow-sm transition active:scale-90"
                aria-label="Supprimer la photo"
              >
                <Trash2 className="size-3.5" strokeWidth={2.2} />
              </button>
              {i === 0 && (
                <span className="batta-gradient-gold absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.14em] text-white shadow-[var(--shadow-gold)]">
                  <Star className="size-2.5" strokeWidth={3} />
                  Couverture
                </span>
              )}
            </div>
          ))}
          {photos.length < 10 && (
            <label className="tap-target flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-[var(--gold-soft)] bg-[var(--gold-faint)] text-[var(--gold)] transition hover:border-[var(--gold)] hover:bg-[var(--gold-faint)]/80">
              <Camera className="size-6" strokeWidth={2} />
              <span className="text-[10px] font-bold uppercase tracking-[0.14em]">
                Ajouter
              </span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => addPhotos(e.target.files)}
              />
            </label>
          )}
        </div>
      </Section>

      {/* 6. DOCUMENTS */}
      <Section
        title={t("sell.form.documents")}
        hint={t("sell.form.documentsHint")}
      >
        {docKindsLoading ? (
          <div className="flex items-center gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-2.5 text-[12px] text-[var(--foreground-muted)]">
            <Loader2 className="size-3.5 animate-spin" />
            {t("sell.form.documentsLoading")}
          </div>
        ) : docKinds.length === 0 ? (
          <p className="rounded-xl bg-[var(--surface-2)] px-3 py-2.5 text-[12px] text-[var(--foreground-muted)]">
            {t("sell.form.documentsNone")}
          </p>
        ) : (
          <div className="space-y-2">
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
      </Section>

      {error && (
        <p className="batta-tone-bad inline-flex items-start gap-1.5 rounded-xl px-3 py-2 text-[12px]">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
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
    <div
      role="list"
      aria-label="Étapes du formulaire"
      className="flex items-center gap-2"
    >
      <StepBubble
        n={1}
        label={t("sell.steps.details")}
        state={current === 1 ? "active" : "done"}
      />
      <span
        aria-hidden
        className={
          "h-0.5 flex-1 rounded-full transition " +
          (current === 2 ? "bg-[var(--gold)]" : "bg-[var(--border)]")
        }
      />
      <StepBubble
        n={2}
        label={t("sell.steps.options")}
        state={current === 2 ? "active" : "pending"}
      />
    </div>
  );
}

function StepBubble({
  n,
  label,
  state,
}: {
  n: number;
  label: string;
  state: "done" | "active" | "pending";
}) {
  const bubbleCls =
    state === "active"
      ? "batta-gradient-gold text-white shadow-[var(--shadow-gold)]"
      : state === "done"
        ? "bg-[var(--gold-faint)] text-[var(--gold)] ring-1 ring-[var(--gold-soft)]"
        : "bg-white text-[var(--foreground-muted)] ring-1 ring-[var(--border)]";
  const labelCls =
    state === "active"
      ? "text-[var(--gold)]"
      : state === "done"
        ? "text-[var(--foreground-muted)]"
        : "text-[var(--foreground-subtle)]";
  return (
    <div role="listitem" className="flex items-center gap-1.5">
      <span
        className={
          "inline-flex size-7 items-center justify-center rounded-full text-[12px] font-extrabold " +
          bubbleCls
        }
      >
        {state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : n}
      </span>
      <span
        className={
          "text-[11px] font-extrabold uppercase tracking-[0.14em] " + labelCls
        }
      >
        {label}
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

function ListingTypeOption({
  active, icon, label, sub, price, onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  sub: string;
  price: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "relative flex h-full flex-col rounded-2xl border p-4 text-start transition " +
        (active
          ? "border-[var(--gold)] bg-[var(--gold-faint)] shadow-[0_0_0_3px_var(--gold-faint),0_8px_20px_-12px_var(--gold-glow)]"
          : "border-[var(--border)] bg-white hover:border-[var(--gold-soft)] hover:shadow-sm")
      }
    >
      {/* Selected indicator — gold check pip in the top-right corner */}
      <span
        aria-hidden
        className={
          "absolute right-3 top-3 inline-flex size-5 items-center justify-center rounded-full transition " +
          (active
            ? "batta-gradient-gold text-white shadow-[var(--shadow-gold)]"
            : "border border-[var(--border)] bg-white")
        }
      >
        {active && <Check className="size-3" strokeWidth={3} />}
      </span>

      {/* Icon disc */}
      <span
        className={
          "inline-flex size-10 items-center justify-center rounded-full transition " +
          (active
            ? "batta-gradient-gold text-white shadow-[var(--shadow-gold)]"
            : "bg-[var(--gold-faint)] text-[var(--gold)]")
        }
      >
        {icon}
      </span>

      <span className="mt-3 text-[14px] font-extrabold leading-tight text-foreground">
        {label}
      </span>
      <p className="mt-1 text-[11.5px] leading-snug text-[var(--foreground-muted)]">
        {sub}
      </p>

      {/* Price chip pinned to the bottom — consistent baseline across the
          two cards even if `sub` wraps differently. */}
      <span
        className={
          "batta-tabular mt-3 inline-flex w-fit items-baseline gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold " +
          (active
            ? "bg-white text-[var(--gold)]"
            : "bg-[var(--gold-faint)] text-[var(--gold)]")
        }
      >
        {price.toFixed(2)}
        <span className="text-[9px] font-bold uppercase tracking-[0.12em] opacity-75">
          TND
        </span>
      </span>
    </button>
  );
}

// ─── Form primitives — light theme to match the rest of the app ────────

const FIELD_BASE =
  "mt-1.5 w-full rounded-xl border border-[var(--border)] bg-white px-3.5 py-3 text-[14px] text-foreground placeholder:text-[var(--foreground-subtle)] transition focus:border-[var(--gold)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-faint)]";

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
      <span className="text-[12px] font-semibold text-foreground">
        {label}{required && <span className="text-[var(--gold)]"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        dir={dir}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD_BASE}
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
      <span className="text-[12px] font-semibold text-foreground">{label}</span>
      <textarea
        rows={4}
        value={value}
        placeholder={placeholder}
        dir={dir}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD_BASE + " resize-none leading-relaxed"}
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
      <span className="text-[12px] font-semibold text-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD_BASE + " appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"12\" height=\"8\" viewBox=\"0 0 12 8\" fill=\"none\"><path d=\"M1 1L6 6L11 1\" stroke=\"%23737070\" stroke-width=\"1.6\" stroke-linecap=\"round\"/></svg>')] bg-[length:12px_8px] bg-no-repeat pr-9 [background-position:right_14px_center]"}
      >
        {children}
      </select>
    </label>
  );
}

// Section card — groups related fields under an eyebrow label. Makes
// the long sell form scannable by chunking it into 4-5 stations the
// seller can mentally check off.
function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm sm:p-5">
      <header className="mb-3.5">
        <h3 className="text-[13.5px] font-extrabold leading-tight text-foreground">
          {title}
        </h3>
        {hint && (
          <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--foreground-muted)]">
            {hint}
          </p>
        )}
      </header>
      <div className="space-y-3.5">{children}</div>
    </section>
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
  const filled = !!file;
  return (
    <div
      className={
        "rounded-xl border bg-white p-3.5 transition " +
        (filled
          ? "border-emerald-300 bg-emerald-50/30"
          : "border-dashed border-[var(--border)]")
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-bold text-foreground">
              {kind.label}
            </span>
            {kind.required ? (
              <span className="inline-flex items-center rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.12em] text-red-600 ring-1 ring-red-200">
                Requis
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-muted)]">
                Optionnel
              </span>
            )}
            {filled && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.12em] text-emerald-700">
                <Check className="size-2.5" strokeWidth={3} />
                Téléversé
              </span>
            )}
          </div>
          {kind.description && (
            <p className="mt-1 text-[11.5px] leading-snug text-[var(--foreground-muted)]">
              {kind.description}
            </p>
          )}
        </div>
        {filled && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-red-500 transition hover:bg-red-50"
            aria-label="Supprimer le fichier"
          >
            <Trash2 className="size-4" strokeWidth={2.2} />
          </button>
        )}
      </div>

      {filled ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-3 py-2">
          <FileText className="size-4 shrink-0 text-[var(--gold)]" strokeWidth={2} />
          <span className="batta-tabular flex-1 truncate text-[12px] font-semibold text-foreground">
            {file!.name}
          </span>
          <span className="text-[10px] text-[var(--foreground-muted)]">
            {(file!.size / 1024).toFixed(0)} KB
          </span>
        </div>
      ) : (
        <label className="tap-target mt-3 inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-[var(--gold-soft)] bg-[var(--gold-faint)] px-3 py-2.5 text-[12.5px] font-bold text-[var(--gold)] transition hover:border-[var(--gold)] hover:bg-[var(--gold-faint)]/80">
          <Upload className="size-4" strokeWidth={2.2} />
          Téléverser un fichier
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
