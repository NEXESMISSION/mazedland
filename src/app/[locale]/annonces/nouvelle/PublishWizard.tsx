"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useApiError } from "@/lib/useApiError";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { PhotoUploader, type UploadedPhoto } from "@/components/listing/PhotoUploader";
import { ListingImage } from "@/components/media/ListingImage";
import { Ltr } from "@/components/ui/Ltr";
import { formatTND, formatDate, cn } from "@/lib/utils";
import { TUNISIAN_GOVERNORATES, governorateLabel } from "@/lib/tunisia";
import {
  Check, Tag, Camera, Wallet, Phone, ClipboardList, ClipboardCheck, Loader2, MapPin,
  Gift, Ticket, ImageOff, Home, ArrowLeft, ArrowRight, Lightbulb, CheckCircle2, AlertTriangle, Pencil,
  KeyRound,
} from "lucide-react";
import {
  MIN_PHOTOS,
  hasContactInText,
  isPriceImplausible,
  type CategoryKind,
} from "@/lib/moderation/rules";
import {
  FURNISHED,
  appliesTo,
  asDealType,
  firstMonthCost,
  type DealType,
  type Furnished,
} from "@/lib/listings/deal";

/**
 * Publier une annonce — the sell-or-let flow.
 *
 * Selling and letting share the form (0166): the first step asks which, and
 * only the price step differs — a rental gives its monthly rent with the
 * deposit, charges, furniture, the date it is free and the shortest lease, and
 * the summary adds what moving in costs. The catalogue questions that only one
 * deal asks (« titre foncier » is a buyer's question) drop out of the other.
 *
 * Four short steps — what and where, photos, price and details, summary — with
 * a progress bar that is also a way back to any step. It used to be one long
 * page; on a phone that read as a wall of questions, and the seller never saw
 * their annonce as a buyer would before sending it. The summary does that: the
 * card a buyer will see, every answer with "Modifier" next to it, and the same
 * rules the moderation applies (src/lib/moderation/rules.ts) said first, as
 * tips, so a seller fixes them here instead of waiting on a reviewer.
 *
 * "Continuer" only checks the step on screen, and never waits for photos still
 * uploading — they finish in the background while the rest is typed. Every
 * answer is still reachable from the summary, so nothing is a dead end.
 *
 * The decisions worth keeping from Mazed Auto's version, which this follows:
 *
 *   • Photos come SECOND, not last. They are the slow part and the part the
 *     seller already has in their hand, so they upload in the background while
 *     the rest is typed.
 *   • The title is proposed from what was just entered — nobody wants to type
 *     "Appartement S+2 · 120 m² · La Marsa" after choosing exactly that — and
 *     stays editable, at which point the suggestion stops chasing them.
 *   • Errors sit under the field and in a list at the end, each line a shortcut
 *     to the field. A toast that vanishes, pointing at nothing, is not an error
 *     message.
 *   • The last section previews the exact card a buyer will see.
 *   • The draft autosaves 1.5 s after you stop typing, so a lost connection
 *     costs the current screen and nothing else.
 *
 * The one structural difference: the details section is generated from
 * `category_attributes`. Auto hardcodes its vehicle questions because free text
 * in `make` breaks its filters; here the questions genuinely differ per
 * category — a terrain has no bathrooms, a dépôt has no floor — and an admin
 * can add one from /admin/catalogue without a deploy.
 */

/**
 * The attestation the seller ticks lives in messages as `publish.attestation`.
 * Bump the version whenever its wording changes, in either language.
 */
export const SELLER_ATTESTATION_VERSION = "v2";

export type WizardCategory = {
  id: string;
  slug: string;
  label: string;
  groupId: string;
  groupLabel: string;
  /** residential | land | commercial — the summary's price check uses it. */
  kind: string;
};

const STEPS = ["where", "photos", "details", "review"] as const;
type Step = 0 | 1 | 2 | 3;

/** Which step each field lives on, so "missing" and "Modifier" land there. */
const STEP_OF: Record<string, Step> = {
  "f-category": 0,
  "f-photos": 1,
  "f-price": 2,
  "f-rent": 2,
  "f-title": 2,
  "f-details": 2,
  "f-description": 2,
  "f-phone": 3,
  "f-contact": 3,
};

/** One question, as `/admin/catalogue` defines it. */
export type AttributeDef = {
  field_key: string;
  label: string;
  data_type: string;
  options: { value: string; label: string }[] | null;
  unit: string | null;
  required: boolean;
  /** 0166: asked only for these deals; null = both. */
  deal_types?: string[] | null;
};

/**
 * A draft the seller already started, loaded server-side.
 *
 * Publishing a property is a five-minute job on a phone, and five minutes is
 * long enough for a call to come in, a battery to die, or a back gesture to
 * land by accident.
 */
export type InitialDraft = {
  id: string;
  category_id: string | null;
  title: string | null;
  description: string | null;
  price: number | string | null;
  price_on_request: boolean | null;
  negotiable: boolean | null;
  governorate: string | null;
  delegation: string | null;
  attributes: Record<string, unknown> | null;
  contact_name: string | null;
  contact_phone: string | null;
  updated_at: string | null;
  photos: { storage_path: string; sort_order: number }[] | null;
  deal_type?: string | null;
  deposit_amount?: number | string | null;
  charges_amount?: number | string | null;
  furnished?: string | null;
  available_from?: string | null;
  min_lease_months?: number | null;
};

