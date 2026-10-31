"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useApiError } from "@/lib/useApiError";
import { Link, useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { PhotoUploader, type UploadedPhoto } from "@/components/listing/PhotoUploader";
import { ListingImage } from "@/components/media/ListingImage";
import { Ltr } from "@/components/ui/Ltr";
import { Modal } from "@/components/ui/Modal";
import { useSetting } from "@/components/settings/SettingsProvider";
import { formatTND, formatDate, formatNumber, cn } from "@/lib/utils";
import { TUNISIAN_GOVERNORATES, governorateLabel } from "@/lib/tunisia";
import { canonicalDelegation, delegationLabel, delegationsOf } from "@/lib/delegations";
import {
  Check, Tag, Camera, Wallet, Phone, ClipboardList, ClipboardCheck, Loader2, MapPin,
  Gift, Ticket, ImageOff, Home, ArrowLeft, ArrowRight, Lightbulb, CheckCircle2, AlertTriangle, Pencil,
  KeyRound, Sparkles, Store, User, WandSparkles, RotateCcw,
} from "lucide-react";
import {
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
import type { ListingDraft } from "@/lib/ai/listing";
import { estimateRange, priceInWords, suggestPriceFix, type PriceRef } from "@/lib/listings/priceCheck";
import { attributeOutOfBounds, titleTooShort } from "@/lib/listings/input";
import {
  attributeFieldId,
  listOfFields,
  missingOnStep,
  stepOfField,
  type WizardStep,
} from "@/lib/listings/wizard";
import {
  DEPOSIT_MONTHS,
  LEASE_MONTHS,
  addMonths,
  areaChipsFor,
  availableChoiceOf,
  countChipOf,
  countChipsFor,
  depositFor,
  depositMonthsOf,
  estimateChips,
  nameChoices,
  presetOf,
  yearOptions,
  type CountChips,
} from "@/lib/listings/choices";
import {
  HIGHLIGHTS,
  appendDescription,
  describeListing,
  hasLine,
  highlightLine,
  highlightsFor,
  replaceDescription,
  toggleLine,
  writeDescription,
} from "@/lib/listings/describe";

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
type Step = WizardStep;

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
  /** The quartier: a neighbourhood, more precise than the délégation. */
  address?: string | null;
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
  shop_id?: string | null;
};

/** A shop the seller may publish for (0173), and how many annonces its plan still covers. */
export type WizardShop = { id: string; name: string; planLeft: number | null; /** They own it. */ owner?: boolean };

/** The plan of the agence this seller owns: their own annonces count in it too (src/lib/places). */
export type WizardOwnPlan = { shopName: string; left: number };

/** A number a buyer can call: eight digits at least, as the submit route asks. */
const phoneUsable = (phone: string) => phone.replace(/\D/g, "").length >= 8;

export function PublishWizard({
  categories,
  groups,
  attributesByCategory,
  creditsLeft,
  freePlacesLeft,
  freeLimit,
  defaultContactName,
  defaultContactPhone,
  defaultGovernorate,
  initialDraft,
  initialDeal = "sale",
  aiAvailable = false,
  mode = "create",
  editPending = false,
  editWaiting = false,
  shops = [],
  ownPlan = null,
  paymentsOpen = true,
  initialShopId = null,
  priceRefs = {},
  today,
  locale,
}: {
  categories: WizardCategory[];
  groups: { id: string; label: string }[];
  attributesByCategory: Record<string, AttributeDef[]>;
  creditsLeft: number;
  /** Free places left (0165): while > 0 the publication costs nothing, and at
   *  0 it needs a shop's plan — there is no fee per annonce any more. */
  freePlacesLeft: number;
  freeLimit: number;
  /** Payments can be taken (the payee details are in): Pro can be bought. */
  paymentsOpen?: boolean;
  /** Set when the seller owns an agence with a running plan: « Pour moi » counts in it. */
  ownPlan?: WizardOwnPlan | null;
  defaultContactName: string;
  defaultContactPhone: string;
  /** From the seller's profile — signup asks for it, so the form should not
   *  ask again. Empty for an older account that never gave one. */
  defaultGovernorate: string;
  initialDraft: InitialDraft | null;
  /** ?deal=rent — the home page's « J'ai un bien à louer » lands here. */
  initialDeal?: DealType;
  /** The listing assistant can be offered (key set, switched on, budget left). */
  aiAvailable?: boolean;
  /**
   * "edit": the annonce is online, or waiting for an admin, and this is the
   * seller's new version (0172).
   * Nothing is saved while they type — the annonce stays as it is until they
   * send the whole form, and the rules decide whether it goes straight online.
   */
  mode?: "create" | "edit";
  /** The form shows an edit already waiting for an admin, not the live version. */
  editPending?: boolean;
  /** The annonce being edited is not online yet: it waits for an admin. */
  editWaiting?: boolean;
  /** Approved shops where this seller has the right to publish. */
  shops?: WizardShop[];
  /** ?shop= from the Espace Pro's « Publier pour l'agence ». */
  initialShopId?: string | null;
  /** What annonces like it ask, by `${categoryId}:${deal}` — to catch a zero too many. */
  priceRefs?: Record<string, PriceRef>;
  /** YYYY-MM-DD in Tunis, read on the server: « Tout de suite », « Dans 1 mois » and « Neuf » count from it. */
  today: string;
  locale: string;
}) {
  const d = initialDraft;
  const editing = mode === "edit";
  // Still waiting for an admin? A correction sent from here can put it online.
  const [waiting, setWaiting] = useState(editWaiting);
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const t = useTranslations("publish");
  const tc = useTranslations("common");
  // As an admin set them in /admin/settings: the photo count below which an
  // annonce waits for a human, the price help, and « Corriger » once sent.
  const minPhotos = useSetting("moderation_min_photos");
  const priceHelp = useSetting("feature_price_help");
  const canEdit = useSetting("feature_listing_edit");
  // Version B, « Publier en parlant »: offered here while the assistant can answer.
  const chatOn = useSetting("feature_publish_chat");
  // « Décrivez votre bien en une phrase », switched in /admin/settings.
  const aiFillOn = useSetting("feature_publish_ai_fill");

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<"idle" | "saving" | "ok">("idle");
  const [listingId, setListingId] = useState<string | null>(d?.id ?? null);
  // "" is the seller themselves. A shop that is no longer theirs to publish for is dropped.
  // An agence's owner IS the agence (the owner's call, 2026-10-28): there is no
  // « Moi-même » for them — what they publish is the agence's, counted in the
  // offer it took. A draft they started without one goes to their agence too.
  const ownsShop = shops.some((s) => s.owner);
  const [shopId, setShopId] = useState<string>(() => {
    const wanted = d?.shop_id ?? initialShopId ?? shops.find((s) => s.owner)?.id ?? "";
    return shops.some((s) => s.id === wanted) ? wanted : ownsShop ? shops.find((s) => s.owner)!.id : "";
  });
  /** The submit route said the free places are full: the annonce stays a draft. */
  /** Which limit the submit route hit: the free places, or the agence's plan (with its size). */
  const [limitHit, setLimitHit] = useState<null | { kind: "free" } | { kind: "plan"; limit: number }>(null);
  const [done, setDone] = useState<null | {
    paidWith: string;
    remaining?: number;
    /** Free places still open after this one (a free publication only). */
    freeLeft?: number;
    /** "published" when the rules let it straight online; else "pending_review".
     *  An edit: "pending" — offline until an admin approves it (0176); "applied"
     *  came from servers before that. */
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
  // The rent terms are chips (src/lib/listings/choices.ts); « Autre » opens
  // the box. A deposit chosen in months follows the rent it is counted from,
  // so it is remembered as months, not only as the amount it came to.
  const [depositMode, setDepositMode] = useState<number | "other" | null>(() => {
    const dep = d?.deposit_amount != null ? String(d.deposit_amount) : "";
    const monthly = d?.price != null && Number(d.price) > 0 ? String(d.price) : "";
    return depositMonthsOf(dep, monthly) ?? (dep !== "" ? "other" : null);
  });
  // « Autre » tapped and nothing typed yet: the box stays open.
  const [chargesOther, setChargesOther] = useState(false);
  const [leaseOther, setLeaseOther] = useState(false);
  const [dateOther, setDateOther] = useState(false);
  // « Écrire la description pour moi »: the text it wrote last, to rewrite it
  // in place when asked again; and one waiting while the seller says what to
  // do with the words they typed.
  const [lastDescribed, setLastDescribed] = useState<string | null>(null);
  const [describePending, setDescribePending] = useState<string | null>(null);
  const [described, setDescribed] = useState(false);
  // The listing assistant (src/lib/ai/listing.ts): one sentence in, the
  // fields below filled, the seller still reviewing every step.
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiQuestions, setAiQuestions] = useState<string[]>([]);
  // Where the seller lives, not the first governorate in the alphabet. Most
  // people sell property in their own governorate, and "Ariana" was pre-filled
  // for all 24 of them — a wrong default nobody is prompted to correct, which
  // is worse than an empty field.
  const homeGovernorate = (TUNISIAN_GOVERNORATES as readonly string[]).includes(defaultGovernorate)
    ? defaultGovernorate
    : TUNISIAN_GOVERNORATES[0];
  const [governorate, setGovernorate] = useState<string>(d?.governorate ?? homeGovernorate);
  // One of the governorate's délégations (src/lib/delegations.ts). One typed
  // by hand before there was a list — « Ennasr » — is a neighbourhood: it
  // opens in « Quartier » rather than being lost.
  const [delegation, setDelegation] = useState(() => canonicalDelegation(d?.governorate ?? homeGovernorate, d?.delegation) ?? "");
  const [quartier, setQuartier] = useState(() =>
    d?.address?.trim() || (d?.delegation && !canonicalDelegation(d?.governorate ?? homeGovernorate, d.delegation) ? d.delegation : ""),
  );
  // Sorted the way the reader reads them: by the Arabic name on /ar.
  const delegationOptions = useMemo(
    () =>
      delegationsOf(governorate)
        .map((value) => ({ value, label: delegationLabel(value, locale) }))
        .sort((a, b) => a.label.localeCompare(b.label, locale)),
    [governorate, locale],
  );
  const [contactName, setContactName] = useState(d?.contact_name ?? defaultContactName);
  const [contactPhone, setContactPhone] = useState(d?.contact_phone ?? defaultContactPhone);
  // A number already known (the profile's, or the annonce's) shows as chosen,
  // with « Modifier »: two filled boxes read as two more things to fill in.
  const [contactOpen, setContactOpen] = useState(() => !phoneUsable(d?.contact_phone ?? defaultContactPhone));
  const profileNames = nameChoices(defaultContactName);
  const [attested, setAttested] = useState(false);
  const [resumed, setResumed] = useState(Boolean(d));
  // A draft of the other deal waits: nothing of the form shows until the
  // seller says whether they meant it.
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
  // Same order as the submit route: a shop's plan while it has room, then a
  // free place, then a pack credit. Past that the free places are full, and
  // the way on is Mazed Immo Pro — there is no fee per annonce any more.
  const shop = shops.find((s) => s.id === shopId) ?? null;
  // An agence owner's own annonce counts in their plan, like the agence's.
  const viaOwnPlan = !shop && !!ownPlan && ownPlan.left > 0;
  const viaPlan = (!!shop && (shop.planLeft ?? 0) > 0) || viaOwnPlan;
  const freeQuota = !viaPlan && freePlacesLeft > 0;
  const usingCredit = !viaPlan && !freeQuota && creditsLeft > 0;
  const limitReached = !editing && !viaPlan && !freeQuota && !usingCredit;
  // Said up front only when no shop of theirs could take it either.
  const showLimitBanner = limitReached && !shops.some((s) => (s.planLeft ?? 0) > 0);

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

  /** The price, and a deposit given in months along with it: « 2 mois » stays two months of the new rent. */
  function changePrice(v: string) {
    setPrice(v);
    if (rent && typeof depositMode === "number") {
      const dep = depositFor(v, depositMode);
      if (dep) setDeposit(dep);
    }
  }

  // ─── Rent terms, as chips ─────────────────────────────────────────────────
  // Tapping the chip already chosen clears the answer, as the yes/no
  // questions do: « not said » stays a real answer.
  // A deposit in months needs the rent — and not one kept « sur demande »,
  // which two months of it would print on the annonce.
  const rentGiven = !onRequest && Number(price) > 0;
  const chargesMode: "none" | "other" | null = chargesOther
    ? "other"
    : charges.trim() === ""
      ? null
      : Number(charges) === 0
        ? "none"
        : "other";
  const leaseMode = leaseOther ? "other" : presetOf(minLease, LEASE_MONTHS) ?? (minLease.trim() !== "" ? "other" : null);
  const availableMode = dateOther ? "date" : availableChoiceOf(availableFrom, today);

  function pickDeposit(mode: number | "other") {
    if (depositMode === mode) {
      setDepositMode(null);
      setDeposit("");
      return;
    }
    if (mode === "other") {
      // The amount the months came to stays in the box, to adjust.
      setDepositMode("other");
      return;
    }
    const dep = rentGiven ? depositFor(price, mode) : null;
    if (!dep) return;
    setDepositMode(mode);
    setDeposit(dep);
  }

  function pickCharges(mode: "none" | "other") {
    if (chargesMode === mode) {
      setChargesOther(false);
      setCharges("");
      return;
    }
    setChargesOther(mode === "other");
    setCharges(mode === "none" ? "0" : "");
  }

  function pickLease(mode: number | "other") {
    if (leaseMode === mode) {
      setLeaseOther(false);
      setMinLease("");
      return;
    }
    setLeaseOther(mode === "other");
    if (mode !== "other") setMinLease(String(mode));
  }

  function pickAvailable(mode: "now" | "inMonth" | "date") {
    if (availableMode === mode) {
      setDateOther(false);
      setAvailableFrom("");
      return;
    }
    setDateOther(mode === "date");
    if (mode === "now") setAvailableFrom(today);
    if (mode === "inMonth") setAvailableFrom(addMonths(today, 1));
  }

  /**
   * Fill the form from the seller's sentence. Only what the assistant could
   * read is set — every other field keeps what the seller typed — and what it
   * could not becomes the questions shown under the box. Nothing is saved
   * here that the seller would not see on the way to the summary.
   */
  async function fillFromSentence() {
    const text = aiText.trim();
    if (text.length < 12) {
      toast(t("aiTooShort"), "warning");
      return;
    }
    setAiBusy(true);
    try {
      const res = await fetch("/api/ai/listing-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = (await res.json().catch(() => ({}))) as { draft?: ListingDraft };
      if (!res.ok || !j.draft) {
        toast(apiError(j, t("aiFailed")), "error");
        return;
      }
      const dr = j.draft;
      setDeal(dr.deal);
      const cat = dr.categorySlug ? categories.find((c) => c.slug === dr.categorySlug) : undefined;
      if (cat) {
        setGroupId(cat.groupId);
        setCategoryId(cat.id);
      }
      if (dr.governorate) setGovernorate(dr.governorate);
      if (dr.delegation) {
        const listed = canonicalDelegation(dr.governorate ?? governorate, dr.delegation);
        if (listed) setDelegation(listed);
        else setQuartier(dr.delegation);
      }
      if (dr.price != null) {
        setPrice(String(dr.price));
        setOnRequest(false);
      }
      const read: Record<string, string> = {};
      if (dr.areaSqm != null) read.area_sqm = String(dr.areaSqm);
      if (dr.rooms != null) read.rooms = String(dr.rooms);
      if (dr.bathrooms != null) read.bathrooms = String(dr.bathrooms);
      if (dr.floor != null) read.floor = String(dr.floor);
      for (const [k, v] of Object.entries(dr.legal)) read[k] = v ? "true" : "false";
      setAttrs((a) => ({ ...a, ...read }));
      if (dr.deal === "rent") {
        if (dr.deposit != null) {
          setDeposit(String(dr.deposit));
          // « Caution deux mois » read as 2 400 lights « 2 mois », and follows the rent.
          setDepositMode(depositMonthsOf(String(dr.deposit), dr.price != null ? String(dr.price) : price) ?? "other");
        }
        if (dr.charges != null) {
          setCharges(String(dr.charges));
          setChargesOther(false);
        }
        if (dr.furnished) setFurnished(dr.furnished);
        if (dr.availableFrom) {
          setAvailableFrom(dr.availableFrom);
          setDateOther(false);
        }
        if (dr.minLeaseMonths != null) {
          setMinLease(String(dr.minLeaseMonths));
          setLeaseOther(false);
        }
      }
      if (dr.title) setTitle(dr.title);
      if (dr.description) setDescription(dr.description);
      setAiQuestions(dr.questions);
      toast(t("aiDone"), "success");
    } catch {
      toast(t("aiFailed"), "error");
    } finally {
      setAiBusy(false);
    }
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
    // « Appartement S+2 · 120 m² · La Marsa »: the type in the singular, the
    // rooms the way Tunisians say them for a home, the surface grouped.
    const area = Number(attrs.area_sqm) > 0 ? formatNumber(Number(attrs.area_sqm), locale) : null;
    const noun = t.has(`titleNoun.${category.slug}`) ? t(`titleNoun.${category.slug}` as "titleNoun.appartements") : category.label;
    const rooms = category.kind === "residential" && Number(attrs.rooms) > 0 ? `S+${Number(attrs.rooms)}` : null;
    const kind = [noun, rooms].filter(Boolean).join(" ");
    const where = delegation ? delegationLabel(delegation, locale) : governorateLabel(governorate, locale);
    const what = rent ? t("titleForRent", { category: kind }) : kind;
    return [what, area ? t("suggestedArea", { area }) : null, where]
      .filter(Boolean)
      .join(" · ");
  }, [category, attrs.area_sqm, attrs.rooms, delegation, governorate, locale, t, rent]);

  const title = titleTouched ? typedTitle : suggestedTitle;
  const setTitle = (v: string) => { setTitleTouched(true); setTypedTitle(v); };

  // ─── The description, written from the answers ────────────────────────────
  // src/lib/listings/describe.ts: a template in the page's language, no AI.
  // Every highlight line in this language counts as « not typed », whichever
  // category offered it.
  const highlightLines = useMemo(() => HIGHLIGHTS.map((h) => highlightLine(h, locale)), [locale]);
  const offeredHighlights = highlightsFor(category?.slug, category?.kind, deal);

  function describeFromAnswers(): string {
    const numberOf = (key: string): number | null => {
      if (!defs.some((def) => def.field_key === key && def.data_type === "number")) return null;
      const raw = attrs[key]?.trim() ?? "";
      return raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : null;
    };
    return describeListing({
      locale,
      deal,
      categorySlug: category?.slug ?? null,
      categoryLabel: category?.label ?? null,
      numbers: {
        area_sqm: numberOf("area_sqm"),
        rooms: numberOf("rooms"),
        bathrooms: numberOf("bathrooms"),
        floor: numberOf("floor"),
        year_built: numberOf("year_built"),
      },
      yes: defs
        .filter((def) => def.data_type === "boolean" && (attrs[def.field_key] === "true" || attrs[def.field_key] === "1"))
        .map((def) => ({ key: def.field_key, label: def.label })),
      governorate,
      delegation: delegation || null,
      quartier: quartier.trim() || null,
      furnished: rent && furnished ? furnished : null,
      availableFrom: rent && availableFrom ? availableFrom : null,
      today,
    });
  }

  function putDescription(text: string, generated: string) {
    setDescription(text.slice(0, 4000));
    setLastDescribed(generated);
    setDescribePending(null);
    setDescribed(true);
  }

  /** « Écrire la description pour moi »: in it goes, unless that would lose the seller's words — then it asks. */
  function writeForMe() {
    const generated = describeFromAnswers();
    const result = writeDescription(description, generated, { lastGenerated: lastDescribed, highlightLines });
    if ("ask" in result) {
      setDescribePending(generated);
      return;
    }
    putDescription(result.text, generated);
  }

  // ─── What is still missing, and where ─────────────────────────────────────
  // Each entry knows the field it belongs to, so a click takes the seller
  // straight there instead of leaving them to scan the page for it. `label`
  // is the sentence said under the field and in the summary's list; `name`
  // is the field alone, for « Il manque 2 informations : le prix et le titre ».
  const missing: { label: string; fieldId: string; name: string }[] = [];
  if (!categoryId) {
    missing.push({ label: t("missingCategory"), fieldId: "f-category", name: t("fieldName.category") });
  }
  if (photosUploading > 0) {
    missing.push({
      label: t("missingPhotosUploading", { count: photosUploading }),
      fieldId: "f-photos",
      name: t("fieldName.photos"),
    });
  } else if (photos.length === 0) {
    missing.push({ label: t("missingPhoto"), fieldId: "f-photos", name: t("fieldName.photos") });
  }
  for (const def of defs) {
    const v = attrs[def.field_key];
    // A figure no property has — a surface of 0 or −10 m² — is not an answer:
    // it is said under the field and in the summary, required or not, and the
    // form does not go on with it (2026-10-27 audit).
    if (attributeOutOfBounds(def.field_key, v)) {
      missing.push({
        label: t("invalidAttribute", { label: def.label.toLowerCase() }),
        fieldId: attributeFieldId(def.field_key),
        name: def.label.toLowerCase(),
      });
      continue;
    }
    if (!def.required) continue;
    if (v == null || String(v).trim() === "") {
      missing.push({
        label: t("missingAttribute", { label: def.label.toLowerCase() }),
        // The question itself, not the whole « Le bien » block.
        fieldId: attributeFieldId(def.field_key),
        name: def.label.toLowerCase(),
      });
    }
  }
  if (titleTooShort(title)) {
    missing.push({ label: t("missingTitle"), fieldId: "f-title", name: t("fieldName.title") });
  }
  if (!onRequest && !(Number(price) > 0)) {
    missing.push({
      label: t(rent ? "missingRent" : "missingPrice"),
      fieldId: "f-price",
      name: t(rent ? "fieldName.rent" : "fieldName.price"),
    });
  }
  if (!phoneUsable(contactPhone)) {
    missing.push({ label: t("missingPhone"), fieldId: "f-phone", name: t("fieldName.phone") });
  }
  // An edit does not re-sign: the attestation was given when it went online.
  if (!attested && !editing) {
    missing.push({ label: t("missingAttestation"), fieldId: "f-attestation", name: t("fieldName.attestation") });
  }

  // Red only survives while the field is still empty: fill it and the outline
  // goes on its own, without the seller having to dismiss anything.
  const missingIds = new Set(missing.map((m) => m.fieldId));
  const flaggedNow = new Set(flagged.filter((id) => missingIds.has(id)));
  /** The sentence to say under a field the seller was sent to, while it is still missing. */
  const errorFor = (id: string) =>
    flaggedNow.has(id) ? missing.find((m) => m.fieldId === id)?.label ?? null : null;

  /** Scroll to whatever is missing and put the cursor in it. */
  function goToField(id: string) {
    // Mark it before scrolling: by the time the smooth scroll lands the field
    // is already outlined, so it is obvious which one was meant.
    setFlagged((f) => (f.includes(id) ? f : [...f, id]));
    const target = stepOfField(id);
    if (target !== undefined && target !== step) setStep(target);
    // After the step has rendered, if it had to change.
    setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      // A block whose first control is not the missing one (the category
      // sits under the family switch) marks the one to land on.
      (
        el.querySelector<HTMLElement>("[data-focus-target]") ??
        el.querySelector<HTMLElement>("input, select, textarea, button")
      )?.focus({ preventScroll: true });
    }, 60);
  }

  function goToStep(s: Step) {
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** On to the next step, unless this one still lacks something. */
  function next() {
    const pending = missingOnStep(missing, step, { photosUploading: photosUploading > 0 });
    if (pending.length > 0) {
      // Every one turns red with its sentence under it, the cursor goes to
      // the first, and the toast names them all — not just how many.
      setFlagged((f) => Array.from(new Set([...f, ...pending.map((m) => m.fieldId)])));
      goToField(pending[0].fieldId);
      toast(
        t("stepMissing", { count: pending.length, fields: listOfFields(pending.map((m) => m.name), locale) }),
        "warning",
      );
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

  // A zero too many or too few (src/lib/listings/priceCheck.ts): the figure
  // read back in words, and a ×10 / ÷10 offered when it is ten times off what
  // annonces like it ask. « C'est bien ça » silences it for that figure.
  const [keptPrices, setKeptPrices] = useState<string[]>([]);
  const priceNumber = Number(price);
  // What annonces like this one ask: in this governorate when there are
  // enough of them, else across Tunisia.
  const localRef = categoryId && governorate ? priceRefs[`${categoryId}:${deal}:${governorate}`] : undefined;
  const nationalRef = categoryId ? priceRefs[`${categoryId}:${deal}`] : undefined;
  const priceRef = (localRef?.median != null ? localRef : null) ?? nationalRef ?? null;
  const areaNumber = Number(attrs.area_sqm) > 0 ? Number(attrs.area_sqm) : null;
  // Price help switched off: no estimate, no figure in words, no « un zéro de
  // trop » here or in the summary's tips. The price field itself stays.
  const estimate = priceHelp
    ? estimateRange(localRef?.perSqmLow ? localRef : nationalRef ?? null, areaNumber, rent)
    : null;
  const estimateIsLocal = !!(localRef?.perSqmLow && areaNumber);
  // Only while the estimate shows: price help on, comparables, a surface.
  const priceChips = onRequest ? [] : estimateChips(estimate, rent);
  const priceWords = priceHelp && !onRequest && priceNumber > 0 ? priceInWords(priceNumber, locale) : null;
  const priceFix =
    priceHelp && !onRequest && priceNumber > 0 && !keptPrices.includes(price)
      ? suggestPriceFix({
          price: priceNumber,
          areaSqm: Number(attrs.area_sqm) > 0 ? Number(attrs.area_sqm) : null,
          ref: priceRef,
          kind: (category?.kind as CategoryKind | undefined) ?? null,
          dealType: deal,
        })
      : null;
  const tips: { key: string; ok: boolean; text: string; fieldId: string }[] = [
    {
      key: "photos",
      ok: photos.length >= minPhotos,
      text:
        photos.length >= minPhotos
          ? t("tipPhotosOk", { count: photos.length })
          : t("tipPhotos", { min: minPhotos }),
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
      ? [
          priceFix != null
            ? { key: "price", ok: false, text: t("tipPriceTypo", { fix: `${formatTND(priceFix, locale)} ${tc("tnd")}` }), fieldId: "f-price" }
            : { key: "price", ok: priceOk, text: priceOk ? t("tipPriceOk") : t(rent ? "tipPriceRent" : "tipPrice"), fieldId: "f-price" },
        ]
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
    setDraftInAddress(null);
    setResumed(false);
    // Back to the first step: a fresh form left on the old draft's photos
    // step reads as if the photos had been lost.
    setStep(0);
    setFlagged([]);
    // The old draft's "nothing to write yet" no longer holds: the first
    // answer of the new annonce saves it.
    firstRun.current = false;
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
    setDepositMode(null);
    setCharges("");
    setChargesOther(false);
    setFurnished("");
    setAvailableFrom("");
    setDateOther(false);
    setMinLease("");
    setLeaseOther(false);
    setLastDescribed(null);
    setDescribePending(null);
    setDescribed(false);
    setGovernorate(homeGovernorate);
    setDelegation("");
    setQuartier("");
    setContactName(defaultContactName);
    setContactPhone(defaultContactPhone);
    setContactOpen(!phoneUsable(defaultContactPhone));
    setAttested(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ─── Persistence ──────────────────────────────────────────────────────────
  /** ?draft= in the address bar, without a navigation. */
  function setDraftInAddress(id: string | null) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("draft", id);
    else url.searchParams.delete("draft");
    window.history.replaceState(window.history.state, "", url);
  }

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
        delegation: delegation || null,
        address: quartier.trim() || null,
        // Typed on the way out: the form holds strings because inputs do, but
        // `attributes` feeds the filters, and "120" is not 120 to a range query.
        attributes: typedAttributes(defs, attrs),
        photos: photos.map((p, i) => ({ storage_path: p.path, sort_order: i })),
        // Only sent when there is a choice to make, so a seller with no shop never touches it.
        ...(shops.length > 0 || d?.shop_id ? { shop_id: shopId || null } : {}),
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
    // The address names the draft from its first save on: a refresh reopens
    // it instead of an empty form (2026-10-27 audit). « Publier » from the
    // menu is a new address, and still starts clean.
    if (!listingId && !editing) setDraftInAddress(j.id);
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
    // An edit of a live annonce is sent whole at the end; writing it as the
    // seller types would change what buyers see before anything checked it.
    if (editing) return;
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
    price, onRequest, negotiable, governorate, delegation, quartier, contactName, contactPhone,
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

  /** Send the new version of a live annonce (POST /api/annonces/:id/edit). */
  async function sendEdit() {
    if (!listingId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/annonces/${listingId}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category_id: categoryId,
          title: title.trim(),
          description: description.trim() || null,
          price: onRequest ? null : Number(price) || 0,
          price_on_request: onRequest,
          negotiable,
          deal_type: deal,
          deposit_amount: rent && deposit.trim() !== "" ? Number(deposit) : null,
          charges_amount: rent && charges.trim() !== "" ? Number(charges) : null,
          furnished: rent && furnished ? furnished : null,
          available_from: rent && availableFrom ? availableFrom : null,
          min_lease_months: rent && minLease.trim() !== "" ? Number(minLease) : null,
          governorate,
          delegation: delegation || null,
          address: quartier.trim() || null,
          attributes: typedAttributes(defs, attrs),
          photos: photos.map((p, i) => ({ storage_path: p.path, sort_order: i })),
          contact_name: contactName.trim() || null,
          contact_phone: contactPhone.trim(),
          contact_whatsapp: contactPhone.trim(),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { status?: string; error?: string; detail?: string };
      if (!res.ok) {
        toast(apiError(j, t("editFailed")), "error");
        return;
      }
      setDone({ paidWith: "none", status: j.status ?? "pending", id: listingId });
      if (j.status === "published") setWaiting(false);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (editing) return sendEdit();
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
        status?: string; paidWith?: string; remaining?: number; freeLeft?: number;
        error?: string; detail?: string; limit?: number;
      };
      if (j.error === "free_limit_reached") {
        // Saved as a draft above; the popup says what to do with it.
        setLimitHit({ kind: "free" });
        return;
      }
      if (j.error === "plan_full") {
        // The agence's plan, not the free places: the popup names the plan.
        setLimitHit({ kind: "plan", limit: typeof j.limit === "number" ? j.limit : 0 });
        return;
      }
      if (!res.ok) {
        toast(apiError(j, t("submitFailed")), "error");
        return;
      }
      setDone({
        paidWith: j.paidWith ?? "free_quota",
        remaining: j.remaining,
        freeLeft: j.freeLeft,
        status: j.status ?? "pending_review",
        id,
      });
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
          {done.status === "applied"
            ? t("editAppliedTitle")
            : done.paidWith === "none" && done.status === "pending_review"
              ? t("editWaitingTitle")
            : done.status === "pending"
              ? t("editPendingTitle")
              : done.status === "published"
                ? t("donePublishedTitle")
                : t("doneTitle")}
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          {done.status === "applied"
            ? t("editAppliedBody")
            : done.paidWith === "none" && done.status === "pending_review"
              ? t("editWaitingBody")
            : done.status === "pending"
              ? t("editPendingBody")
              : done.status === "published"
                ? t("donePublishedBody")
                : t("doneBody")}
          {done.paidWith === "credit" && typeof done.remaining === "number" && (
            <> {t("doneCreditsLeft", { count: done.remaining })}</>
          )}
          {done.paidWith === "subscription" && typeof done.remaining === "number" && (
            <> {t("doneSubscription", { count: done.remaining })}</>
          )}
        </p>
        {/* The free places, counted: how many are left, and what comes after. */}
        {done.paidWith === "free_quota" && (
          <div className="mt-4 rounded-2xl bg-surface-2 p-4 text-start ring-1 ring-border">
            <p className="inline-flex items-center gap-1.5 text-[13px] font-extrabold text-[var(--tone-ok)]">
              <Gift className="size-4" /> {t("doneFreeQuota")}
            </p>
            {typeof done.freeLeft === "number" && (
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                {t("doneFreeLeft", { left: done.freeLeft, limit: freeLimit })}
                {done.freeLeft === 0 && (
                  <>
                    {" "}
                    <Link href={"/pro" as never} className="font-bold text-gold underline-offset-2 hover:underline">
                      {t("seePro")}
                    </Link>
                  </>
                )}
              </p>
            )}
          </div>
        )}
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
          {/* A typo seen on this screen — a zero too many — is one tap from
              fixed, while an admin lets annonces be edited at all. */}
          {canEdit && (done.status === "published" || done.status === "pending_review") && (
            <button
              // Already editing it: back to the form as just sent.
              onClick={() => (editing ? setDone(null) : router.push(`/annonces/nouvelle?edit=${done.id}` as never))}
              className="tap-target inline-flex items-center gap-1.5 rounded-full border border-border px-6 py-3 text-[13.5px] font-bold text-foreground"
            >
              <Pencil className="size-4" /> {t("correct")}
            </button>
          )}
          {(done.status === "published" || done.status === "applied") && (
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
  // « Sur demande » only when the seller chose it. An empty price used to
  // read as « Sur demande » here while the list below still asked for one.
  const priceText = onRequest
    ? t("priceOnRequestShort")
    : !(Number(price) > 0)
      ? t(rent ? "rentNotGiven" : "priceNotGiven")
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
          : def.field_key === "floor" && def.data_type === "number" && Number(raw) === 0
            ? t("chips.groundFloor")
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
          <>{editing ? t("saveChanges") : t("publishCta")}</>
        )}
      </button>
    );

  const editNote = waiting ? t("editWaitingNote") : t("editFreeNote");
  const feeHint = editing
    ? editNote
    : viaOwnPlan
    ? // Publishing as themselves, inside the plan of the agence they own: no
      // agence is chosen, so the name is the owned one's. It read shop!.name
      // here and the whole page crashed for those owners (2026-10-28).
      t("planHint", { name: ownPlan!.shopName })
    : viaPlan
    ? t("planHint", { name: shop!.name })
    : freeQuota
    ? t("freeQuotaHint")
    : usingCredit
      ? t("useOneCredit", { count: creditsLeft })
      : t("limitHint");

  return (
    <main className="mx-auto max-w-[var(--max-w-wide)] px-4 pb-44 pt-4 lg:px-6 lg:pb-12 lg:pt-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start justify-between gap-3 pt-2">
          <div>
            <h1 className="text-[24px] font-extrabold tracking-tight">{editing ? t("editTitle") : t("title")}</h1>
            <p className="mt-1 text-[13px] text-muted">
              {editing ? (waiting ? t("editWaitingSubtitle") : t("editSubtitle")) : t("subtitle")}
            </p>
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

        {editing && (
          <div className="mt-4 rounded-2xl border border-gold-soft bg-gold-faint px-4 py-3 text-[12.5px] leading-relaxed text-foreground">
            <p className="font-semibold">{waiting ? t("editWaitingBanner") : t("editBanner")}</p>
            {editPending && <p className="mt-0.5 text-muted">{t("editPendingBanner")}</p>}
          </div>
        )}

        {/* The free places are full: said before the seller fills four steps,
            not after. The form still saves a draft for when a place frees up. */}
        {showLimitBanner && (
          <div className="mazed-tone-warn mt-4 rounded-2xl px-4 py-3 text-[12.5px] leading-relaxed">
            <p className="font-extrabold">{t("limitTitle", { limit: freeLimit })}</p>
            <p className="mt-0.5">{t("limitBannerBody")}</p>
            {!paymentsOpen && <p className="mt-1 font-semibold">{t("limitPaymentsClosed")}</p>}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {paymentsOpen ? (
                <Link href={"/pro" as never} className="inline-flex items-center gap-1.5 font-bold underline-offset-2 hover:underline">
                  <Store className="size-3.5" /> {t("seePro")}
                </Link>
              ) : (
                <Link href={"/contact" as never} className="inline-flex items-center gap-1.5 font-bold underline-offset-2 hover:underline">
                  <Store className="size-3.5" /> {t("contactForPro")}
                </Link>
              )}
              <Link href={"/account/listings" as never} className="font-bold underline-offset-2 hover:underline">
                {t("seeMyListings")}
              </Link>
            </div>
          </div>
        )}

        {chatOn && aiAvailable && !editing && !resumed && (
          <Link
            href={"/annonces/nouvelle/parler" as never}
            className="mt-4 flex items-center gap-3 rounded-2xl border border-gold-soft bg-gold-faint px-4 py-3 transition hover:border-gold"
          >
            <Sparkles className="size-5 shrink-0 text-gold" />
            <span className="min-w-0">
              <span className="block text-[13px] font-extrabold text-foreground">{t("tryChat")}</span>
              <span className="block text-[12px] text-muted">{t("tryChatHint")}</span>
            </span>
          </Link>
        )}

        {resumed && !editing && (
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
              {/* Say it in a sentence — the assistant fills the steps, the
                  seller checks them. Only offered when it can answer. */}
              {aiAvailable && aiFillOn && (
                <section className="rounded-2xl border border-gold-soft bg-gold-faint p-4 sm:p-5">
                  <SectionHead id="f-ai-title" icon={Sparkles} title={t("aiTitle")} />
                  <p id="f-ai-hint" className="mt-1 text-[12.5px] leading-relaxed text-muted">{t("aiHint")}</p>
                  <textarea
                    aria-labelledby="f-ai-title"
                    aria-describedby="f-ai-hint f-ai-privacy"
                    value={aiText}
                    onChange={(e) => setAiText(e.target.value)}
                    rows={3}
                    maxLength={800}
                    dir="auto"
                    placeholder={t("aiPlaceholder")}
                    className="mt-3 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-[14px] leading-relaxed text-foreground placeholder:text-muted focus:border-gold focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={fillFromSentence}
                    disabled={aiBusy}
                    className="mazed-btn-luxe tap-target mt-2 inline-flex h-11 items-center gap-2 px-5 text-[13px] disabled:opacity-60"
                  >
                    {aiBusy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    {aiBusy ? t("aiWorking") : t("aiCta")}
                  </button>
                  {aiQuestions.length > 0 && (
                    <div className="mt-3 rounded-xl bg-surface p-3 ring-1 ring-border">
                      <p className="text-[12px] font-bold text-foreground">{t("aiQuestions")}</p>
                      <ul className="mt-1 list-disc space-y-0.5 ps-5 text-[12.5px] text-foreground">
                        {aiQuestions.map((q) => (
                          <li key={q} dir="auto">{q}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p id="f-ai-privacy" className="mt-2 text-[11px] leading-snug text-muted">{t("aiPrivacy")}</p>
                </section>
              )}

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

                  <div
                    role="radiogroup"
                    aria-label={t("categoryAria")}
                    aria-required="true"
                    aria-invalid={errorFor("f-category") ? true : undefined}
                    aria-describedby={errorFor("f-category") ? "f-category-error" : undefined}
                    // Where « Continuer » lands when no type is chosen: the
                    // group, which then reads as required and what is missing.
                    data-focus-target
                    tabIndex={-1}
                    className="mt-2.5 flex flex-wrap gap-1.5 focus:outline-none"
                  >
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
                              "tap-target inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-bold transition",
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
                  {errorFor("f-category") && <FieldError id="f-category-error">{errorFor("f-category")}</FieldError>}

                  {/* What publishing costs, said once — free for most sellers. */}
                  {category && !editing && (freeQuota || limitReached) && (
                    <p
                      className={cn(
                        "mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] font-bold",
                        freeQuota ? "text-[var(--tone-ok)]" : "text-muted",
                      )}
                    >
                      {freeQuota ? (
                        <><Gift className="size-3.5" /> {t("freeQuotaHint")}</>
                      ) : (
                        <span>{t("limitHint")}</span>
                      )}
                    </p>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
                <SectionHead icon={MapPin} title={t("locationTitle")} />
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="f-governorate">{t("governorate")} <Req /></Label>
                    <div className="relative mt-1">
                      <MapPin className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                      <select
                        id="f-governorate"
                        aria-required="true"
                        value={governorate}
                        onChange={(e) => {
                          setGovernorate(e.target.value);
                          // A délégation belongs to one governorate.
                          if (!delegationsOf(e.target.value).includes(delegation)) setDelegation("");
                        }}
                        className="w-full appearance-none rounded-xl border border-border bg-surface py-3 ps-9 pe-3 text-[14px] text-foreground focus:border-gold focus:outline-none"
                      >
                        {TUNISIAN_GOVERNORATES.map((g) => (
                          <option key={g} value={g}>{governorateLabel(g, locale)}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {/* The governorate's délégations, the way a Tunisian address is
                      written; the catalogue filters on it. */}
                  <div>
                    <Label htmlFor="f-delegation">{t("delegationLabel")}</Label>
                    <div className="relative mt-1">
                      <select
                        id="f-delegation"
                        value={delegation}
                        onChange={(e) => setDelegation(e.target.value)}
                        className="w-full appearance-none rounded-xl border border-border bg-surface px-3 py-3 text-[14px] text-foreground focus:border-gold focus:outline-none"
                      >
                        <option value="">{t("delegationPlaceholder")}</option>
                        {delegationOptions.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="col-span-2">
                    <Field
                      label={t("quartierLabel")}
                      value={quartier}
                      onChange={setQuartier}
                      placeholder={t("quartierPlaceholder")}
                    />
                  </div>
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
                {/* Not while photos are on their way: the uploader says so itself. */}
                {photosUploading === 0 && errorFor("f-photos") && (
                  <FieldError id="f-photos-error">{errorFor("f-photos")}</FieldError>
                )}
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
                    <Label htmlFor="f-price-input">{t(rent ? "rentLabel" : "priceLabel")} {!onRequest && <Req />}</Label>
                    {/* The box is left-to-right as a whole, not only the input:
                        with just the input flipped, its padding sat on the right
                        while the currency label followed the page to the left,
                        and on /ar the figure ran under « د.ت ». */}
                    <div dir="ltr" className="relative mt-1">
                      <input
                        id="f-price-input"
                        // The currency, and the estimate and the figure in words
                        // while they show: read after the name, as a sighted
                        // seller reads them around the box.
                        aria-describedby={
                          [
                            "f-price-unit",
                            errorFor("f-price") ? "f-price-error" : null,
                            estimate && !onRequest ? "f-price-estimate" : null,
                            priceWords ? "f-price-words" : null,
                          ]
                            .filter(Boolean)
                            .join(" ")
                        }
                        aria-required={!onRequest}
                        aria-invalid={errorFor("f-price") ? true : undefined}
                        type="number"
                        inputMode="decimal"
                        dir="ltr"
                        value={price}
                        disabled={onRequest}
                        onChange={(e) => changePrice(e.target.value)}
                        placeholder={rent ? "1200" : "250000"}
                        className={cn(
                          "w-full rounded-xl border border-border bg-surface px-3 py-3 text-[16px] font-bold text-foreground placeholder:font-normal placeholder:text-muted focus:border-gold focus:outline-none disabled:opacity-40",
                          rent ? "pe-28" : "pe-16",
                        )}
                      />
                      <span id="f-price-unit" className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[13px] font-bold text-muted">
                        {rent ? t("tndPerMonth") : tc("tnd")}
                      </span>
                    </div>
                    {errorFor("f-price") && <FieldError id="f-price-error">{errorFor("f-price")}</FieldError>}
                    {estimate && !onRequest && (
                      <p id="f-price-estimate" className="mt-1.5 text-[12px] leading-snug text-muted">
                        {t(estimateIsLocal ? "estimateLocal" : "estimateNational", {
                          low: `${formatTND(estimate.low, locale)}`,
                          high: `${formatTND(estimate.high, locale)} ${rent ? t("tndPerMonth") : tc("tnd")}`,
                          governorate: governorateLabel(governorate, locale),
                          count: (estimateIsLocal ? localRef?.count : nationalRef?.count) ?? 0,
                        })}
                      </p>
                    )}
                    {/* The estimate's low end, middle and high end, one tap each. */}
                    {priceChips.length > 0 && (
                      <div role="radiogroup" aria-label={t("estimatePick")} className="mt-2 flex flex-wrap gap-2">
                        {priceChips.map((v) => {
                          const on = Number(price) === v;
                          return (
                            <Chip key={v} on={on} onClick={() => changePrice(on ? "" : String(v))}>
                              {money(v)}
                            </Chip>
                          );
                        })}
                      </div>
                    )}
                    {priceWords && (
                      <p id="f-price-words" className="mt-1.5 text-[12.5px] font-semibold text-muted" aria-live="polite">
                        = {priceWords}
                        {rent ? ` ${t("perMonthWords")}` : ""}
                      </p>
                    )}
                    {priceFix != null && (
                      <div role="alert" className="mt-2.5 rounded-xl bg-[var(--tone-warn-bg)] p-3 text-[12.5px] leading-relaxed text-foreground ring-1 ring-[var(--tone-warn-ring)]">
                        <p className="flex items-start gap-1.5 font-bold">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--tone-warn)]" /> {t("priceFixTitle")}
                        </p>
                        <p className="mt-1">
                          {t("priceFixBody", {
                            typed: `${formatTND(priceNumber, locale)} ${tc("tnd")}`,
                            fix: `${formatTND(priceFix, locale)} ${tc("tnd")}`,
                          })}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => changePrice(String(priceFix))}
                            className="tap-target inline-flex h-9 items-center rounded-full bg-foreground px-3.5 text-[12.5px] font-bold text-[var(--background)]"
                          >
                            {t("priceFixApply", { fix: `${formatTND(priceFix, locale)} ${tc("tnd")}` })}
                          </button>
                          <button
                            type="button"
                            onClick={() => setKeptPrices((k) => [...k, price])}
                            className="tap-target inline-flex h-9 items-center rounded-full border border-border bg-surface px-3.5 text-[12.5px] font-bold text-foreground"
                          >
                            {t("priceFixKeep")}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <Toggle label={t("negotiable")} on={negotiable} onClick={() => setNegotiable((v) => !v)} />
                      <Toggle label={t("onRequest")} on={onRequest} onClick={() => setOnRequest((v) => !v)} />
                    </div>
                  </div>

                  {rent && (
                    <div id="f-rent" className="grid scroll-mt-24 gap-4 sm:grid-cols-2">
                      {/* The deposit, counted in months of the rent above. */}
                      <div>
                        <Label id="f-deposit-label">{t("depositLabel")}</Label>
                        <div
                          role="radiogroup"
                          aria-labelledby="f-deposit-label"
                          aria-describedby={rentGiven ? undefined : "f-deposit-hint"}
                          className="mt-1.5 flex flex-wrap gap-2"
                        >
                          {DEPOSIT_MONTHS.map((m) => (
                            <Chip key={m} on={depositMode === m} disabled={!rentGiven} onClick={() => pickDeposit(m)}>
                              {t("chips.months", { count: m })}
                            </Chip>
                          ))}
                          <Chip on={depositMode === "other"} onClick={() => pickDeposit("other")}>
                            {t("chips.otherAmount")}
                          </Chip>
                        </div>
                        {!rentGiven && (
                          <p id="f-deposit-hint" className="mt-1.5 text-[11.5px] leading-snug text-muted">{t("depositNeedsRent")}</p>
                        )}
                        {typeof depositMode === "number" && deposit.trim() !== "" && (
                          <p className="mt-1.5 text-[12.5px] font-semibold text-muted" aria-live="polite">
                            {t("depositIs", { amount: money(Number(deposit)) })}
                          </p>
                        )}
                        {depositMode === "other" && (
                          <div className="mt-2">
                            <Field labelledBy="f-deposit-label" type="number" value={deposit} onChange={setDeposit} placeholder="2400" suffix={tc("tnd")} compact />
                          </div>
                        )}
                      </div>
                      <div>
                        <Label id="f-charges-label">{t("chargesLabel")}</Label>
                        <div role="radiogroup" aria-labelledby="f-charges-label" className="mt-1.5 flex flex-wrap gap-2">
                          <Chip on={chargesMode === "none"} onClick={() => pickCharges("none")}>{t("chips.noCharges")}</Chip>
                          <Chip on={chargesMode === "other"} onClick={() => pickCharges("other")}>{t("chips.otherAmount")}</Chip>
                        </div>
                        {chargesMode === "other" && (
                          <div className="mt-2">
                            <Field labelledBy="f-charges-label" type="number" value={charges} onChange={setCharges} placeholder="80" suffix={tc("tnd")} compact />
                          </div>
                        )}
                      </div>
                      <div className="sm:col-span-2">
                        <Label id="f-furnished-label">{t("furnishedLabel")}</Label>
                        <div role="radiogroup" aria-labelledby="f-furnished-label" className="mt-1.5 flex flex-wrap gap-2">
                          {FURNISHED.map((f) => (
                            <button
                              key={f}
                              type="button"
                              role="radio"
                              aria-checked={furnished === f}
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
                      <div>
                        <Label id="f-available-label">{t("availableFromLabel")}</Label>
                        <div role="radiogroup" aria-labelledby="f-available-label" className="mt-1.5 flex flex-wrap gap-2">
                          <Chip on={availableMode === "now"} onClick={() => pickAvailable("now")}>{t("chips.now")}</Chip>
                          <Chip on={availableMode === "inMonth"} onClick={() => pickAvailable("inMonth")}>{t("chips.inMonth")}</Chip>
                          <Chip on={availableMode === "date"} onClick={() => pickAvailable("date")}>{t("chips.pickDate")}</Chip>
                        </div>
                        {availableMode === "date" && (
                          <div className="mt-2">
                            <Field labelledBy="f-available-label" type="date" value={availableFrom} onChange={setAvailableFrom} compact />
                          </div>
                        )}
                      </div>
                      <div>
                        <Label id="f-lease-label">{t("minLeaseLabel")}</Label>
                        <div role="radiogroup" aria-labelledby="f-lease-label" className="mt-1.5 flex flex-wrap gap-2">
                          {LEASE_MONTHS.map((m) => (
                            <Chip key={m} on={leaseMode === m} onClick={() => pickLease(m)}>
                              {t("chips.months", { count: m })}
                            </Chip>
                          ))}
                          <Chip on={leaseMode === "other"} onClick={() => pickLease("other")}>{t("chips.otherLease")}</Chip>
                        </div>
                        {leaseMode === "other" && (
                          <div className="mt-2">
                            <Field labelledBy="f-lease-label" type="number" value={minLease} onChange={setMinLease} placeholder="36" suffix={t("monthsUnit")} compact />
                          </div>
                        )}
                      </div>
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
                      error={errorFor("f-title")}
                    />
                    {/* Typed over, then the surface or the place changed: the
                        proposed title is one tap away again, and follows them. */}
                    {titleTouched && suggestedTitle && typedTitle.trim() !== suggestedTitle && (
                      <button
                        type="button"
                        onClick={() => {
                          setTitleTouched(false);
                          setTypedTitle("");
                        }}
                        className="tap-target mt-1 inline-flex items-center gap-1.5 text-start text-[12px] font-bold text-gold underline-offset-2 hover:underline"
                      >
                        <RotateCcw className="size-3.5 shrink-0 rtl:-scale-x-100" />
                        <span dir="auto">{t("titleUseSuggested", { title: suggestedTitle })}</span>
                      </button>
                    )}
                  </div>
                </div>
              </section>

              <section id="f-details" className="scroll-mt-24 rounded-2xl border border-border bg-surface p-4 sm:p-5">
                <SectionHead icon={ClipboardList} title={t("detailsTitle")} />
                <p className="mt-1 text-[13px] text-muted">
                  {categoryId ? t("detailsHint") : t("detailsPickCategory")}
                </p>

                {defs.length > 0 ? (
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    {defs.map((def) => {
                      const fid = attributeFieldId(def.field_key);
                      return (
                        <div key={def.field_key} id={fid} className={`scroll-mt-24 rounded-xl${flagCls(fid)}`}>
                          <AttributeField
                            def={def}
                            value={attrs[def.field_key] ?? ""}
                            onChange={(v) => setAttrs((s) => ({ ...s, [def.field_key]: v }))}
                            error={errorFor(fid)}
                            categorySlug={category?.slug ?? null}
                            currentYear={Number(today.slice(0, 4))}
                            locale={locale}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  categoryId && (
                    <p className="mt-5 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] text-muted">
                      {t("detailsNone")}
                    </p>
                  )
                )}

                <div id="f-description" className="mt-5 scroll-mt-24">
                  <Label htmlFor="f-description-input">{t("descriptionLabel")}</Label>
                  {/* The longest thing to type on the form, written from what
                      was chosen above. It stays the seller's text to edit. */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <button
                      type="button"
                      onClick={writeForMe}
                      aria-describedby="f-describe-hint"
                      className="tap-target inline-flex items-center gap-2 rounded-full bg-gold-faint px-4 py-2 text-[13px] font-bold text-gold ring-1 ring-gold-soft transition hover:ring-gold"
                    >
                      <WandSparkles className="size-4 shrink-0" />
                      {t("describeCta")}
                    </button>
                    <p id="f-describe-hint" aria-live="polite" className="min-w-0 flex-1 basis-48 text-[11.5px] leading-snug text-muted">
                      {described ? t("describeDone") : t("describeHint")}
                    </p>
                  </div>
                  {describePending && (
                    <div role="group" aria-labelledby="f-describe-ask" className="mt-2 rounded-xl bg-surface-2 p-3 ring-1 ring-border">
                      <p id="f-describe-ask" className="text-[12.5px] font-semibold leading-snug text-foreground">{t("describeAsk")}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => putDescription(appendDescription(description, describePending), describePending)}
                          className="tap-target rounded-full bg-[var(--gold)] px-4 py-2 text-[13px] font-bold text-white"
                        >
                          {t("describeAppend")}
                        </button>
                        <button
                          type="button"
                          onClick={() => putDescription(replaceDescription(description, describePending, highlightLines), describePending)}
                          className="tap-target rounded-full bg-surface px-4 py-2 text-[13px] font-bold text-muted ring-1 ring-border hover:text-foreground"
                        >
                          {t("describeReplace")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDescribePending(null)}
                          className="tap-target rounded-full px-4 py-2 text-[13px] font-bold text-muted hover:text-foreground"
                        >
                          {t("describeCancel")}
                        </button>
                      </div>
                    </div>
                  )}
                  <textarea
                    id="f-description-input"
                    aria-describedby="f-description-count"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    maxLength={4000}
                    dir="auto"
                    placeholder={t("descriptionPlaceholder")}
                    className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-[13.5px] leading-relaxed text-foreground placeholder:text-muted focus:border-gold focus:outline-none"
                  />
                  <p id="f-description-count" className="mt-1 text-end text-[10.5px] text-muted">
                    <Ltr>{description.length} / 4000</Ltr>
                  </p>

                  {/* One line each, added once; tapped again, that line goes. */}
                  {offeredHighlights.length > 0 && (
                    <div className="mt-3">
                      <Label id="f-highlights-label">{t("highlightsLabel")}</Label>
                      <p id="f-highlights-hint" className="mt-0.5 text-[11.5px] leading-snug text-muted">{t("highlightsHint")}</p>
                      <div
                        role="group"
                        aria-labelledby="f-highlights-label"
                        aria-describedby="f-highlights-hint"
                        className="mt-1.5 flex flex-wrap gap-2"
                      >
                        {offeredHighlights.map((h) => {
                          const line = highlightLine(h, locale);
                          return (
                            <Chip
                              key={h}
                              toggle
                              on={hasLine(description, line)}
                              onClick={() => setDescription((text) => toggleLine(text, line).slice(0, 4000))}
                            >
                              {t(`highlights.${h}`)}
                            </Chip>
                          );
                        })}
                      </div>
                    </div>
                  )}
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
                      <p
                        className={cn(
                          "mazed-tabular mt-1",
                          priceKnown ? "text-[15px] font-extrabold" : "text-[13px] font-semibold italic text-muted",
                        )}
                      >
                        {priceText}
                      </p>
                      <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted">
                        <MapPin className="size-3" /> {delegation ? delegationLabel(delegation, locale) : governorateLabel(governorate, locale)}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <SummaryBlock title={t("steps.where")} editLabel={t("edit")} onEdit={() => goToStep(0)}>
                      {[
                        t(rent ? "dealRent" : "dealSale"),
                        category?.label ?? "—",
                        governorateLabel(governorate, locale),
                        delegation ? delegationLabel(delegation, locale) : "",
                        quartier.trim(),
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
                      <span className={cn("block", priceKnown ? "font-bold text-foreground" : "italic")}>
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

              <section id="f-contact" className="scroll-mt-24 rounded-2xl border border-border bg-surface p-4 sm:p-5">
                <SectionHead icon={Phone} title={t("contactTitle")} />
                <p className="mt-1 text-[13px] text-muted">{t("contactHint")}</p>

                <div className="mt-5 space-y-4">
                  {!contactOpen && phoneUsable(contactPhone) ? (
                    // Already known: said as chosen, with the way to change it.
                    <div
                      id="f-phone"
                      className="flex scroll-mt-24 items-center gap-3 rounded-2xl bg-surface-2 p-3.5 ring-1 ring-border"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gold-faint text-gold ring-1 ring-gold-soft">
                        <User className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        {contactName.trim() ? (
                          <p dir="auto" className="truncate text-[14px] font-extrabold text-foreground">{contactName.trim()}</p>
                        ) : (
                          <p className="text-[13px] font-semibold italic text-muted">{t("contactNoName")}</p>
                        )}
                        <p className="mt-0.5 text-[13.5px] font-bold text-foreground">
                          <Ltr>{contactPhone.trim()}</Ltr>
                        </p>
                        {contactName === defaultContactName && contactPhone === defaultContactPhone && (
                          <p className="mt-0.5 text-[11px] text-muted">{t("contactFromProfile")}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setContactOpen(true)}
                        aria-label={t("contactEdit")}
                        className="tap-target inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-3.5 text-[12.5px] font-bold text-foreground ring-1 ring-border transition hover:ring-gold"
                      >
                        <Pencil className="size-3.5" />
                        {t("edit")}
                      </button>
                    </div>
                  ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Field
                        label={t("contactNameLabel")}
                        value={contactName}
                        onChange={setContactName}
                        placeholder={t("contactNamePlaceholder")}
                        autoComplete="name"
                      />
                      {/* The profile's name, whole or as « Karim B. ». */}
                      {profileNames.length > 1 && (
                        <div role="radiogroup" aria-label={t("contactNameLabel")} className="mt-2 flex flex-wrap gap-2">
                          {profileNames.map((n) => {
                            const on = contactName.trim() === n;
                            return (
                              <Chip key={n} on={on} onClick={() => setContactName(on ? "" : n)}>
                                <span dir="auto">{n}</span>
                              </Chip>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div id="f-phone" className={`scroll-mt-24 rounded-xl${flagCls("f-phone")}`}>
                      {/* dir="ltr": "+216 98 124 111" typed into a right-to-left
                          field comes out as "111 124 98 216+". */}
                      <Field
                        label={t("phoneLabel")}
                        required
                        type="tel"
                        autoComplete="tel"
                        value={contactPhone}
                        onChange={setContactPhone}
                        placeholder="+216 …"
                        dir="ltr"
                        error={errorFor("f-phone")}
                      />
                    </div>
                  </div>
                  )}

                  {editing ? (
                    <p className="rounded-2xl bg-surface-2 p-4 text-[12.5px] leading-relaxed text-muted ring-1 ring-border">
                      {editNote}
                    </p>
                  ) : (
                  <>
                  {shops.length > 0 && (
                    <div>
                      <p className="text-[12.5px] font-bold text-foreground">{t("publishFor")}</p>
                      <div role="radiogroup" aria-label={t("publishFor")} className="mt-2 grid gap-2 sm:grid-cols-2">
                        {[...(ownsShop ? [] : [{ id: "", name: t("publishForMe"), planLeft: null }]), ...shops].map((s) => {
                          const on = shopId === s.id;
                          const Icon = s.id ? Store : User;
                          return (
                            <button
                              key={s.id || "me"}
                              type="button"
                              role="radio"
                              aria-checked={on}
                              onClick={() => setShopId(s.id)}
                              className={cn(
                                "tap-target flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-start transition",
                                on ? "bg-gold-faint ring-2 ring-gold" : "bg-surface-2 ring-1 ring-border hover:ring-gold-soft",
                              )}
                            >
                              <Icon className={cn("size-4.5 shrink-0", on ? "text-gold" : "text-muted")} />
                              <span className="min-w-0">
                                <span className="block truncate text-[13.5px] font-extrabold text-foreground" dir="auto">{s.name}</span>
                                <span className="block text-[11.5px] leading-snug text-muted">
                                  {!s.id
                                    ? ownPlan
                                      ? t("publishForMePlanHint", { count: ownPlan.left })
                                      : t("publishForMeHint")
                                    : (s.planLeft ?? 0) > 0
                                      ? t("publishForPlanLeft", { count: s.planLeft ?? 0 })
                                      : t("publishForNoPlan")}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div>
                    <label
                      id="f-attestation"
                      className={`flex scroll-mt-24 cursor-pointer items-start gap-3 rounded-2xl border border-border bg-surface-2/40 p-3.5${flagCls("f-attestation")}`}
                    >
                      <input
                        type="checkbox"
                        aria-required="true"
                        aria-invalid={errorFor("f-attestation") ? true : undefined}
                        aria-describedby={errorFor("f-attestation") ? "f-attestation-error" : undefined}
                        checked={attested}
                        onChange={(e) => setAttested(e.target.checked)}
                        className="mt-0.5 size-5 shrink-0 accent-[var(--gold)]"
                      />
                      <span className="text-[12.5px] leading-relaxed text-foreground">{t("attestation")}</span>
                    </label>
                    {errorFor("f-attestation") && (
                      <FieldError id="f-attestation-error">{errorFor("f-attestation")}</FieldError>
                    )}
                  </div>

                  <div className="rounded-2xl bg-surface-2 p-4 ring-1 ring-border">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[13px] text-muted">
                        {viaPlan ? t("feeShopPlan") : usingCredit ? t("feeFromPlan") : t("feePublication")}
                      </span>
                      <span className="mazed-tabular text-[18px] font-extrabold text-foreground">
                        {viaPlan ? (
                          t("included")
                        ) : freeQuota ? (
                          t("free")
                        ) : usingCredit ? (
                          <Ltr>1 / {creditsLeft}</Ltr>
                        ) : (
                          t("limitValue")
                        )}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11.5px] leading-snug text-muted">
                      {viaOwnPlan
                        ? t("ownPlanExplain", { name: ownPlan!.shopName, count: ownPlan!.left })
                        : viaPlan
                        ? t("shopPlanExplain", { name: shop!.name, count: shop!.planLeft ?? 0 })
                        : freeQuota
                        ? t("freeQuotaExplain", { left: freePlacesLeft, limit: freeLimit })
                        : usingCredit
                          ? t("creditExplain")
                          : t("limitExplain", { limit: freeLimit })}
                    </p>
                    {limitReached && (
                      <Link
                        href={"/pro" as never}
                        className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-gold underline-offset-2 hover:underline"
                      >
                        <Store className="size-3.5" /> {t("seePro")}
                      </Link>
                    )}
                  </div>
                  </>
                  )}
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

      {/* The submit route refused: the free places are full. The annonce is
          kept as a draft; the way on is a Pro plan or a place freed up. */}
      <Modal
        open={limitHit !== null}
        onClose={() => setLimitHit(null)}
        title={limitHit?.kind === "plan" ? t("planFullTitle", { limit: limitHit.limit }) : t("limitTitle", { limit: freeLimit })}
        description={limitHit?.kind === "plan" ? t("planFullBody", { limit: limitHit.limit }) : t("limitModalBody", { limit: freeLimit })}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Link
            href={"/account/listings" as never}
            className="tap-target inline-flex items-center justify-center rounded-full border border-border px-5 py-2.5 text-[13px] font-bold text-foreground"
          >
            {t("seeMyListings")}
          </Link>
          {limitHit?.kind === "plan" ? (
            <Link
              href={"/pro/dashboard?tab=abonnement" as never}
              className="mazed-btn-luxe tap-target inline-flex items-center justify-center gap-1.5 px-5 py-2.5 text-[13px]"
            >
              <Store className="size-4" /> {t("seeSubscription")}
            </Link>
          ) : (
            <Link
              href={"/pro" as never}
              className="mazed-btn-luxe tap-target inline-flex items-center justify-center gap-1.5 px-5 py-2.5 text-[13px]"
            >
              <Store className="size-4" /> {t("seePro")}
            </Link>
          )}
        </div>
      </Modal>
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
export function typedAttributes(
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

/**
 * One question, rendered as whatever its `data_type` says it is.
 *
 * The numbers the site knows by `field_key` are taken with a tap: pièces,
 * salles de bain and étage as chips, the year from a list, the surface typed
 * or picked from the usual ones for the category. A number question an admin
 * adds later has no chips and stays a box.
 */
function AttributeField({
  def, value, onChange, error, categorySlug, currentYear, locale,
}: {
  def: AttributeDef;
  value: string;
  onChange: (v: string) => void;
  /** What is missing, once the seller was sent here. */
  error?: string | null;
  categorySlug: string | null;
  currentYear: number;
  locale: string;
}) {
  const t = useTranslations("publish");
  // Ties the visible label to its control: an admin's question has no fixed id.
  const id = useId();
  const errorId = `${id}-error`;
  const invalid = error ? { "aria-invalid": true, "aria-describedby": errorId } : {};
  if (def.data_type === "boolean") {
    // A yes/no is a switch, not a dropdown with two options in it. Clicking the
    // active side again clears the answer, because "not stated" is a real third
    // state on a property form — a seller who does not know whether the titre
    // foncier is registered must not be forced to claim either.
    return (
      <div>
        <Label id={`${id}-label`}>{def.label} {def.required && <Req />}</Label>
        <div
          role="radiogroup"
          aria-labelledby={`${id}-label`}
          aria-required={def.required || undefined}
          {...invalid}
          className="mt-1.5 flex gap-2"
        >
          {[
            { v: "true", label: t("yes") },
            { v: "false", label: t("no") },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={value === o.v}
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
        {error && <FieldError id={errorId}>{error}</FieldError>}
      </div>
    );
  }

  if (def.data_type === "select" && def.options?.length) {
    return (
      <div>
        <Label htmlFor={id}>{def.label} {def.required && <Req />}</Label>
        <select
          id={id}
          aria-required={def.required || undefined}
          {...invalid}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full appearance-none rounded-xl border border-border bg-surface px-3 py-3 text-[14px] text-foreground focus:border-gold focus:outline-none"
        >
          <option value="">—</option>
          {def.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {error && <FieldError id={errorId}>{error}</FieldError>}
      </div>
    );
  }

  if (def.data_type === "number") {
    const counts = countChipsFor(def.field_key);
    if (counts) return <CountField def={def} chips={counts} value={value} onChange={onChange} error={error} />;

    if (def.field_key === "year_built") {
      // A list, not a box: no keyboard, and no 20015. « Je ne sais pas » is
      // the empty answer, which is the honest one for an old house.
      return (
        <div>
          <Label htmlFor={id}>{def.label} {def.required && <Req />}</Label>
          <select
            id={id}
            aria-required={def.required || undefined}
            {...invalid}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="mt-1 w-full appearance-none rounded-xl border border-border bg-surface px-3 py-3 text-[14px] text-foreground focus:border-gold focus:outline-none"
          >
            <option value="">{def.required ? "—" : t("chips.yearUnknown")}</option>
            {yearOptions(currentYear, value).map((y) => (
              <option key={y} value={String(y)}>
                {y === currentYear ? t("chips.yearNew", { year: y }) : y}
              </option>
            ))}
          </select>
          {error && <FieldError id={errorId}>{error}</FieldError>}
        </div>
      );
    }

    if (def.field_key === "area_sqm") {
      // Typed as before, with the usual surfaces for the category under it.
      const quick = areaChipsFor(categorySlug);
      return (
        <div>
          <Field
            label={def.label}
            required={def.required}
            type="number"
            value={value}
            onChange={onChange}
            suffix={def.unit ?? undefined}
            error={error}
          />
          {quick.length > 0 && (
            <div role="radiogroup" aria-label={t("chips.quickArea")} className="mt-2 flex flex-wrap gap-2">
              {quick.map((c) => {
                const on = value.trim() !== "" && Number(value) === c.value;
                return (
                  <Chip key={c.value} on={on} onClick={() => onChange(on ? "" : String(c.value))}>
                    {c.hectares != null
                      ? t("chips.hectares", { count: c.hectares })
                      : `${formatNumber(c.value, locale)}${def.unit ? ` ${def.unit}` : ""}`}
                  </Chip>
                );
              })}
            </div>
          )}
        </div>
      );
    }
  }

  return (
    <Field
      label={def.label}
      required={def.required}
      type={def.data_type === "number" ? "number" : "text"}
      value={value}
      onChange={onChange}
      suffix={def.unit ?? undefined}
      error={error}
    />
  );
}

/**
 * A count as chips — 1 · 2 · 3 · 4 · 5 · « 6 et + » — storing the plain
 * number. The last chip writes its number and opens the box for a bigger
 * one; an answer no chip holds (a basement, -1) shows in the box as typed.
 */
function CountField({
  def, chips, value, onChange, error,
}: {
  def: AttributeDef;
  chips: CountChips;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
}) {
  const t = useTranslations("publish");
  const id = useId();
  const errorId = `${id}-error`;
  // « 6 et + » tapped: the box stays open while the seller types in it.
  const [typing, setTyping] = useState(false);
  const picked = countChipOf(chips, value);
  const moreOn = typing || picked === "more";
  const showBox = moreOn || (value.trim() !== "" && picked === null);
  return (
    <div>
      <Label id={`${id}-label`}>{def.label} {def.required && <Req />}</Label>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        aria-required={def.required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="mt-1.5 flex flex-wrap gap-2"
      >
        {chips.values.map((n) => {
          const on = !typing && picked === n;
          return (
            <Chip
              key={n}
              on={on}
              onClick={() => {
                setTyping(false);
                onChange(on ? "" : String(n));
              }}
            >
              {n === 0 && def.field_key === "floor" ? t("chips.groundFloor") : n}
            </Chip>
          );
        })}
        <Chip
          on={moreOn}
          onClick={() => {
            setTyping(!moreOn);
            onChange(moreOn ? "" : String(chips.orMore));
          }}
        >
          {t("chips.orMore", { count: chips.orMore })}
        </Chip>
      </div>
      {showBox && (
        <div className="mt-2 max-w-40">
          <Field labelledBy={`${id}-label`} type="number" value={value} onChange={onChange} suffix={def.unit ?? undefined} compact />
        </div>
      )}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

/**
 * One ready answer, drawn as the yes/no questions are. A radio in a group of
 * choices; with `toggle`, an on/off button of its own (a highlight line).
 */
function Chip({
  on, onClick, disabled, toggle, children,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  toggle?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      {...(toggle ? { "aria-pressed": on } : { role: "radio", "aria-checked": on })}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "tap-target rounded-full px-4 py-2 text-[13px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40",
        on
          ? "bg-[var(--gold)] text-white"
          : "bg-surface text-muted ring-1 ring-border hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * What is missing, said under the field itself. The toast names it too, but
 * it is gone in a few seconds; this stays until the field is filled.
 */
function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1.5 text-[12px] font-bold leading-snug text-danger">
      <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
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
  icon: Icon, title, id,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  /** For a field or group that this heading names (aria-labelledby). */
  id?: string;
}) {
  return (
    <h2 id={id} className="flex items-center gap-2.5 text-[17px] font-extrabold tracking-tight">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-gold-faint text-gold ring-1 ring-gold-soft">
        <Icon className="size-4" />
      </span>
      {title}
    </h2>
  );
}

/**
 * A field's visible name. With `htmlFor` it is that control's <label>; with
 * only `id`, it names a group of buttons through aria-labelledby. A heading
 * sitting next to a field is not its name to a screen reader — the price box
 * read as a bare "numeric field" until it was tied to its label.
 */
function Label({ children, htmlFor, id }: { children: React.ReactNode; htmlFor?: string; id?: string }) {
  const cls = "text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted";
  return htmlFor ? (
    <label htmlFor={htmlFor} id={id} className={cls}>{children}</label>
  ) : (
    <span id={id} className={cls}>{children}</span>
  );
}

/**
 * The asterisk of a required field. Hidden from screen readers, which hear
 * "required" from the control itself (aria-required) rather than "star".
 */
function Req() {
  return <span aria-hidden="true" className="text-gold">*</span>;
}

function Field({
  label, labelledBy, value, onChange, placeholder, type = "text", required, suffix, compact, dir, autoComplete, error,
}: {
  label?: string;
  /** Without a label of its own: the id of what names it (the chips' question, for « Autre montant »). */
  labelledBy?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  suffix?: string;
  compact?: boolean;
  dir?: "ltr" | "rtl";
  autoComplete?: string;
  /** What is missing, once the seller was sent here. */
  error?: string | null;
}) {
  const id = useId();
  // The unit is read as the field's description, not as part of its name:
  // "Caution, TND" rather than a label that ends in "TND".
  const unitId = suffix ? `${id}-unit` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div>
      {label && <Label htmlFor={id}>{label} {required && <Req />}</Label>}
      <div className="relative mt-1">
        <input
          id={id}
          aria-labelledby={label ? undefined : labelledBy}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={[unitId, errorId].filter(Boolean).join(" ") || undefined}
          autoComplete={autoComplete}
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
          <span id={unitId} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[12.5px] font-bold text-muted">
            {suffix}
          </span>
        )}
      </div>
      {error && errorId && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

/** An on/off chip (« Négociable », « Prix sur demande »): a toggle button, pressed or not. */
function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "tap-target inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-bold transition",
        on ? "bg-gold-faint text-gold ring-1 ring-gold-soft" : "bg-surface text-muted ring-1 ring-border",
      )}
    >
      {on && <Check className="size-3.5" />}
      {label}
    </button>
  );
}
