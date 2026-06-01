"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { optimizeImage } from "@/lib/optimizeImage";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { resolveListingFee, describeFee } from "@/lib/pricing";
import { log } from "@/lib/log";
import type { PropertyType, AttributeKind } from "@/lib/types";
import type { RejectionCategory, RejectionMode } from "@/lib/rejection";

const plog = log.scope("sell");
import {
  Camera,
  FileText,
  Trash2,
  CheckCircle2,
  Upload,
  Check,
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

// Canonical keys that mirror out to dedicated `properties` columns so the
// explore filters and listing cards (which query these columns directly)
// keep working. Every other attribute lives only inside the JSONB bag.
const CANONICAL_KEYS = ["area_sqm", "rooms", "bathrooms", "floor", "year_built"] as const;

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
  feeAuction: { mode: "free" | "fixed" | "percent"; value: number };
  feeDirect: { mode: "free" | "fixed" | "percent"; value: number };
  promoHome: { enabled: boolean; value: number };
  promoTop: { enabled: boolean; value: number };
  promoBanner: { enabled: boolean; value: number };
};

export type SellFormInitial = {
  id: string;
  title: string;
  description: string | null;
  type: PropertyType;
  attributes: Record<string, string | number | boolean>;
  governorate: string;
  address: string | null;
  listing_type: ListingType;
  sale_price: number | null;
  sale_negotiable: boolean;
  /** Photos already uploaded for this listing, surfaced in the gallery
   *  so the seller can see what's there and remove individual ones
   *  instead of staring at "Photos · 0/10" on every edit visit. */
  existingPhotos?: { id: string; storage_path: string; sort_order: number }[];
  /** True when the seller is re-submitting a rejected listing. The
   *  carry-over rule doesn't apply — the previous listing-fee payment
   *  was auto-failed when the admin refused, so save must re-initiate
   *  a fresh payment and route to /payment/checkout. */
  wasRejected?: boolean;
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
  focusCategories,
  focusMode,
}: {
  initial?: SellFormInitial;
  pricing: SellFormPricing;
  /** When the seller arrives from a rejection notification, the edit
   *  page passes through every rejection category the admin flagged
   *  so the form can ring-highlight ALL the sections to fix, not just
   *  one. Scroll target is the first one in the array. */
  focusCategories?: RejectionCategory[];
  /** "focused" hides every Section that isn't in focusCategories so
   *  the seller only sees the blocks they need to fix. "full" renders
   *  the entire form with the flagged sections ring-highlighted. The
   *  seller can flip from focused → full themselves via the toggle
   *  at the top of the form. */
  focusMode?: RejectionMode;
}) {
  const t = useTranslations();
  const router = useRouter();
  const { toast } = useToast();
  const isEdit = !!initial;
  const ChevronNext = ChevronRight;

  // Map each rejection category onto the anchor id of the Section
  // that owns the field. A rejection can carry several categories at
  // once (e.g. photos + documents), so we collect them into a Set
  // and every matching Section gets ring-highlighted. The first
  // category is the scroll target so the seller lands at the top of
  // the first problem and can scan downward through the rest.
  function categoryToSection(c: RejectionCategory | undefined): string | null {
    switch (c) {
      case "photos":      return "section-photos";
      case "documents":   return "section-documents";
      case "address":     return "section-address";
      case "price":       return "section-price";
      case "description": return "section-info";
      case "title":       return "section-info";
      default:            return null;
    }
  }
  const focusedSectionIds = new Set<string>(
    (focusCategories ?? [])
      .map(categoryToSection)
      .filter((s): s is string => !!s),
  );
  const firstFocusedSectionId =
    focusCategories?.map(categoryToSection).find((s): s is string => !!s) ?? null;

  // Seller-side override. The admin picks focused/full, but if the
  // seller realises mid-fix they need to see another section, they
  // can flip to full here without leaving the page.
  const [sellerOverride, setSellerOverride] = useState<RejectionMode | null>(null);
  const effectiveMode: RejectionMode =
    sellerOverride ?? focusMode ?? "full";
  // Hide non-matching Sections only when:
  //   - we're in edit mode (no point on a new wizard with empty data)
  //   - admin picked focused mode (and seller hasn't overridden)
  //   - there's at least one matching section to keep visible
  const isFocusedView =
    isEdit && effectiveMode === "focused" && focusedSectionIds.size > 0;
  // Each `id` passed to Section determines whether it stays visible
  // in focused view. Sections without an id (e.g. Caractéristiques)
  // collapse in focused view since they aren't tied to a category —
  // the seller can flip to full if they need them.
  const isSectionVisible = (id: string | undefined): boolean =>
    !isFocusedView || (id ? focusedSectionIds.has(id) : false);

  useEffect(() => {
    // Edit mode only — new-listing wizard has its own step header,
    // and scrolling to step-2 content while the user is on step-1
    // would be jarring (and visually impossible — the section isn't
    // mounted yet).
    if (!isEdit || !firstFocusedSectionId) return;
    const el = document.getElementById(firstFocusedSectionId);
    if (!el) return;
    // Defer past the next paint so the page chrome is laid out
    // before we scroll; otherwise the target sits half-hidden under
    // the sticky TopBar.
    const tid = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(tid);
  }, [isEdit, firstFocusedSectionId]);

  // ─── Field state ─────────────────────────────────────────────────────
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [type, setType] = useState<PropertyType>(initial?.type ?? "apartment");

  // Per-type characteristics — the field catalog is admin-controlled and
  // fetched from property_attribute_kinds whenever `type` changes (see the
  // effect below). Values are kept as strings (number/text/select inputs)
  // or booleans (checkboxes), keyed by field_key, and assembled into the
  // attributes JSONB on submit.
  const [attrKinds, setAttrKinds] = useState<AttributeKind[]>([]);
  const [attrKindsLoading, setAttrKindsLoading] = useState(true);
  const [attrValues, setAttrValues] = useState<Record<string, string | boolean>>(
    () => {
      const init: Record<string, string | boolean> = {};
      for (const [k, v] of Object.entries(initial?.attributes ?? {})) {
        init[k] = typeof v === "boolean" ? v : String(v);
      }
      return init;
    },
  );
  const setAttr = (key: string, value: string | boolean) =>
    setAttrValues((prev) => ({ ...prev, [key]: value }));

  const [governorate, setGovernorate] = useState(initial?.governorate ?? "Tunis");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [photos, setPhotos] = useState<File[]>([]);
  // True while HEIC→JPEG conversion runs after a pick, so we can show a
  // spinner and block submit until the previews are ready.
  const [photoBusy, setPhotoBusy] = useState(false);
  // Photos already on storage for this listing (edit mode). Rendered in
  // the gallery first, so the seller sees what's there. Trashing one
  // moves its id into removedExistingPhotoIds; on submit those rows are
  // deleted from property_photos + the storage object is removed.
  const [existingPhotos, setExistingPhotos] = useState(
    initial?.existingPhotos ?? [],
  );
  const [removedExistingPhotoIds, setRemovedExistingPhotoIds] = useState<
    Set<string>
  >(() => new Set());
  const visibleExistingPhotos = existingPhotos.filter(
    (p) => !removedExistingPhotoIds.has(p.id),
  );
  const totalPhotoCount = visibleExistingPhotos.length + photos.length;

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
  // New listings run a 3-step wizard (1 details · 2 media · 3 options);
  // edit mode renders every section on a single page.
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [promoHome, setPromoHome] = useState(false);
  const [promoTop, setPromoTop] = useState(false);
  const [promoBanner, setPromoBanner] = useState(false);

  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Resume-on-retry: the first half of doSubmit creates a property row,
  // then uploads photos/docs, then kicks off payment. If anything past
  // the property insert throws (storage outage, RLS, network blip), we
  // remember the propertyId so the next submit UPDATEs the same row
  // instead of creating a second ghost property. Same logic for photos
  // and docs — we mark which uploads already succeeded so a retry only
  // does the work that's still missing.
  const [resumeState, setResumeState] = useState<{
    propertyId: string | null;
    uploadedPhotoPaths: { storage_path: string; sort_order: number }[];
    uploadedDocPaths: { kindId: string; storage_path: string; kind: string }[];
  }>({ propertyId: null, uploadedPhotoPaths: [], uploadedDocPaths: [] });

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

  // Fetch the admin-controlled characteristics catalog for the selected
  // type. Refetches on type change and prunes any captured value whose
  // field no longer applies (so a stale "3 bathrooms" doesn't follow the
  // user from apartment → land).
  useEffect(() => {
    let cancelled = false;
    setAttrKindsLoading(true);
    const supabase = getBrowserSupabase();
    supabase
      .from("property_attribute_kinds")
      .select(
        "id, property_type, field_key, label, data_type, options, unit, required, sort_order",
      )
      .eq("property_type", type)
      .order("sort_order")
      .order("label")
      .then(({ data }: { data: AttributeKind[] | null }) => {
        if (cancelled) return;
        const kinds = data ?? [];
        setAttrKinds(kinds);
        setAttrValues((prev) => {
          const allowed = new Set(kinds.map((k) => k.field_key));
          const next: Record<string, string | boolean> = {};
          for (const [k, v] of Object.entries(prev)) {
            if (allowed.has(k)) next[k] = v;
          }
          return next;
        });
        setAttrKindsLoading(false);
      });
    return () => { cancelled = true; };
  }, [type]);

  // Previews as data URLs (base64) rather than object URLs. Object URLs need
  // revocation, and the revoke/recreate dance is fragile under React Strict
  // Mode's dev double-mount (the URL gets freed while the <img> still points
  // at it → broken thumbnail). Data URLs are plain strings: nothing to revoke,
  // Strict-Mode-safe, and they render whatever the browser can decode (HEIC is
  // already converted to JPEG in addPhotos before it lands in `photos`).
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    const readAsDataUrl = (f: File) =>
      new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
        reader.onerror = () => {
          plog.error("FileReader failed", { name: f.name, type: f.type || "(empty)" });
          resolve("");
        };
        reader.readAsDataURL(f);
      });
    Promise.all(photos.map(readAsDataUrl)).then((urls) => {
      if (!cancelled) setPhotoUrls(urls);
    });
    return () => {
      cancelled = true;
    };
  }, [photos]);

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const incoming = Array.from(files);
    plog.info("photos picked", { count: incoming.length });
    for (const f of incoming) {
      plog.debug("picked file", {
        name: f.name,
        type: f.type || "(empty)",
        sizeKB: Math.round(f.size / 1024),
      });
    }
    // Accept anything the browser tags as an image. Many mobile pickers
    // (and some HEIC/HEIF captures) hand us a File with an EMPTY type —
    // rejecting those was why "nothing showed up". Fall back to the file
    // extension so those still come through; only genuinely non-image
    // files (a .pdf, a .docx) get dropped.
    const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|hei[cf]|avif|tiff?)$/i;
    const isImage = (f: File) =>
      f.type.startsWith("image/") || (f.type === "" && IMAGE_EXT.test(f.name));
    const valid = incoming.filter(isImage);
    if (incoming.length !== valid.length) {
      plog.warn("non-image files dropped", { dropped: incoming.length - valid.length });
      toast("Seules les images sont acceptées — les fichiers non-image ont été ignorés.", "warning");
    }
    if (valid.length === 0) {
      plog.warn("no valid image files in selection");
      return;
    }

    // Optimize up front: HEIC → WebP server-side, others compressed on-device.
    // The result is a small WebP that previews AND uploads directly (no second
    // pass at submit time), so it's the only conversion the photo ever needs.
    setPhotoBusy(true);
    const done = plog.time("optimize batch");
    let converted: File[];
    try {
      // q72 matches the optimizeImage default — AVIF at this quality is
      // visually indistinguishable from q80 on listing thumbnails and
      // ~15% lighter on the wire. The bump to 80 here was historical
      // (set when listings still re-encoded server-side at q60).
      converted = await Promise.all(
        valid.map((f) => optimizeImage(f, { maxEdge: 1600, quality: 72 })),
      );
    } catch (e) {
      plog.error("photo optimize batch threw", e);
      converted = valid;
    } finally {
      setPhotoBusy(false);
      done();
    }
    for (const f of converted) {
      plog.debug("converted file", {
        name: f.name,
        type: f.type || "(empty)",
        sizeKB: Math.round(f.size / 1024),
      });
    }

    // Cap is total photos (existing on storage + newly picked), so we
    // don't let the seller stage 10 new ones on top of 4 existing ones.
    const existingCount = visibleExistingPhotos.length;
    const projected = existingCount + photos.length + converted.length;
    if (projected > 10) {
      toast(`Maximum 10 photos — ${projected - 10} fichier(s) en trop ignoré(s).`, "warning");
    }
    setPhotos((prev) => {
      const room = Math.max(0, 10 - existingCount);
      const next = [...prev, ...converted].slice(0, room);
      plog.info("photos state updated", { total: next.length });
      return next;
    });
  }

  function setDocFile(kindId: string, file: File | null) {
    setDocFiles((prev) => {
      const next = { ...prev };
      if (file) next[kindId] = file;
      else delete next[kindId];
      return next;
    });
  }

  // Image-format legal docs (titre foncier photo, CIN scan, etc.) often
  // land as 3-5 MB iPhone HEIC captures that the admin can't even render.
  // Run them through the same optimizer the listing photos use, with a
  // higher-quality WebP preset (text + stamps must stay legible). PDFs
  // are passed straight through — already structured + small enough.
  async function pickDocFile(kindId: string, file: File | null) {
    if (!file) {
      setDocFile(kindId, null);
      return;
    }
    const isImage =
      file.type.startsWith("image/") ||
      /\.(jpe?g|png|webp|gif|hei[cf]|avif|tiff?)$/i.test(file.name);
    if (!isImage) {
      setDocFile(kindId, file);
      return;
    }
    const done = plog.time(`doc optimize ${file.name}`);
    try {
      const out = await optimizeImage(file, {
        maxEdge: 2000,
        quality: 86,
        format: "webp",
      });
      setDocFile(kindId, out);
    } catch (e) {
      plog.error("doc optimize threw — using original", e);
      setDocFile(kindId, file);
    } finally {
      done();
    }
  }

  // ─── Totals ──────────────────────────────────────────────────────────
  // Admin-tunable (free / fixed / percent). For a direct offer the percent
  // base is the seller's sale price; auctions have no price yet so percent
  // resolves to 0 (admin restricts auctions to free/fixed anyway).
  const baseFee =
    listingType === "direct"
      ? resolveListingFee(pricing.feeDirect, salePrice ? Number(salePrice) : null)
      : resolveListingFee(pricing.feeAuction, null);
  // Only promos the admin left enabled count toward the total.
  const homeFee = promoHome && pricing.promoHome.enabled ? pricing.promoHome.value : 0;
  const topFee = promoTop && pricing.promoTop.enabled ? pricing.promoTop.value : 0;
  const bannerFee = promoBanner && pricing.promoBanner.enabled ? pricing.promoBanner.value : 0;
  const total = useMemo(() => {
    return baseFee + homeFee + topFee + bannerFee;
  }, [baseFee, homeFee, topFee, bannerFee]);

  // ─── Step-1 validation (advance to promos, or submit in edit mode) ───
  // Length caps mirror the DB column maxima (title varchar, description
  // and address text). We clamp client-side so the user sees a friendly
  // message instead of a Postgres "value too long" 500 after waiting
  // for photos to upload.
  const TITLE_MAX = 140;
  const DESCRIPTION_MAX = 4000;
  const ADDRESS_MAX = 300;
  // Step 1 — the property itself: type, copy, characteristics, location.
  function validateStep1(): string | null {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return t("sell.form.errorTitleRequired");
    if (trimmedTitle.length > TITLE_MAX) {
      return `Le titre est trop long (max ${TITLE_MAX} caractères).`;
    }
    if (description.length > DESCRIPTION_MAX) {
      return `La description est trop longue (max ${DESCRIPTION_MAX} caractères).`;
    }
    if (address.length > ADDRESS_MAX) {
      return `L'adresse est trop longue (max ${ADDRESS_MAX} caractères).`;
    }
    if (listingType === "direct") {
      const p = Number(salePrice);
      if (!p || p <= 0) return "Veuillez indiquer un prix de vente valide.";
      if (p > 1_000_000_000) {
        return "Le prix de vente est invalide.";
      }
    }
    // Required + value-constrained characteristics. Field labels come from
    // the admin catalog, so messages stay correct as the catalog changes.
    for (const k of attrKinds) {
      const v = attrValues[k.field_key];
      const empty =
        k.data_type === "boolean"
          ? v !== true
          : v == null || String(v).trim() === "";
      if (k.required && empty) {
        return `${k.label} est requis.`;
      }
      // The five canonical keys map to DB CHECK-constrained columns; catch
      // out-of-range values here instead of after the photo upload.
      if (!empty && k.data_type === "number") {
        const n = Number(v);
        if (!Number.isFinite(n)) return `${k.label} doit être un nombre.`;
        if (k.field_key === "area_sqm" && n <= 0) {
          return `${k.label} doit être supérieure à 0.`;
        }
        if (k.field_key === "year_built" && (n < 1800 || n > 2100)) {
          return `${k.label} doit être comprise entre 1800 et 2100.`;
        }
      }
    }
    return null;
  }

  // Step 2 — media: at least one photo + every required legal doc. Edit
  // mode never re-requires these (the listing already has them on file).
  function validateStep2(): string | null {
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

  // Single submit handler for the details/media form. In edit mode it
  // validates everything and saves; in new mode it advances the wizard.
  function onFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isEdit) {
      const err = validateStep1() ?? validateStep2();
      if (err) { toast(err, "error"); return; }
      void doSubmit();
      return;
    }
    if (step === 1) {
      const err = validateStep1();
      if (err) { toast(err, "error"); return; }
      setStep(2);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    // step === 2 → on to options & payment.
    const err = validateStep2();
    if (err) { toast(err, "error"); return; }
    setStep(3);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function onFinalSubmit(e: React.FormEvent) {
    e.preventDefault();
    void doSubmit();
  }

  async function doSubmit() {
    startTransition(async () => {
      const supabase = getBrowserSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast(t("sell.form.errorNotSignedIn"), "error"); return; }

      try {
        // 1. Create or update the property row.
        //    On retry (after a partial-failure error in step 2 or 3), we
        //    reuse the previously-created propertyId so we don't litter
        //    the DB with ghost rows. The resumeState ref preserves it
        //    across submissions in this session.
        let propId: string;
        // Listing-type guard rails for the DB CHECK constraint:
        // sale_price must be set when direct, must be NULL when auction.
        const isDirect = listingType === "direct";
        const salePriceVal = isDirect && salePrice ? Number(salePrice) : null;
        const saleNegotiableVal = isDirect ? saleNegotiable : false;

        // Assemble the attributes bag from the live catalog only — keys
        // not in attrKinds (stale values from a previous type) are dropped,
        // so a land listing never carries "3 bathrooms".
        const attributes: Record<string, string | number | boolean> = {};
        for (const k of attrKinds) {
          const raw = attrValues[k.field_key];
          if (k.data_type === "boolean") {
            if (raw === true) attributes[k.field_key] = true; // omit false
          } else if (k.data_type === "number") {
            if (raw != null && String(raw).trim() !== "") {
              const n = Number(raw);
              if (Number.isFinite(n)) attributes[k.field_key] = n;
            }
          } else if (typeof raw === "string" && raw.trim() !== "") {
            attributes[k.field_key] = raw.trim();
          }
        }

        // Mirror the canonical keys out to their dedicated columns so the
        // explore filters and listing cards keep working. Anything not
        // present in attributes resets the column to null.
        const mirror: Record<string, number | null> = {};
        for (const key of CANONICAL_KEYS) {
          const v = attributes[key];
          mirror[key] = typeof v === "number" ? v : null;
        }

        const propPayload = {
          title, description: description || null, type,
          ...mirror,
          attributes,
          governorate, address: address || null,
          listing_type: listingType,
          sale_price: salePriceVal,
          sale_negotiable: saleNegotiableVal,
          status: "pending_review" as const,
        };

        if (isEdit && initial) {
          const { error: uErr } = await supabase
            .from("properties")
            .update({ ...propPayload, rejection_reason: null })
            .eq("id", initial.id);
          if (uErr) throw new Error(uErr.message);
          propId = initial.id;
        } else if (resumeState.propertyId) {
          // Retry path — last attempt got past property insert but
          // failed on photos or docs. UPDATE so any field tweaked since
          // the previous attempt still gets persisted.
          const { error: uErr } = await supabase
            .from("properties")
            .update(propPayload)
            .eq("id", resumeState.propertyId);
          if (uErr) throw new Error(uErr.message);
          propId = resumeState.propertyId;
        } else {
          const { data: prop, error: pErr } = await supabase
            .from("properties")
            .insert({ owner_id: user.id, ...propPayload })
            .select("id")
            .single();
          if (pErr || !prop) throw new Error(pErr?.message ?? "property insert failed");
          propId = prop.id;
          // Remember it immediately so a crash between insert and photo
          // upload still lets us resume on the next submit.
          setResumeState((s) => ({ ...s, propertyId: propId }));
        }

        // 2a. Removed existing photos (edit mode only).
        //     Drop the property_photos rows + the storage objects. Done
        //     before the new uploads so a "remove + add to the same
        //     slot" cycle frees space first.
        if (isEdit && removedExistingPhotoIds.size > 0) {
          const removedIds = Array.from(removedExistingPhotoIds);
          const removedPaths = existingPhotos
            .filter((p) => removedExistingPhotoIds.has(p.id))
            .map((p) => p.storage_path);
          const { error: delRowErr } = await supabase
            .from("property_photos")
            .delete()
            .in("id", removedIds);
          if (delRowErr) throw new Error(`photo rows delete: ${delRowErr.message}`);
          if (removedPaths.length > 0) {
            // Storage delete is best-effort: if it fails we've already
            // detached the row in the DB, so the orphan is harmless
            // (no listing points at it). Don't block submit on a 404
            // from a path the bucket no longer has.
            await supabase.storage.from("properties").remove(removedPaths);
          }
        }

        // 2. Photos.
        //    Skip anything already uploaded in a previous attempt — we
        //    keep the list of (storage_path, sort_order) entries from
        //    successful uploads in resumeState.uploadedPhotoPaths.
        if (photos.length > 0) {
          const alreadyUploaded = resumeState.uploadedPhotoPaths;
          // In edit mode the property already has photos with sort_order
          // 0..N — start the new uploads after the highest existing one
          // so we don't collide on (property_id, sort_order) and so the
          // gallery order stays Cover → existing → newly added.
          const survivingExisting = existingPhotos.filter(
            (p) => !removedExistingPhotoIds.has(p.id),
          );
          const existingMax = survivingExisting.reduce(
            (m, p) => Math.max(m, p.sort_order),
            -1,
          );
          const baseSortOrder = isEdit ? existingMax + 1 : 0;
          const startIdx = alreadyUploaded.length;
          const remaining = photos.slice(startIdx);
          let newlyUploaded = [...alreadyUploaded];

          if (remaining.length > 0) {
            // Photos were already optimized to WebP when added, so upload
            // them as-is — no second compression pass.
            for (let i = 0; i < remaining.length; i++) {
              const file = remaining[i];
              const sortOrder = baseSortOrder + startIdx + i;
              const ext = file.name.split(".").pop()?.toLowerCase() || "webp";
              const path = `${user.id}/${propId}/photo-${Date.now()}-${sortOrder}.${ext}`;
              // Property photos are content-addressable (timestamp + sort
              // index in the path), never replaced. A 1-year cacheControl
              // lets Supabase's CDN hold them indefinitely; the optimizer
              // hashes content via filename so a re-upload at a new sort
              // index = new path = no cache collision.
              const { error } = await supabase.storage.from("properties").upload(path, file, {
                contentType: file.type,
                upsert: false,
                cacheControl: "31536000",
              });
              if (error) {
                // Persist progress so far before bubbling — next retry
                // resumes from this index instead of redoing everything.
                setResumeState((s) => ({ ...s, uploadedPhotoPaths: newlyUploaded }));
                throw new Error(`photo ${sortOrder}: ${error.message}`);
              }
              newlyUploaded = [...newlyUploaded, { storage_path: path, sort_order: sortOrder }];
            }
            setResumeState((s) => ({ ...s, uploadedPhotoPaths: newlyUploaded }));
          }

          // DB insert. property_photos has no natural unique constraint
          // we can rely on, so we use plain insert and clear the
          // "uploaded but not inserted" buffer right after success.
          // A retry that gets here will have an empty newlyUploaded
          // (cleared below) and become a no-op.
          if (newlyUploaded.length > 0) {
            const { error: photoInsertErr } = await supabase
              .from("property_photos")
              .insert(newlyUploaded.map((p) => ({ ...p, property_id: propId })));
            if (photoInsertErr) {
              throw new Error(`property_photos: ${photoInsertErr.message}`);
            }
            setResumeState((s) => ({ ...s, uploadedPhotoPaths: [] }));
          }
        }

        // 3. Docs — per-kind, label snapshot stored on property_documents.kind.
        const docEntries = Object.entries(docFiles);
        if (docEntries.length > 0) {
          const labelById = new Map(docKinds.map((k) => [k.id, k.label]));
          const uploadedKinds = new Set(
            resumeState.uploadedDocPaths.map((d) => d.kindId),
          );
          let newDocUploads = [...resumeState.uploadedDocPaths];

          for (let i = 0; i < docEntries.length; i++) {
            const [kindId, rawFile] = docEntries[i];
            if (uploadedKinds.has(kindId)) continue;
            // Image documents were already run through optimizeImage in
            // pickDocFile() with the document-quality preset; the previous
            // resubmit-time pass at q82/2200 just re-encoded WebP→WebP for
            // no real gain (each round of WebP encoding slightly degrades
            // the source). Upload the picked file as-is; PDFs were never
            // compressed and pass through here untouched too.
            const file = rawFile;
            const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
            const path = `${user.id}/${propId}/doc-${Date.now()}-${i}.${ext}`;
            const { error } = await supabase.storage
              .from("property-documents")
              .upload(path, file, { contentType: file.type, upsert: false });
            if (error) {
              setResumeState((s) => ({ ...s, uploadedDocPaths: newDocUploads }));
              throw new Error(`doc ${i}: ${error.message}`);
            }
            newDocUploads = [
              ...newDocUploads,
              { kindId, storage_path: path, kind: labelById.get(kindId) ?? "Autre" },
            ];
          }
          setResumeState((s) => ({ ...s, uploadedDocPaths: newDocUploads }));

          if (newDocUploads.length > 0) {
            const { error: docInsertErr } = await supabase
              .from("property_documents")
              .insert(
                newDocUploads.map((d) => ({
                  property_id: propId,
                  kind: d.kind,
                  storage_path: d.storage_path,
                })),
              );
            if (docInsertErr) {
              throw new Error(`property_documents: ${docInsertErr.message}`);
            }
            setResumeState((s) => ({ ...s, uploadedDocPaths: [] }));
          }
        }

        // 4. Edit mode: carry-over rule keeps the existing payment when
        //    the seller is just tweaking a live or pending listing. But
        //    a rejected→fix→re-submit cycle is different: the old
        //    payment was auto-failed in the rejection, so we MUST cut
        //    a new one and send the seller to checkout. Otherwise the
        //    listing sits in pending_review forever with no receipt
        //    attached and the admin queue can't act on it.
        if (isEdit && !initial?.wasRejected) {
          setSuccess(true);
          setTimeout(() => router.replace("/sell"), 2000);
          return;
        }

        // 5. New-mode (or rejected resubmit): initiate listing-fee payment,
        //    then redirect to checkout.
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
        const data = (await res.json()) as { paymentId?: string; free?: boolean };
        if (data.free || !data.paymentId) {
          // Posting is free (admin set it so) — nothing to pay; the listing
          // is already pending_review. Show success instead of checkout.
          setSuccess(true);
          setTimeout(() => router.replace("/sell"), 2000);
          return;
        }
        router.replace(
          `/payment/checkout?payment=${encodeURIComponent(data.paymentId)}` as `/payment/checkout`,
        );
      } catch (err) {
        toast(err instanceof Error ? err.message : "Échec de l'envoi.", "error");
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

  // ─── Step 3: Options & payment ─────────────────────────────────────────
  if (step === 3 && !isEdit) {
    return (
      <form onSubmit={onFinalSubmit} className="mt-5 space-y-4 lg:mt-0 lg:space-y-5">
        <StepHeader current={3} />
        <StationIntro index={3} title="Options & paiement" body={t("sell.promo.subtitle")} />

        {pricing.promoHome.enabled && (
          <PromoRow
            icon={<Star className="size-4" />}
            title={t("sell.promo.homeFeaturedTitle")}
            body={t("sell.promo.homeFeaturedBody")}
            price={pricing.promoHome.value}
            checked={promoHome}
            onChange={setPromoHome}
          />
        )}
        {pricing.promoTop.enabled && (
          <PromoRow
            icon={<ArrowUpToLine className="size-4" />}
            title={t("sell.promo.topListedTitle")}
            body={t("sell.promo.topListedBody")}
            price={pricing.promoTop.value}
            checked={promoTop}
            onChange={setPromoTop}
          />
        )}
        {pricing.promoBanner.enabled && (
          <PromoRow
            icon={<Megaphone className="size-4" />}
            title={t("sell.promo.bannerTitle")}
            body={t("sell.promo.bannerBody")}
            price={pricing.promoBanner.value}
            checked={promoBanner}
            onChange={setPromoBanner}
          />
        )}

        {/* Totals */}
        <div className="rounded-2xl border border-[var(--gold-soft)] bg-[var(--gold-faint)] p-4">
          <div className="flex items-baseline justify-between text-[12.5px]">
            <span className="text-[var(--foreground-muted)]">
              {listingType === "direct"
                ? "Frais — Offre directe"
                : t("sell.promo.baseFee")}
            </span>
            <span className="batta-tabular font-semibold text-foreground">
              {baseFee > 0 ? `${baseFee.toFixed(2)} TND` : "Gratuit"}
            </span>
          </div>
          {homeFee > 0 && (
            <PromoLine label={t("sell.promo.homeFeaturedShort")} price={homeFee} />
          )}
          {topFee > 0 && (
            <PromoLine label={t("sell.promo.topListedShort")} price={topFee} />
          )}
          {bannerFee > 0 && (
            <PromoLine label={t("sell.promo.bannerShort")} price={bannerFee} />
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

        <div className="mt-6 flex gap-2 lg:mt-7 lg:justify-between lg:border-t lg:border-border lg:pt-6">
          <button
            type="button"
            onClick={() => { setStep(2); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            disabled={isPending}
            className="tap-target inline-flex h-12 items-center justify-center gap-1.5 rounded-full border border-batta-gold/30 bg-batta-surface px-4 text-[13px] font-bold text-foreground disabled:opacity-50"
          >
            <ChevronLeft className="size-4" />
            {t("sell.promo.back")}
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="batta-btn-luxe tap-target flex-1 px-5 py-3.5 text-[13.5px] disabled:opacity-50 lg:flex-none lg:min-w-[240px]"
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

  // ─── Steps 1 & 2 (new mode) · or the single-page edit form ─────────────
  return (
    <form onSubmit={onFormSubmit} className="mt-5 space-y-4 lg:mt-0 lg:space-y-5">
      {!isEdit && <StepHeader current={step} />}
      {!isEdit && step === 1 && (
        <StationIntro
          index={1}
          title="Votre bien"
          body="Type de vente, informations, caractéristiques et emplacement."
        />
      )}
      {!isEdit && step === 2 && (
        <StationIntro
          index={2}
          title="Photos & documents"
          body="Des photos nettes et les pièces légales accélèrent la validation."
        />
      )}

      {/* Focus-mode toggle. Shown only when (a) we're in edit mode,
          (b) the admin tagged specific sections, (c) the rejection
          carried a mode preference at all. The seller can flip
          between "focused" (only marked sections) and "full" (whole
          form, highlights kept) so they're never trapped if they
          notice a related fix on the way. */}
      {isEdit && focusedSectionIds.size > 0 && focusMode && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--gold)]/40 bg-[var(--gold-faint)]/40 px-3 py-2.5">
          <span className="text-[12px] font-semibold text-foreground/85">
            {effectiveMode === "focused"
              ? `Affichage ciblé — ${focusedSectionIds.size} section${focusedSectionIds.size > 1 ? "s" : ""} à corriger.`
              : "Affichage complet — toutes les sections sont visibles."}
          </span>
          <button
            type="button"
            onClick={() => setSellerOverride(effectiveMode === "focused" ? "full" : "focused")}
            className="rounded-full bg-surface px-3 py-1 text-[11.5px] font-bold text-[var(--gold)] ring-1 ring-[var(--gold)]/40 hover:bg-[var(--gold)] hover:text-white"
          >
            {effectiveMode === "focused" ? "Voir l'annonce entière" : "Voir uniquement les sections marquées"}
          </button>
        </div>
      )}

      {(isEdit || step === 1) && (
      <>
      {/* 1. LISTING TYPE — first, because it changes downstream pricing
          and the schedule step. Big, obvious radio cards. */}
      <Section
        id="section-price"
        highlight={focusedSectionIds.has("section-price")}
        hidden={!isSectionVisible("section-price")}
        title="Type d'annonce"
        hint="Choisissez le mode de mise en vente. Les frais d'annonce sont indiqués sur chaque option."
      >
        <div className="grid grid-cols-2 gap-2.5">
          <ListingTypeOption
            active={listingType === "auction"}
            icon={<Gavel className="size-4" strokeWidth={2.2} />}
            label="Enchère"
            sub="Le prix monte avec les offres reçues."
            priceLabel={describeFee(pricing.feeAuction)}
            onClick={() => setListingType("auction")}
          />
          <ListingTypeOption
            active={listingType === "direct"}
            icon={<Tag className="size-4" strokeWidth={2.2} />}
            label="Offre directe"
            sub="Prix fixe, vente sans enchère."
            priceLabel={describeFee(pricing.feeDirect)}
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
        id="section-info"
        highlight={focusedSectionIds.has("section-info")}
        hidden={!isSectionVisible("section-info")}
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
        hidden={!isSectionVisible(undefined)}
        title="Caractéristiques"
        hint="Toutes ces informations apparaissent sur la fiche publique."
      >
        <Select
          label={t("sell.form.type")}
          value={type}
          onChange={(v) => setType(v as PropertyType)}
        >
          {TYPES.map((tp) => (
            <option key={tp} value={tp}>
              {t(`property.types.${tp}`)}
            </option>
          ))}
        </Select>

        {/* Characteristics fields are driven by the admin-controlled
            catalog (property_attribute_kinds) for the selected type.
            Number/text/select inputs flow through a 2-col grid; boolean
            toggles render as a separate chip row underneath. */}
        <AttributeFields
          loading={attrKindsLoading}
          kinds={attrKinds}
          values={attrValues}
          setValue={setAttr}
        />
      </Section>

      {/* 4. LOCALISATION */}
      <Section
        id="section-address"
        highlight={focusedSectionIds.has("section-address")}
        hidden={!isSectionVisible("section-address")}
        title="Localisation"
      >
        <div className="grid gap-3.5 lg:grid-cols-2">
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
          <Field
            label={t("sell.form.address")}
            value={address}
            onChange={setAddress}
          />
        </div>
      </Section>
      </>
      )}

      {(isEdit || step === 2) && (
      <>
      {/* 5. PHOTOS */}
      <Section
        id="section-photos"
        highlight={focusedSectionIds.has("section-photos")}
        hidden={!isSectionVisible("section-photos")}
        title={`${t("sell.form.photos")} · ${totalPhotoCount}/10`}
        hint={t("sell.form.photosHint")}
      >
        <div className="grid grid-cols-3 gap-2.5">
          {/* Existing photos first (edit mode). The cover badge sits on
              whichever tile is index 0 in the visible list, which is
              the first existing photo if any. */}
          {visibleExistingPhotos.map((ph, i) => (
            <div
              key={`existing-${ph.id}`}
              className="relative aspect-square overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] shadow-sm"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={propertyPhotoUrl(ph.storage_path)}
                alt=""
                className="size-full object-cover"
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent" />
              <button
                type="button"
                onClick={() =>
                  setRemovedExistingPhotoIds((s) => {
                    const next = new Set(s);
                    next.add(ph.id);
                    return next;
                  })
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
          {photos.map((file, i) => (
            <div
              key={i}
              className="relative aspect-square overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] shadow-sm"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {photoUrls[i] ? (
                <img
                  src={photoUrls[i]}
                  alt=""
                  className="size-full object-cover"
                  onLoad={() =>
                    plog.debug("preview loaded", { i, name: file.name })
                  }
                  onError={() =>
                    plog.error("preview FAILED to load", {
                      i,
                      name: file.name,
                      type: file.type || "(empty)",
                      sizeKB: Math.round(file.size / 1024),
                    })
                  }
                />
              ) : (
                <div className="flex size-full items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-[var(--foreground-subtle)]" />
                </div>
              )}
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
              {/* The cover is the first photo overall — an existing one
                  if any, otherwise the first new pick. */}
              {visibleExistingPhotos.length === 0 && i === 0 && (
                <span className="batta-gradient-gold absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.14em] text-white shadow-[var(--shadow-gold)]">
                  <Star className="size-2.5" strokeWidth={3} />
                  Couverture
                </span>
              )}
            </div>
          ))}
          {totalPhotoCount < 10 && (
            <label
              className={
                "tap-target flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-[var(--gold-soft)] bg-[var(--gold-faint)] text-[var(--gold)] transition hover:border-[var(--gold)] hover:bg-[var(--gold-faint)]/80 " +
                (photoBusy ? "pointer-events-none opacity-60" : "cursor-pointer")
              }
            >
              {photoBusy ? (
                <Loader2 className="size-6 animate-spin" strokeWidth={2} />
              ) : (
                <Camera className="size-6" strokeWidth={2} />
              )}
              <span className="text-[10px] font-bold uppercase tracking-[0.14em]">
                {photoBusy ? "Conversion…" : "Ajouter"}
              </span>
              <input
                type="file"
                accept="image/*,.heic,.heif"
                multiple
                disabled={photoBusy}
                className="hidden"
                onChange={(e) => {
                  void addPhotos(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
      </Section>

      {/* 6. DOCUMENTS */}
      <Section
        id="section-documents"
        highlight={focusedSectionIds.has("section-documents")}
        hidden={!isSectionVisible("section-documents")}
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
                onPick={(f) => { void pickDocFile(kind.id, f); }}
                onClear={() => setDocFile(kind.id, null)}
              />
            ))}
          </div>
        )}
      </Section>
      </>
      )}

      {/* Footer — sticky action bar. Edit mode saves; the wizard advances. */}
      {isEdit ? (
        <button
          type="submit"
          disabled={isPending}
          className="batta-btn-luxe tap-target mt-6 w-full px-5 py-3.5 text-[13.5px] disabled:opacity-50 lg:mt-7"
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {t("sell.saving")}
            </>
          ) : (
            t("sell.saveChanges")
          )}
        </button>
      ) : step === 1 ? (
        <button
          type="submit"
          disabled={isPending}
          className="batta-btn-luxe tap-target mt-6 w-full px-5 py-3.5 text-[13.5px] disabled:opacity-50 lg:mt-7"
        >
          Continuer · Photos
          <ChevronNext className="size-4" />
        </button>
      ) : (
        <div className="mt-6 flex gap-2 lg:mt-7 lg:justify-between lg:border-t lg:border-border lg:pt-6">
          <button
            type="button"
            onClick={() => { setStep(1); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            disabled={isPending}
            className="tap-target inline-flex h-12 items-center justify-center gap-1.5 rounded-full border border-batta-gold/30 bg-batta-surface px-4 text-[13px] font-bold text-foreground disabled:opacity-50"
          >
            <ChevronLeft className="size-4" />
            {t("sell.promo.back")}
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="batta-btn-luxe tap-target flex-1 px-5 py-3.5 text-[13.5px] disabled:opacity-50 lg:flex-none lg:min-w-[240px]"
          >
            {t("sell.form.continueToPromos")}
            <ChevronNext className="size-4" />
          </button>
        </div>
      )}
    </form>
  );
}

const STEP_LABELS = ["Détails", "Photos", "Options"] as const;

function StepHeader({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div
      role="list"
      aria-label="Étapes du formulaire"
      className="flex items-center gap-2"
    >
      {STEP_LABELS.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const state = current === n ? "active" : current > n ? "done" : "pending";
        return (
          <Fragment key={label}>
            {i > 0 && (
              <span
                aria-hidden
                className={
                  "h-0.5 flex-1 rounded-full transition " +
                  (current > i ? "bg-[var(--gold)]" : "bg-[var(--border)]")
                }
              />
            )}
            <StepBubble n={n} label={label} state={state} />
          </Fragment>
        );
      })}
    </div>
  );
}

// Per-step heading inside the wizard — an eyebrow ("Étape n sur 3"), a
// big title, and a one-line guide. Gives each station a clear identity.
function StationIntro({
  index,
  title,
  body,
}: {
  index: number;
  title: string;
  body?: string;
}) {
  return (
    <div>
      <span className="batta-eyebrow flex items-center gap-2">
        <span aria-hidden className="batta-gold-rule-short" />
        Étape {index} sur 3
      </span>
      <h2 className="mt-2 text-[19px] font-extrabold leading-tight text-foreground">
        {title}
      </h2>
      {body && (
        <p className="mt-1 text-[12px] leading-snug text-[var(--foreground-muted)]">
          {body}
        </p>
      )}
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
  active, icon, label, sub, priceLabel, onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  sub: string;
  priceLabel: string;
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
        {priceLabel}
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

// Renders the admin-defined characteristics for the selected property
// type. Numbers/text/selects flow through a 2-col grid; booleans render
// as a checkbox chip row below so the layout stays tidy regardless of how
// many fields the admin configured.
function AttributeFields({
  loading,
  kinds,
  values,
  setValue,
}: {
  loading: boolean;
  kinds: AttributeKind[];
  values: Record<string, string | boolean>;
  setValue: (key: string, value: string | boolean) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-2.5 text-[12px] text-[var(--foreground-muted)]">
        <Loader2 className="size-3.5 animate-spin" />
        Chargement des caractéristiques…
      </div>
    );
  }
  if (kinds.length === 0) {
    return (
      <p className="rounded-xl bg-[var(--surface-2)] px-3 py-2.5 text-[12px] text-[var(--foreground-muted)]">
        Aucune caractéristique configurée pour ce type de bien.
      </p>
    );
  }

  const inputKinds = kinds.filter((k) => k.data_type !== "boolean");
  const boolKinds = kinds.filter((k) => k.data_type === "boolean");

  return (
    <>
      {inputKinds.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {inputKinds.map((k) => {
            const label = k.unit ? `${k.label} (${k.unit})` : k.label;
            const value = typeof values[k.field_key] === "string"
              ? (values[k.field_key] as string)
              : "";
            if (k.data_type === "select") {
              return (
                <Select
                  key={k.id}
                  label={label}
                  value={value}
                  onChange={(v) => setValue(k.field_key, v)}
                >
                  <option value="">—</option>
                  {(k.options ?? []).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              );
            }
            return (
              <Field
                key={k.id}
                label={label}
                type={k.data_type === "number" ? "number" : "text"}
                required={k.required}
                value={value}
                onChange={(v) => setValue(k.field_key, v)}
              />
            );
          })}
        </div>
      )}

      {boolKinds.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {boolKinds.map((k) => {
            const checked = values[k.field_key] === true;
            return (
              <label
                key={k.id}
                className={
                  "inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition " +
                  (checked
                    ? "border-[var(--gold)] bg-[var(--gold-faint)] text-foreground"
                    : "border-[var(--border)] bg-white text-[var(--foreground-muted)]")
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setValue(k.field_key, e.target.checked)}
                  className="size-4 rounded border-[var(--border)] accent-[var(--gold)]"
                />
                {k.label}
              </label>
            );
          })}
        </div>
      )}
    </>
  );
}

// Section card — groups related fields under an eyebrow label. Makes
// the long sell form scannable by chunking it into 4-5 stations the
// seller can mentally check off.
function Section({
  id,
  title,
  hint,
  highlight,
  hidden,
  children,
}: {
  id?: string;
  title: string;
  hint?: string;
  /** True when this section is the rejection-focus target. Adds a
   *  gold ring + a small "À corriger" badge so the seller can't miss
   *  which area the admin asked them to fix. */
  highlight?: boolean;
  /** True when the seller's view is focused on other sections and
   *  this one should collapse entirely. The form re-mounts when the
   *  prop flips so internal state survives the seller toggling
   *  between focused and full views. */
  hidden?: boolean;
  children: React.ReactNode;
}) {
  if (hidden) return null;
  return (
    <section
      id={id}
      className={`rounded-2xl border bg-white p-5 transition sm:p-6 ${
        highlight
          ? "border-[var(--gold)] ring-2 ring-[var(--gold)]/30"
          : "border-black/[0.07]"
      }`}
    >
      <header className="mb-3.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13.5px] font-extrabold leading-tight text-foreground">
            {title}
          </h3>
          {highlight && (
            <span className="shrink-0 rounded-full bg-[var(--gold-faint)] px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[var(--gold-bright)] ring-1 ring-[var(--gold)]/40">
              À corriger
            </span>
          )}
        </div>
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