export function PublishWizard({
  categories,
  groups,
  attributesByCategory,
  feeByCategory,
  creditsLeft,
  freePlacesLeft,
  freeLimit,
  defaultContactName,
  defaultContactPhone,
  defaultGovernorate,
  initialDraft,
  initialDeal = "sale",
  locale,
}: {
  categories: WizardCategory[];
  groups: { id: string; label: string }[];
  attributesByCategory: Record<string, AttributeDef[]>;
  feeByCategory: Record<string, number | null>;
  creditsLeft: number;
  /** Free places left (0165): while > 0 the publication costs nothing. */
  freePlacesLeft: number;
  freeLimit: number;
  defaultContactName: string;
  defaultContactPhone: string;
  /** From the seller's profile — signup asks for it, so the form should not
   *  ask again. Empty for an older account that never gave one. */
  defaultGovernorate: string;
  initialDraft: InitialDraft | null;
  /** ?deal=rent — the home page's « J'ai un bien à louer » lands here. */
  initialDeal?: DealType;
  locale: string;
}) {
  const d = initialDraft;
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const t = useTranslations("publish");
  const tc = useTranslations("common");

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<"idle" | "saving" | "ok">("idle");
  const [listingId, setListingId] = useState<string | null>(d?.id ?? null);
  const [done, setDone] = useState<null | {
    paidWith: string;
    remaining?: number;
    /** "published" when the rules let it straight online; else "pending_review". */
    status: string;
    id: string;
  }>(null);

  const [categoryId, setCategoryId] = useState<string | null>(d?.category_id ?? null);
  const [photos, setPhotos] = useState<UploadedPhoto[]>(() =>
    (d?.photos ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((x) => ({ path: x.storage_path })),
  );
  const [photosUploading, setPhotosUploading] = useState(0);

  /**
   * Fields the seller asked to be shown, from the "il manque…" list. Kept as
   * ids rather than a boolean so only what they actually tapped goes red.
   */
  const [flagged, setFlagged] = useState<string[]>([]);

  const [attrs, setAttrs] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(d?.attributes ?? {})
        // Migration bookkeeping (_expiry_warned and friends) is not something
        // to put back in a form.
        .filter(([k, v]) => !k.startsWith("_") && v != null)
        .map(([k, v]) => [k, String(v)]),
    ),
  );

  const [typedTitle, setTypedTitle] = useState(d?.title && d.title !== "Brouillon" ? d.title : "");
  const [titleTouched, setTitleTouched] = useState(Boolean(d?.title && d.title !== "Brouillon"));
  const [description, setDescription] = useState(d?.description ?? "");
  const [price, setPrice] = useState(d?.price != null && Number(d.price) > 0 ? String(d.price) : "");
  const [onRequest, setOnRequest] = useState(d?.price_on_request === true);
  const [negotiable, setNegotiable] = useState(d?.negotiable !== false);
  // Sale or rent (0166). A resumed draft says which; a new one starts from
  // where the seller came from.
  const [deal, setDeal] = useState<DealType>(d ? asDealType(d.deal_type) : initialDeal);
  const [deposit, setDeposit] = useState(d?.deposit_amount != null ? String(d.deposit_amount) : "");
  const [charges, setCharges] = useState(d?.charges_amount != null ? String(d.charges_amount) : "");
  const [furnished, setFurnished] = useState<Furnished | "">(() =>
    (FURNISHED as readonly string[]).includes(d?.furnished ?? "") ? (d?.furnished as Furnished) : "",
  );
  const [availableFrom, setAvailableFrom] = useState(d?.available_from ?? "");
  const [minLease, setMinLease] = useState(d?.min_lease_months != null ? String(d.min_lease_months) : "");
  const rent = deal === "rent";
  // Where the seller lives, not the first governorate in the alphabet. Most
  // people sell property in their own governorate, and "Ariana" was pre-filled
  // for all 24 of them — a wrong default nobody is prompted to correct, which
  // is worse than an empty field.
  const homeGovernorate = (TUNISIAN_GOVERNORATES as readonly string[]).includes(defaultGovernorate)
    ? defaultGovernorate
    : TUNISIAN_GOVERNORATES[0];
  const [governorate, setGovernorate] = useState<string>(d?.governorate ?? homeGovernorate);
  const [delegation, setDelegation] = useState(d?.delegation ?? "");
  const [contactName, setContactName] = useState(d?.contact_name ?? defaultContactName);
  const [contactPhone, setContactPhone] = useState(d?.contact_phone ?? defaultContactPhone);
  const [attested, setAttested] = useState(false);
  const [resumed, setResumed] = useState(Boolean(d));
  // A resumed draft opens where it was left: the first step still missing
  // something, or the summary.
  const [step, setStep] = useState<Step>(() => {
    if (!d?.category_id) return 0;
    if (!(d.photos?.length)) return 1;
    if (!d.price_on_request && !(Number(d.price) > 0)) return 2;
    return 3;
  });

  // Which group's chips are showing. Seeded from the draft so a resumed terrain
  // does not come back on the Résidentiel side.
  const [groupId, setGroupId] = useState<string>(() => {
    const c = categories.find((x) => x.id === (d?.category_id ?? null));
    return c?.groupId ?? groups[0]?.id ?? "";
  });

  const category = categories.find((c) => c.id === categoryId) ?? null;
  const fee = categoryId ? feeByCategory[categoryId] ?? null : null;
  // Same order as the submit route: a free place first, then a pack credit,
  // then the category's fee.
  const freeQuota = freePlacesLeft > 0;
  const usingCredit = !freeQuota && creditsLeft > 0;
  const free = !freeQuota && !usingCredit && fee != null && fee <= 0;

  // Only what this deal asks: a tenant is not asked about the titre foncier.
  const defs = useMemo<AttributeDef[]>(
    () =>
      (categoryId ? attributesByCategory[categoryId] ?? [] : []).filter((a) =>
        appliesTo(a.deal_types, deal),
      ),
    [categoryId, attributesByCategory, deal],
  );

  /**
   * Changing category keeps every answer the new category also asks for.
   *
   * Appartements → Maisons both want surface, pièces, salles de bain and year;
   * wiping the lot would throw away work for no reason and blank the fields
   * under the seller. Only what the new category has no question for is
   * dropped.
   */
  function switchCategory(next: WizardCategory) {
    const keep = new Set((attributesByCategory[next.id] ?? []).map((a) => a.field_key));
    setCategoryId(next.id);
    setAttrs((a) => Object.fromEntries(Object.entries(a).filter(([k]) => keep.has(k))));
  }

  /**
   * Sale ↔ rent keeps every answer both ask for. The price goes: a sale price
   * left in a rental's monthly box is exactly the typo moderation would catch,
   * and a rent read as a sale price is worse.
   */
  function switchDeal(next: DealType) {
    if (next === deal) return;
    setDeal(next);
    setPrice("");
  }

  /**
   * A title nobody should have to type: it is what they just chose.
   *
   * Property listings in Tunisia are read as "type · surface · lieu", so that
   * is the order. Derived, not stored — the moment the seller edits the box
   * their text wins.
   */
  const suggestedTitle = useMemo(() => {
    if (!category) return "";
    const area = attrs.area_sqm?.trim();
    const where = delegation.trim() || governorateLabel(governorate, locale);
    const what = rent ? t("titleForRent", { category: category.label }) : category.label;
    return [what, area ? t("suggestedArea", { area }) : null, where]
      .filter(Boolean)
      .join(" · ");
  }, [category, attrs.area_sqm, delegation, governorate, locale, t, rent]);

  const title = titleTouched ? typedTitle : suggestedTitle;
  const setTitle = (v: string) => { setTitleTouched(true); setTypedTitle(v); };

  // ─── What is still missing, and where ─────────────────────────────────────
  // Each entry knows the section it belongs to, so a click takes the seller
  // straight there instead of leaving them to scan the page for it.
  const missing: { label: string; fieldId: string }[] = [];
  if (!categoryId) missing.push({ label: t("missingCategory"), fieldId: "f-category" });
  if (photosUploading > 0) {
    missing.push({
      label: t("missingPhotosUploading", { count: photosUploading }),
      fieldId: "f-photos",
    });
  } else if (photos.length === 0) {
    missing.push({ label: t("missingPhoto"), fieldId: "f-photos" });
  }
  for (const def of defs) {
    if (!def.required) continue;
    const v = attrs[def.field_key];
    if (v == null || String(v).trim() === "") {
      missing.push({
        label: t("missingAttribute", { label: def.label.toLowerCase() }),
        fieldId: "f-details",
      });
    }
  }
  if (title.trim().length < 3) {
    missing.push({ label: t("missingTitle"), fieldId: "f-title" });
  }
  if (!onRequest && !(Number(price) > 0)) {
    missing.push({ label: t(rent ? "missingRent" : "missingPrice"), fieldId: "f-price" });
  }
  if (contactPhone.replace(/\D/g, "").length < 8) {
    missing.push({ label: t("missingPhone"), fieldId: "f-phone" });
  }
  if (!attested) {
    missing.push({ label: t("missingAttestation"), fieldId: "f-contact" });
  }

  // Red only survives while the field is still empty: fill it and the outline
  // goes on its own, without the seller having to dismiss anything.
  const missingIds = new Set(missing.map((m) => m.fieldId));
  const flaggedNow = new Set(flagged.filter((id) => missingIds.has(id)));

  /** Scroll to whatever is missing and put the cursor in it. */
  function goToField(id: string) {
    // Mark it before scrolling: by the time the smooth scroll lands the field
    // is already outlined, so it is obvious which one was meant.
    setFlagged((f) => (f.includes(id) ? f : [...f, id]));
    const target = STEP_OF[id];
    if (target !== undefined && target !== step) setStep(target);
    // After the step has rendered, if it had to change.
    setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.querySelector<HTMLElement>("input, select, textarea, button")?.focus({ preventScroll: true });
    }, 60);
  }

  function goToStep(s: Step) {
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** On to the next step, unless this one still lacks something. */
  function next() {
    const pending = missing.filter(
      (m) =>
        STEP_OF[m.fieldId] === step &&
        // Photos still uploading finish in the background; only "none at all"
        // holds the seller here.
        !(m.fieldId === "f-photos" && photosUploading > 0),
    );
    if (pending.length > 0) {
      setFlagged((f) => Array.from(new Set([...f, ...pending.map((m) => m.fieldId)])));
      goToField(pending[0].fieldId);
      toast(t("stepMissing", { count: pending.length }), "warning");
      return;
    }
    goToStep(Math.min(3, step + 1) as Step);
  }

  function back() {
    goToStep(Math.max(0, step - 1) as Step);
  }

  // ─── Tips: the moderation rules, said before the moderation does ──────────
  const textForRules = title + "\n" + description;
  const contactInText = hasContactInText(textForRules);
  const priceKnown = onRequest || Number(price) > 0;
  const priceOk = !isPriceImplausible({
    price: onRequest ? null : Number(price),
    priceOnRequest: onRequest,
    areaSqm: Number(attrs.area_sqm) > 0 ? Number(attrs.area_sqm) : null,
    kind: (category?.kind as CategoryKind | undefined) ?? null,
    dealType: deal,
  });
  const describedEnough = description.trim().length >= 40;
  const tips: { key: string; ok: boolean; text: string; fieldId: string }[] = [
    {
      key: "photos",
      ok: photos.length >= MIN_PHOTOS,
      text:
        photos.length >= MIN_PHOTOS
          ? t("tipPhotosOk", { count: photos.length })
          : t("tipPhotos", { min: MIN_PHOTOS }),
      fieldId: "f-photos",
    },
    {
      key: "contact",
      ok: !contactInText,
      text: contactInText ? t("tipContact") : t("tipContactOk"),
      // The title sits with the price; the description with the details.
      fieldId: hasContactInText(title) ? "f-title" : "f-description",
    },
    ...(priceKnown
      ? [{ key: "price", ok: priceOk, text: priceOk ? t("tipPriceOk") : t(rent ? "tipPriceRent" : "tipPrice"), fieldId: "f-price" }]
      : []),
    {
      key: "description",
      ok: describedEnough,
      text: describedEnough ? t("tipDescriptionOk") : t("tipDescription"),
      fieldId: "f-description",
    },
  ];

  /**
   * A red outline for a field the seller asked to be shown and has not filled.
   * `outline` rather than a border or ring so nothing moves when it appears —
   * the field is already in view when it turns red.
   */
  function flagCls(id: string) {
    return flaggedNow.has(id) ? " outline outline-2 outline-offset-2 outline-danger" : "";
  }

  /**
   * Abandon the resumed draft and start clean. The row is left alone rather
   * than deleted — it costs nothing, and a seller who clicks this by mistake
   * has not lost the photos they already uploaded.
   */
  function startOver() {
    setResumed(false);
    setListingId(null);
    setCategoryId(null);
    setPhotos([]);
    setAttrs({});
    setTypedTitle("");
    setTitleTouched(false);
    setDescription("");
    setPrice("");
    setOnRequest(false);
    setNegotiable(true);
    setDeal(initialDeal);
    setDeposit("");
    setCharges("");
    setFurnished("");
    setAvailableFrom("");
    setMinLease("");
    setGovernorate(homeGovernorate);
    setDelegation("");
    setContactName(defaultContactName);
    setContactPhone(defaultContactPhone);
    setAttested(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ─── Persistence ──────────────────────────────────────────────────────────
  async function saveDraft(extra: Record<string, unknown> = {}): Promise<string | null> {
    setSaved("saving");
    const res = await fetch("/api/annonces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: listingId,
        category_id: categoryId,
        title: title.trim() || "Brouillon",
        description: description.trim() || null,
        price: onRequest ? null : Number(price) || 0,
        price_on_request: onRequest,
        negotiable,
        deal_type: deal,
        // Half-typed is "not said": the API drops what does not parse.
        deposit_amount: rent && deposit.trim() !== "" ? Number(deposit) : null,
        charges_amount: rent && charges.trim() !== "" ? Number(charges) : null,
        furnished: rent && furnished ? furnished : null,
        available_from: rent && availableFrom ? availableFrom : null,
        min_lease_months: rent && minLease.trim() !== "" ? Number(minLease) : null,
        governorate,
        delegation: delegation.trim() || null,
        // Typed on the way out: the form holds strings because inputs do, but
        // `attributes` feeds the filters, and "120" is not 120 to a range query.
        attributes: typedAttributes(defs, attrs),
        photos: photos.map((p, i) => ({ storage_path: p.path, sort_order: i })),
        ...extra,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast(apiError(j, t("saveFailed")), "error");
      setSaved("idle");
      return null;
    }
    const j = (await res.json()) as { id: string };
    setListingId(j.id);
    setSaved("ok");
    return j.id;
  }

  // ─── Autosave ─────────────────────────────────────────────────────────────
  // From the moment there is a category to hang a row on, the draft writes
  // itself a second and a half after you stop typing. The indicator stays quiet
  // on purpose: a spinner firing on every keystroke is worse than no feedback.
  const autosaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRun = useRef(true);

  useEffect(() => {
    if (!categoryId) return;
    // The row requires a 3-140 character title (0146). saveDraft substitutes
    // "Brouillon" for an empty one, so the only gap left is the moment between
    // the first and third keystroke — which used to autosave, fail, and toast.
    const typedSoFar = title.trim();
    if (typedSoFar.length > 0 && typedSoFar.length < 3) return;
    // Nothing to write on the first render of a resumed draft: the form and the
    // row already agree.
    if (firstRun.current) {
      firstRun.current = false;
      if (d) return;
    }
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    autosaveRef.current = setTimeout(() => { void saveDraft(); }, 1500);
    return () => { if (autosaveRef.current) clearTimeout(autosaveRef.current); };
    // saveDraft closes over all of these; listing them is what restarts the
    // timer on each edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    categoryId, photos, attrs, typedTitle, titleTouched, description,
    price, onRequest, negotiable, governorate, delegation, contactName, contactPhone,
    deal, deposit, charges, furnished, availableFrom, minLease,
  ]);

  async function publishNow() {
    if (missing.length > 0) {
      // Flag everything so the whole list turns red at once, then go to the
      // first one. The list at the end of the form is the dialog — putting a
      // modal over it would say the same thing twice.
      setFlagged(missing.map((m) => m.fieldId));
      goToField(missing[0].fieldId);
      toast(t("missingCount", { count: missing.length }), "warning");
      return;
    }
    return publish();
  }

  async function publish() {
    setBusy(true);
    try {
      const id = await saveDraft({
        contact_name: contactName.trim() || null,
        contact_phone: contactPhone.trim(),
        contact_whatsapp: contactPhone.trim(),
        show_phone: true,
        attestation_version: SELLER_ATTESTATION_VERSION,
      });
      if (!id) return;

      const res = await fetch(`/api/annonces/${id}/submit`, { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as {
        status?: string; paidWith?: string; remaining?: number;
        paymentId?: string; error?: string; detail?: string;
      };
      if (!res.ok) {
        toast(apiError(j, t("submitFailed")), "error");
        return;
      }
      if (j.status === "pending_payment" && j.paymentId) {
        router.push(`/payment/checkout?payment=${j.paymentId}` as never);
        return;
      }
      setDone({ paidWith: j.paidWith ?? "free", remaining: j.remaining, status: j.status ?? "pending_review", id });
    } finally {
      setBusy(false);
    }
  }

  // ─── Done ─────────────────────────────────────────────────────────────────
  if (done) {
    return (
      <main className="mx-auto max-w-md px-5 py-16 text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-gold-faint text-gold ring-1 ring-gold-soft">
          <Check className="size-8" strokeWidth={2.6} />
        </span>
        <h1 className="mt-5 text-[22px] font-extrabold tracking-tight">
          {done.status === "published" ? t("donePublishedTitle") : t("doneTitle")}
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          {done.status === "published" ? t("donePublishedBody") : t("doneBody")}
          {done.paidWith === "credit" && typeof done.remaining === "number" && (
            <> {t("doneCreditsLeft", { count: done.remaining })}</>
          )}
          {done.paidWith === "free" && <> {t("doneFree")}</>}
          {done.paidWith === "free_quota" && <> {t("doneFreeQuota")}</>}
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
          {done.status === "published" && (
            <button
              onClick={() => router.push(`/annonces/${done.id}` as never)}
              className="mazed-btn-luxe tap-target inline-flex px-6 py-3 text-[13.5px]"
            >
              {t("seeListing")}
            </button>
          )}
          <button
            onClick={() => router.push("/account/listings" as never)}
            className={
              done.status === "published"
                ? "tap-target inline-flex rounded-full border border-border px-6 py-3 text-[13.5px] font-bold text-foreground"
                : "mazed-btn-luxe tap-target inline-flex px-6 py-3 text-[13.5px]"
            }
          >
            {t("seeMyListings")}
          </button>
        </div>
      </main>
    );
  }

  // The price, said the way the card says it: number then currency, no LTR box
  // around the pair (an Arabic reader reads the number first).
  const money = (n: number) => `${formatTND(n, locale)} ${tc("tnd")}`;
  const priceText =
    onRequest || !(Number(price) > 0)
      ? t("priceOnRequestShort")
      : rent
        ? t("perMonth", { amount: money(Number(price)) })
        : money(Number(price));

  /** What a rental adds, said the way the annonce page will list it. */
  const rentSummary = rent
    ? [
        deposit.trim() !== "" ? t("rentDepositShort", { amount: money(Number(deposit)) }) : null,
        charges.trim() === ""
          ? null
          : Number(charges) > 0
            ? t("rentChargesShort", { amount: money(Number(charges)) })
            : t("rentNoCharges"),
        furnished ? t(`furnished.${furnished}`) : null,
        availableFrom ? t("availableFromShort", { date: formatDate(availableFrom, locale, "medium") }) : null,
        minLease.trim() !== "" ? t("minLeaseShort", { count: Number(minLease) }) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  /** Rent + deposit + charges — only when all three are stated (src/lib/listings/deal.ts). */
  const moveIn = rent
    ? firstMonthCost({
        price: Number(price) > 0 ? Number(price) : null,
        priceOnRequest: onRequest,
        deposit: deposit.trim() === "" ? null : Number(deposit),
        charges: charges.trim() === "" ? null : Number(charges),
      })
    : null;

  /** The details the seller gave, as one line a buyer would read. */
  const attributeSummary = defs
    .map((def) => {
      const raw = attrs[def.field_key];
      if (raw == null || String(raw).trim() === "") return null;
      const value =
        def.data_type === "boolean"
          ? raw === "true" || raw === "1"
            ? t("yes")
            : t("no")
          : def.options?.find((o) => o.value === raw)?.label ?? raw;
      return `${def.label} : ${value}${def.unit ? ` ${def.unit}` : ""}`;
    })
    .filter(Boolean)
    .join(" · ");

  const backButton = step > 0 && (
    <button
      type="button"
      onClick={back}
      className="tap-target inline-flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border px-5 text-[13.5px] font-bold text-foreground transition hover:bg-surface-2"
    >
      <ArrowLeft className="size-4 rtl:-scale-x-100" />
      {t("back")}
    </button>
  );

  const forwardButton =
    step < 3 ? (
      <button
        type="button"
        onClick={next}
        className="mazed-btn-luxe tap-target inline-flex h-12 flex-1 items-center justify-center gap-1.5 px-7 text-[14px] lg:flex-none"
      >
        {t("next")}
        <ArrowRight className="size-4 rtl:-scale-x-100" />
      </button>
    ) : (
      <button
        type="button"
        onClick={publishNow}
        disabled={busy || photosUploading > 0}
        className="mazed-btn-luxe tap-target inline-flex h-12 flex-1 items-center justify-center gap-1.5 px-7 text-[14px] disabled:opacity-60 lg:flex-none"
      >
        {busy ? (
          <><Loader2 className="size-4 animate-spin" /> {t("oneMoment")}</>
        ) : photosUploading > 0 ? (
          <><Loader2 className="size-4 animate-spin" /> {t("sendingPhotos")}</>
        ) : (
          <>{t("publishCta")}</>
        )}
      </button>
    );

  const feeHint = freeQuota
    ? t("freeQuotaHint")
    : free
      ? t("freeInCategory")
      : usingCredit
        ? t("useOneCredit", { count: creditsLeft })
        : fee != null
          ? t("feeAfterReviewPlain", { amount: `${formatTND(fee, locale)} ${tc("tnd")}` })
          : t("feeShownAfterCategory");

  return (
    <main className="mx-auto max-w-[var(--max-w-wide)] px-4 pb-44 pt-4 lg:px-6 lg:pb-12 lg:pt-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start justify-between gap-3 pt-2">
          <div>
            <h1 className="text-[24px] font-extrabold tracking-tight">{t("title")}</h1>
            <p className="mt-1 text-[13px] text-muted">{t("subtitle")}</p>
          </div>
          {saved === "saving" && (
            <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-[11px] text-muted">
              <Loader2 className="size-3 animate-spin" /> {t("saving")}
            </span>
          )}
          {saved === "ok" && (
            <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-[11px] text-muted">
              <Check className="size-3" /> {t("draftSaved")}
            </span>
          )}
        </div>

        {resumed && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold-soft bg-gold-faint px-4 py-3">
            <p className="text-[12.5px] font-semibold text-gold">
              {d?.updated_at
                ? t("resumedOn", { date: formatDate(d.updated_at, locale, "short") })
                : t("resumed")}
            </p>
            <button
              type="button"
              onClick={startOver}
              className="text-[12px] font-bold text-muted underline hover:text-foreground"
            >
              {t("startOver")}
            </button>
          </div>
        )}

        {/* Where the seller is. Each segment is a way back to that step. */}
        <nav aria-label={t("stepsAria")} className="mt-5">
          <p className="text-[11.5px] font-bold text-muted">
            {t("stepOf", { current: step + 1, total: STEPS.length })}
          </p>
          <ol className="mt-2 grid grid-cols-4 gap-1.5">
            {STEPS.map((key, i) => (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => goToStep(i as Step)}
                  aria-current={i === step ? "step" : undefined}
                  className="flex w-full flex-col items-start gap-1.5 text-start"
                >
                  <span
                    className={cn(
                      "h-1.5 w-full rounded-full transition",
                      i <= step ? "bg-[var(--gold)]" : "bg-surface-2 ring-1 ring-border",
                    )}
                  />
                  <span
                    className={cn(
                      "w-full truncate text-[11.5px] font-bold",
                      i === step ? "text-foreground" : "text-muted",
                    )}
                  >
                    {t(`steps.${key}`)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-5 space-y-4">
          {/* ── ① What and where ── */}
          {step === 0 && (
            <>
              {/* Sell or let — the one answer that changes the questions after it. */}
              <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
                <SectionHead icon={Home} title={t("dealTitle")} />
                <div role="radiogroup" aria-label={t("dealTitle")} className="mt-4 grid grid-cols-2 gap-2">
                  {(["sale", "rent"] as const).map((k) => {
                    const on = deal === k;
                    const Icon = k === "rent" ? KeyRound : Tag;
                    return (
                      <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => switchDeal(k)}
                        className={cn(
                          "tap-target flex items-center gap-2.5 rounded-xl px-3.5 py-3 text-start transition",
                          on ? "bg-gold-faint ring-2 ring-gold" : "bg-surface-2 ring-1 ring-border hover:ring-gold-soft",
                        )}
                      >
                        <Icon className={cn("size-5 shrink-0", on ? "text-gold" : "text-muted")} />
                        <span className="min-w-0">
                          <span className="block text-[14px] font-extrabold text-foreground">
                            {t(k === "rent" ? "dealRentCta" : "dealSaleCta")}
                          </span>
                          <span className="block text-[11.5px] leading-snug text-muted">
                            {t(k === "rent" ? "dealRentHint" : "dealSaleHint")}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section
                id="f-category"
                className={`scroll-mt-24 rounded-2xl border border-border bg-surface p-4 sm:p-5${flagCls("f-category")}`}
              >
                <SectionHead icon={Tag} title={t(rent ? "categoryTitleRent" : "categoryTitle")} />
                <p className="mt-1 text-[13px] text-muted">{t("categoryHint")}</p>

                {usingCredit && (
                  <p className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gold-faint px-3 py-2 text-[12.5px] font-bold text-gold ring-1 ring-gold-soft">
                    <Ticket className="size-4" />
                    {t("creditsInPlan", { count: creditsLeft })}
                  </p>
                )}

                {/* Family first, then the category. One choice, so a segmented
                    control — the shape every OS uses to say "one of these" —
                    rather than a grid of tiles, which reads as a multi-select. */}
                <div className="mt-4">
                  <div
                    role="radiogroup"
                    aria-label={t("groupAria")}
                    className="grid gap-1 rounded-xl bg-surface-2 p-1"
                    style={{ gridTemplateColumns: `repeat(${Math.max(1, groups.length)}, minmax(0, 1fr))` }}
                  >
                    {groups.map((g) => {
                      const on = groupId === g.id;
                      return (
                        <button
                          key={g.id}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => {
                            setGroupId(g.id);
                            // Keep a category only while it still belongs to the
                            // family on screen, or the form asks for a floor
                            // number on a plot of land.
                            if (category && category.groupId !== g.id) setCategoryId(null);
                          }}
                          className={cn(
                            "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-2 text-[13.5px] font-bold transition",
                            on
                              ? "bg-[var(--gold)] text-white shadow-[var(--shadow-gold)]"
                              : "text-muted hover:text-foreground",
                          )}
                        >
                          {g.label}
                        </button>
                      );
                    })}
                  </div>

                  <div role="radiogroup" aria-label={t("categoryAria")} className="mt-2.5 flex flex-wrap gap-1.5">
                    {categories
                      .filter((c) => c.groupId === groupId)
                      .map((c) => {
                        const active = categoryId === c.id;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => switchCategory(c)}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-bold transition",
                              active
                                ? "bg-gold-faint text-gold ring-1 ring-gold"
                                : "bg-surface-2 text-muted ring-1 ring-border hover:text-foreground",
                            )}
                          >
                            {active && <Check className="size-3.5" />}
                            {c.label}
                          </button>
                        );
                      })}
                  </div>

                  {/* What publishing costs, said once — free for most sellers. */}
                  {category && (freeQuota || fee != null) && (
                    <p
                      className={cn(
                        "mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] font-bold",
                        freeQuota || free ? "text-[var(--tone-ok)]" : "text-muted",
                      )}
                    >
                      {freeQuota || free ? (
                        <><Gift className="size-3.5" /> {freeQuota ? t("freeQuotaHint") : t("freeInCategory")}</>
                      ) : (
                        <span>{t("feeLinePlain", { amount: `${formatTND(fee ?? 0, locale)} ${tc("tnd")}` })}</span>
                      )}
                    </p>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
                <SectionHead icon={MapPin} title={t("locationTitle")} />
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t("governorate")} <span className="text-gold">*</span></Label>
                    <div className="relative mt-1">
                      <MapPin className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                      <select
                        value={governorate}
                        onChange={(e) => setGovernorate(e.target.value)}
                        className="w-full appearance-none rounded-xl border border-border bg-surface py-3 ps-9 pe-3 text-[14px] text-foreground focus:border-gold focus:outline-none"
                      >
                        {TUNISIAN_GOVERNORATES.map((g) => (
                          <option key={g} value={g}>{governorateLabel(g, locale)}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {/* Free text on purpose. A délégation list for all 24
                      governorates is 260 rows that would go stale, and getting it
                      wrong costs a filter nobody uses — the governorate is what
                      search actually keys on. */}
                  <Field
                    label={t("delegationLabel")}
                    value={delegation}
                    onChange={setDelegation}
                    placeholder={t("delegationPlaceholder")}
                  />
                </div>
              </section>
            </>
          )}

          {/* ── ② Photos ── */}
          {step === 1 && (
            <section
              id="f-photos"
              className={`scroll-mt-24 rounded-2xl border border-border bg-surface p-4 sm:p-5${flagCls("f-photos")}`}
            >
              <SectionHead icon={Camera} title={t("photosTitle")} />
              <p className="mt-1 text-[13px] text-muted">{t("photosHint")}</p>
              <div className="mt-5">
                <PhotoUploader
                  photos={photos}
                  onChange={setPhotos}
                  onPendingChange={setPhotosUploading}
                />
              </div>
            </section>
          )}

          {/* ── ③ Price and details ── */}
          {step === 2 && (
            <>
              <section
                id="f-price"
                className={`scroll-mt-24 rounded-2xl border border-border bg-surface p-4 sm:p-5${flagCls("f-price")}`}
              >
                <SectionHead icon={Wallet} title={t(rent ? "rentTitle" : "priceTitle")} />
                <p className="mt-1 text-[13px] text-muted">{t(rent ? "rentHint" : "priceHint")}</p>

                <div className="mt-5 space-y-4">
                  <div>
                    <Label>{t(rent ? "rentLabel" : "priceLabel")} {!onRequest && <span className="text-gold">*</span>}</Label>
                    {/* The box is left-to-right as a whole, not only the input:
                        with just the input flipped, its padding sat on the right
                        while the currency label followed the page to the left,
                        and on /ar the figure ran under « د.ت ». */}
                    <div dir="ltr" className="relative mt-1">
                      <input
                        type="number"
                        inputMode="decimal"
                        dir="ltr"
                        value={price}
                        disabled={onRequest}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder={rent ? "1200" : "250000"}
                        className={cn(
                          "w-full rounded-xl border border-border bg-surface px-3 py-3 text-[16px] font-bold text-foreground placeholder:font-normal placeholder:text-muted focus:border-gold focus:outline-none disabled:opacity-40",
                          rent ? "pe-28" : "pe-16",
                        )}
                      />
                      <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[13px] font-bold text-muted">
                        {rent ? t("tndPerMonth") : tc("tnd")}
                      </span>
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <Toggle label={t("negotiable")} on={negotiable} onClick={() => setNegotiable((v) => !v)} />
                      <Toggle label={t("onRequest")} on={onRequest} onClick={() => setOnRequest((v) => !v)} />
                    </div>
                  </div>

                  {rent && (
                    <div id="f-rent" className="grid scroll-mt-24 gap-4 sm:grid-cols-2">
                      <Field
                        label={t("depositLabel")}
                        type="number"
                        value={deposit}
                        onChange={setDeposit}
                        placeholder="2400"
                        suffix={tc("tnd")}
                      />
                      <Field
                        label={t("chargesLabel")}
                        type="number"
                        value={charges}
                        onChange={setCharges}
                        placeholder="0"
                        suffix={tc("tnd")}
                      />
                      <div className="sm:col-span-2">
                        <Label>{t("furnishedLabel")}</Label>
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {FURNISHED.map((f) => (
                            <button
                              key={f}
                              type="button"
                              onClick={() => setFurnished(furnished === f ? "" : f)}
                              className={cn(
                                "tap-target rounded-full px-4 py-2 text-[13px] font-bold transition",
                                furnished === f
                                  ? "bg-[var(--gold)] text-white"
                                  : "bg-surface text-muted ring-1 ring-border hover:text-foreground",
                              )}
                            >
                              {t(`furnished.${f}`)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <Field
                        label={t("availableFromLabel")}
                        type="date"
                        value={availableFrom}
                        onChange={setAvailableFrom}
                      />
                      <Field
                        label={t("minLeaseLabel")}
                        type="number"
                        value={minLease}
                        onChange={setMinLease}
                        placeholder="12"
                        suffix={t("monthsUnit")}
                      />
                      <p className="text-[11.5px] leading-snug text-muted sm:col-span-2">{t("rentFieldsHint")}</p>
                    </div>
                  )}

                  <div id="f-title" className={`scroll-mt-24 rounded-xl${flagCls("f-title")}`}>
                    <Field
                      label={t("titleLabel")}
                      required
                      value={title}
                      onChange={setTitle}
                      placeholder={t("titlePlaceholder")}
                    />
                  </div>
                </div>
              </section>

              <section
                id="f-details"
                className={`scroll-mt-24 rounded-2xl border border-border bg-surface p-4 sm:p-5${flagCls("f-details")}`}
              >
                <SectionHead icon={ClipboardList} title={t("detailsTitle")} />
                <p className="mt-1 text-[13px] text-muted">
                  {categoryId ? t("detailsHint") : t("detailsPickCategory")}
                </p>

                {defs.length > 0 ? (
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    {defs.map((def) => (
                      <AttributeField
                        key={def.field_key}
                        def={def}
                        value={attrs[def.field_key] ?? ""}
                        onChange={(v) => setAttrs((s) => ({ ...s, [def.field_key]: v }))}
                      />
                    ))}
                  </div>
                ) : (
                  categoryId && (
                    <p className="mt-5 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] text-muted">
                      {t("detailsNone")}
                    </p>
                  )
                )}

                <div id="f-description" className="mt-5 scroll-mt-24">
                  <Label>{t("descriptionLabel")}</Label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    maxLength={4000}
                    dir="auto"
                    placeholder={t("descriptionPlaceholder")}
                    className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-[13.5px] leading-relaxed text-foreground placeholder:text-muted focus:border-gold focus:outline-none"
                  />
                  <p className="mt-1 text-end text-[10.5px] text-muted">
                    <Ltr>{description.length} / 4000</Ltr>
                  </p>
                </div>
              </section>
            </>
          )}

          {/* ── ④ Summary: what a buyer will see, and what to fix first ── */}
          {step === 3 && (
            <>
              <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
                <SectionHead icon={ClipboardCheck} title={t("reviewTitle")} />
                <p className="mt-1 text-[13px] text-muted">{t("reviewHint")}</p>

                <div className="mt-5 grid gap-5 sm:grid-cols-[220px_1fr]">
                  {/* The card as the catalogue draws it, same ListingImage, so a
                      portrait photo behaves here the way it will there. */}
                  <div className="w-full max-w-[260px] self-start overflow-hidden rounded-2xl border border-border bg-surface">
                    <div className="relative aspect-[4/3] bg-surface-2">
                      {photos[0] ? (
                        <ListingImage path={photos[0].path} alt="" sizes="260px" />
                      ) : (
                        <span className="grid size-full place-items-center gap-1 text-center text-muted">
                          <ImageOff className="mx-auto size-5" />
                          <span className="px-2 text-[10px] leading-tight">{t("noPhoto")}</span>
                        </span>
                      )}
                    </div>
                    <div className="p-3">
                      <span className="inline-flex flex-wrap items-center gap-1 text-[10px] font-bold text-muted">
                        <Home className="size-3" /> {category?.label ?? "—"}
                        <span
                          className={cn(
                            "ms-1 rounded-full px-1.5 py-0.5",
                            rent ? "bg-gold-faint text-gold" : "bg-surface-2 text-muted",
                          )}
                        >
                          {t(rent ? "dealRent" : "dealSale")}
                        </span>
                      </span>
                      <h3 className="mt-0.5 line-clamp-2 text-[13.5px] font-bold leading-snug">{title || "—"}</h3>
                      <p className="mazed-tabular mt-1 text-[15px] font-extrabold">{priceText}</p>
                      <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted">
                        <MapPin className="size-3" /> {delegation.trim() || governorateLabel(governorate, locale)}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <SummaryBlock title={t("steps.where")} editLabel={t("edit")} onEdit={() => goToStep(0)}>
                      {[
                        t(rent ? "dealRent" : "dealSale"),
                        category?.label ?? "—",
                        governorateLabel(governorate, locale),
                        delegation.trim(),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </SummaryBlock>

                    <SummaryBlock title={t("steps.photos")} editLabel={t("edit")} onEdit={() => goToStep(1)}>
                      {photos.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {photos.slice(0, 6).map((p) => (
                            <span key={p.path} className="relative block size-12 overflow-hidden rounded-lg bg-surface-2">
                              <ListingImage path={p.path} alt="" sizes="48px" />
                            </span>
                          ))}
                          {photos.length > 6 && (
                            <span className="text-[12px] font-bold text-muted">+{photos.length - 6}</span>
                          )}
                        </div>
                      ) : (
                        t("noPhoto")
                      )}
                    </SummaryBlock>

                    <SummaryBlock title={t("steps.details")} editLabel={t("edit")} onEdit={() => goToStep(2)}>
                      <span className="block font-bold text-foreground">
                        {priceText}
                        {negotiable && !onRequest && Number(price) > 0 && ` · ${t("negotiable")}`}
                      </span>
                      {rentSummary && <span className="mt-1 block">{rentSummary}</span>}
                      {moveIn != null && (
                        <span className="mt-1 block font-bold text-foreground">
                          {t("moveInCost", { amount: money(moveIn) })}
                        </span>
                      )}
                      {attributeSummary && <span className="mt-1 block">{attributeSummary}</span>}
                      {description.trim() ? (
                        <span dir="auto" className="mt-1 line-clamp-3 block">{description.trim()}</span>
                      ) : (
                        <span className="mt-1 block italic">{t("noDescription")}</span>
                      )}
                    </SummaryBlock>
                  </div>
                </div>
              </section>

              {/* The same rules the moderation applies, said before it does:
                  fix them here and a trusted seller goes online at once. */}
              <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
                <SectionHead icon={Lightbulb} title={t("tipsTitle")} />
                <ul className="mt-3 space-y-2.5">
                  {tips.map((tip) => (
                    <li key={tip.key} className="flex items-start gap-2 text-[12.5px] leading-snug">
                      {tip.ok ? (
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--tone-ok)]" />
                      ) : (
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--tone-warn)]" />
                      )}
                      <span className={tip.ok ? "text-muted" : "text-foreground"}>{tip.text}</span>
                      {!tip.ok && (
                        <button
                          type="button"
                          onClick={() => goToField(tip.fieldId)}
                          className="ms-auto shrink-0 text-[12px] font-bold text-gold underline underline-offset-2"
                        >
                          {t("fix")}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              <section
                id="f-contact"
                className={`scroll-mt-24 rounded-2xl border border-border bg-surface p-4 sm:p-5${flagCls("f-contact")}`}
              >
                <SectionHead icon={Phone} title={t("contactTitle")} />
                <p className="mt-1 text-[13px] text-muted">{t("contactHint")}</p>

                <div className="mt-5 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label={t("contactNameLabel")}
                      value={contactName}
                      onChange={setContactName}
                      placeholder={t("contactNamePlaceholder")}
                    />
                    <div id="f-phone" className={`scroll-mt-24 rounded-xl${flagCls("f-phone")}`}>
                      {/* dir="ltr": "+216 98 124 111" typed into a right-to-left
                          field comes out as "111 124 98 216+". */}
                      <Field
                        label={t("phoneLabel")}
                        required
                        value={contactPhone}
                        onChange={setContactPhone}
                        placeholder="+216 …"
                        dir="ltr"
                      />
                    </div>
                  </div>

                  <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-surface-2/40 p-3.5">
                    <input
                      type="checkbox"
                      checked={attested}
                      onChange={(e) => setAttested(e.target.checked)}
                      className="mt-0.5 size-5 shrink-0 accent-[var(--gold)]"
                    />
                    <span className="text-[12.5px] leading-relaxed text-foreground">{t("attestation")}</span>
                  </label>

                  <div className="rounded-2xl bg-surface-2 p-4 ring-1 ring-border">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[13px] text-muted">
                        {usingCredit ? t("feeFromPlan") : free || freeQuota ? t("feePublication") : t("feeLabel")}
                      </span>
                      <span className="mazed-tabular text-[18px] font-extrabold text-foreground">
                        {freeQuota || free ? (
                          t("free")
                        ) : usingCredit ? (
                          <Ltr>1 / {creditsLeft}</Ltr>
                        ) : fee == null ? (
                          "—"
                        ) : (
                          `${formatTND(fee, locale)} ${tc("tnd")}`
                        )}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11.5px] leading-snug text-muted">
                      {freeQuota
                        ? t("freeQuotaExplain", { left: freePlacesLeft, limit: freeLimit })
                        : usingCredit
                          ? t("creditExplain")
                          : free
                            ? t("freeExplain")
                            : t("paidExplain")}
                    </p>
                  </div>
                </div>
              </section>

              {missing.length > 0 && (
                <section className="overflow-hidden rounded-2xl border border-border bg-surface">
                  <p className="p-4 pb-2 text-[14px] font-extrabold text-foreground">
                    {t("itemsToComplete", { count: missing.length })}
                  </p>
                  <ul className="grid p-2 sm:grid-cols-2 sm:p-3">
                    {missing.map((m) => (
                      <li key={m.label}>
                        <button
                          type="button"
                          onClick={() => goToField(m.fieldId)}
                          className={cn(
                            "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-start text-[12.5px] transition hover:bg-surface-2",
                            flaggedNow.has(m.fieldId) ? "font-bold text-danger" : "text-muted hover:text-foreground",
                          )}
                        >
                          <span
                            className={cn(
                              "mt-1.5 size-1.5 shrink-0 rounded-full",
                              flaggedNow.has(m.fieldId) ? "bg-danger" : "bg-[var(--gold)]",
                            )}
                          />
                          {m.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        {/* Wide screens: the buttons sit under the step. */}
        <div className="mt-5 hidden items-center justify-between gap-3 lg:flex">
          <div>{backButton}</div>
          {forwardButton}
        </div>
        {step === 3 && <p className="mt-2 hidden text-end text-[11px] text-muted lg:block">{feeHint}</p>}
      </div>

      {/* Phones: the buttons are always under the thumb. */}
      <div className="fixed inset-x-0 bottom-[calc(var(--mazed-bottombar-h,64px)+env(safe-area-inset-bottom))] z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-md lg:hidden">
        <div className="flex items-center gap-2.5">
          {backButton}
          {forwardButton}
        </div>
        {step === 3 && <p className="mt-2 text-center text-[11px] text-muted">{feeHint}</p>}
      </div>
    </main>
  );
}

/**
 * The form holds strings, because inputs do. `attributes` does not: it feeds
 * the catalogue's filters, and `"120"` does not answer `surface >= 100`. Each
 * value is cast back to what its definition says it is on the way out, and an
 * empty answer is dropped rather than stored as `""` — an absent key means
 * "not stated", which is the truth, while an empty string is a value.
 */
function typedAttributes(
  defs: AttributeDef[],
  raw: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of defs) {
    const v = raw[def.field_key];
    if (v == null || String(v).trim() === "") continue;
    if (def.data_type === "number") {
      const n = Number(v);
      if (Number.isFinite(n)) out[def.field_key] = n;
    } else if (def.data_type === "boolean") {
      out[def.field_key] = v === "true" || v === "1";
    } else {
      out[def.field_key] = String(v).trim();
    }
  }
  return out;
}

/* ── Small building blocks ─────────────────────────────────────────────────── */

/** One question, rendered as whatever its `data_type` says it is. */
function AttributeField({
  def, value, onChange,
}: {
  def: AttributeDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTranslations("publish");
  if (def.data_type === "boolean") {
    // A yes/no is a switch, not a dropdown with two options in it. Clicking the
    // active side again clears the answer, because "not stated" is a real third
    // state on a property form — a seller who does not know whether the titre
    // foncier is registered must not be forced to claim either.
    return (
      <div>
        <Label>{def.label} {def.required && <span className="text-gold">*</span>}</Label>
        <div className="mt-1.5 flex gap-2">
          {[
            { v: "true", label: t("yes") },
            { v: "false", label: t("no") },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange(value === o.v ? "" : o.v)}
              className={cn(
                "tap-target rounded-full px-4 py-2 text-[13px] font-bold transition",
                value === o.v
                  ? "bg-[var(--gold)] text-white"
                  : "bg-surface text-muted ring-1 ring-border hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (def.data_type === "select" && def.options?.length) {
    return (
      <div>
        <Label>{def.label} {def.required && <span className="text-gold">*</span>}</Label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full appearance-none rounded-xl border border-border bg-surface px-3 py-3 text-[14px] text-foreground focus:border-gold focus:outline-none"
        >
          <option value="">—</option>
          {def.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <Field
      label={def.label}
      required={def.required}
      type={def.data_type === "number" ? "number" : "text"}
      value={value}
      onChange={onChange}
      suffix={def.unit ?? undefined}
    />
  );
}

/**
 * A section header: an icon and a title.
 *
 * Not a numbered circle. Numbering implies an order the form does not have —
 * these can be filled in any sequence — and numbered blocks down one column
 * read as a checklist someone else wrote rather than a form you are filling in.
 */
/** One answered step on the summary, with the way back to change it. */
function SummaryBlock({
  title,
  editLabel,
  onEdit,
  children,
}: {
  title: string;
  editLabel: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-surface-2/60 p-3 ring-1 ring-border">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11.5px] font-bold text-muted">{title}</span>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1 text-[12px] font-bold text-gold hover:underline"
        >
          <Pencil className="size-3" />
          {editLabel}
        </button>
      </div>
      <div className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

function SectionHead({
  icon: Icon, title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}) {
  return (
    <h2 className="flex items-center gap-2.5 text-[17px] font-extrabold tracking-tight">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-gold-faint text-gold ring-1 ring-gold-soft">
        <Icon className="size-4" />
      </span>
      {title}
    </h2>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted">
      {children}
    </span>
  );
}

function Field({
  label, value, onChange, placeholder, type = "text", required, suffix, compact, dir,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  suffix?: string;
  compact?: boolean;
  dir?: "ltr" | "rtl";
}) {
  return (
    <label className="block">
      {label && <Label>{label} {required && <span className="text-gold">*</span>}</Label>}
      <div className="relative mt-1">
        <input
          type={type}
          inputMode={type === "number" ? "numeric" : undefined}
          dir={dir}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "w-full rounded-xl border border-border bg-surface px-3 text-foreground placeholder:text-muted focus:border-gold focus:outline-none",
            compact ? "py-2.5 text-[13.5px]" : "py-3 text-[14px]",
            suffix ? "pe-12" : "",
          )}
        />
        {suffix && (
          <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[12.5px] font-bold text-muted">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-bold transition",
        on ? "bg-gold-faint text-gold ring-1 ring-gold-soft" : "bg-surface text-muted ring-1 ring-border",
      )}
    >
      {on && <Check className="size-3.5" />}
      {label}
    </button>
  );
}
