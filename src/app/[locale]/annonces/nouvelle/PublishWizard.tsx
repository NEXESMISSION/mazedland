"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { PhotoUploader, type UploadedPhoto } from "@/components/listing/PhotoUploader";
import { ListingImage } from "@/components/media/ListingImage";
import { formatTND, cn } from "@/lib/utils";
import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";
import {
  Check, Tag, Camera, Wallet, Phone, ClipboardList, Loader2, MapPin,
  Gift, Ticket, ImageOff, Home,
} from "lucide-react";

/**
 * Publier une annonce — the fixed-price sell flow.
 *
 * One page, top to bottom, rather than a five-screen wizard. A classified is a
 * short form: you should be able to see that it wants a photo before you have
 * answered two screens of questions, and fixing a price should not mean walking
 * the whole chain again.
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

export const SELLER_ATTESTATION_VERSION = "v1";

const ATTESTATION_TEXT =
  "J'atteste sur l'honneur que toutes les informations, photos et documents " +
  "fournis sont exacts, complets et concernent bien ce bien. Je déclare être " +
  "propriétaire ou mandaté pour le vendre. Je suis seul responsable de toute " +
  "information fausse, inexacte ou trompeuse. En cas de fausse déclaration, " +
  "Batta peut refuser ou retirer l'annonce et conserver les frais déjà réglés.";

export type WizardCategory = {
  id: string;
  slug: string;
  label: string;
  groupId: string;
  groupLabel: string;
};

/** One question, as `/admin/catalogue` defines it. */
export type AttributeDef = {
  field_key: string;
  label: string;
  data_type: string;
  options: { value: string; label: string }[] | null;
  unit: string | null;
  required: boolean;
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
};

export function PublishWizard({
  categories,
  groups,
  attributesByCategory,
  feeByCategory,
  creditsLeft,
  defaultContactName,
  defaultContactPhone,
  initialDraft,
  locale,
}: {
  categories: WizardCategory[];
  groups: { id: string; label: string }[];
  attributesByCategory: Record<string, AttributeDef[]>;
  feeByCategory: Record<string, number | null>;
  creditsLeft: number;
  defaultContactName: string;
  defaultContactPhone: string;
  initialDraft: InitialDraft | null;
  locale: string;
}) {
  const d = initialDraft;
  const router = useRouter();
  const { toast } = useToast();

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<"idle" | "saving" | "ok">("idle");
  const [listingId, setListingId] = useState<string | null>(d?.id ?? null);
  const [done, setDone] = useState<null | { paidWith: string; remaining?: number }>(null);

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
  const [governorate, setGovernorate] = useState<string>(
    d?.governorate ?? TUNISIAN_GOVERNORATES[0],
  );
  const [delegation, setDelegation] = useState(d?.delegation ?? "");
  const [contactName, setContactName] = useState(d?.contact_name ?? defaultContactName);
  const [contactPhone, setContactPhone] = useState(d?.contact_phone ?? defaultContactPhone);
  const [attested, setAttested] = useState(false);
  const [resumed, setResumed] = useState(Boolean(d));

  // Which group's chips are showing. Seeded from the draft so a resumed terrain
  // does not come back on the Résidentiel side.
  const [groupId, setGroupId] = useState<string>(() => {
    const c = categories.find((x) => x.id === (d?.category_id ?? null));
    return c?.groupId ?? groups[0]?.id ?? "";
  });

  const category = categories.find((c) => c.id === categoryId) ?? null;
  const fee = categoryId ? feeByCategory[categoryId] ?? null : null;
  const usingCredit = creditsLeft > 0;
  const free = fee != null && fee <= 0;

  const defs = useMemo<AttributeDef[]>(
    () => (categoryId ? attributesByCategory[categoryId] ?? [] : []),
    [categoryId, attributesByCategory],
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
   * A title nobody should have to type: it is what they just chose.
   *
   * Property listings in Tunisia are read as "type · surface · lieu", so that
   * is the order. Derived, not stored — the moment the seller edits the box
   * their text wins.
   */
  const suggestedTitle = useMemo(() => {
    if (!category) return "";
    const area = attrs.area_sqm?.trim();
    const where = delegation.trim() || governorate;
    return [category.label, area ? `${area} m²` : null, where].filter(Boolean).join(" · ");
  }, [category, attrs.area_sqm, delegation, governorate]);

  const title = titleTouched ? typedTitle : suggestedTitle;
  const setTitle = (v: string) => { setTitleTouched(true); setTypedTitle(v); };

  // ─── What is still missing, and where ─────────────────────────────────────
  // Each entry knows the section it belongs to, so a click takes the seller
  // straight there instead of leaving them to scan the page for it.
  const missing: { label: string; fieldId: string }[] = [];
  if (!categoryId) missing.push({ label: "Choisissez le type de bien.", fieldId: "f-category" });
  if (photosUploading > 0) {
    missing.push({
      label: `Encore ${photosUploading} photo${photosUploading > 1 ? "s" : ""} en cours d'envoi…`,
      fieldId: "f-photos",
    });
  } else if (photos.length === 0) {
    missing.push({ label: "Ajoutez au moins une photo.", fieldId: "f-photos" });
  }
  for (const def of defs) {
    if (!def.required) continue;
    const v = attrs[def.field_key];
    if (v == null || String(v).trim() === "") {
      missing.push({ label: `Indiquez : ${def.label.toLowerCase()}.`, fieldId: "f-details" });
    }
  }
  if (title.trim().length < 3) {
    missing.push({ label: "Donnez un titre à votre annonce.", fieldId: "f-title" });
  }
  if (!onRequest && !(Number(price) > 0)) {
    missing.push({ label: "Indiquez un prix, ou cochez « prix sur demande ».", fieldId: "f-price" });
  }
  if (contactPhone.replace(/\D/g, "").length < 8) {
    missing.push({ label: "Un numéro joignable est obligatoire.", fieldId: "f-phone" });
  }
  if (!attested) {
    missing.push({ label: "Cochez l'attestation pour publier.", fieldId: "f-contact" });
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
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.querySelector<HTMLElement>("input, select, textarea, button")?.focus({ preventScroll: true });
  }

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
    setGovernorate(TUNISIAN_GOVERNORATES[0]);
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
      toast(j.detail ?? j.error ?? "Enregistrement impossible.", "error");
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
  ]);

  async function publishNow() {
    if (missing.length > 0) {
      // Flag everything so the whole list turns red at once, then go to the
      // first one. The list at the end of the form is the dialog — putting a
      // modal over it would say the same thing twice.
      setFlagged(missing.map((m) => m.fieldId));
      goToField(missing[0].fieldId);
      toast(
        missing.length === 1
          ? "Il manque une chose avant de publier."
          : `Il manque ${missing.length} choses avant de publier.`,
        "warning",
      );
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
        toast(j.detail ?? j.error ?? "Envoi impossible.", "error");
        return;
      }
      if (j.status === "pending_payment" && j.paymentId) {
        router.push(`/payment/checkout?payment=${j.paymentId}` as never);
        return;
      }
      setDone({ paidWith: j.paidWith ?? "free", remaining: j.remaining });
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
        <h1 className="mt-5 text-[22px] font-extrabold tracking-tight">Annonce envoyée</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          Notre équipe la vérifie avant publication — généralement en moins de 24 h. Vous serez
          prévenu dès qu&apos;elle est en ligne.
          {done.paidWith === "credit" && typeof done.remaining === "number" && (
            <> Il vous reste {done.remaining} publication{done.remaining > 1 ? "s" : ""}.</>
          )}
          {done.paidWith === "free" && <> La publication était gratuite dans cette catégorie.</>}
        </p>
        <button
          onClick={() => router.push("/account/listings" as never)}
          className="batta-btn-luxe tap-target mt-7 inline-flex px-6 py-3 text-[13.5px]"
        >
          Voir mes annonces
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[var(--max-w-wide)] px-4 pb-32 pt-4 lg:px-6 lg:pb-12 lg:pt-8">
      <div className="flex items-start justify-between gap-3 pt-2">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-tight">Publier une annonce</h1>
          <p className="mt-1 text-[13px] text-muted">
            Quelques informations, des photos, votre numéro — c&apos;est tout.
          </p>
        </div>
        {saved === "saving" && (
          <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-[11px] text-muted">
            <Loader2 className="size-3 animate-spin" /> Enregistrement…
          </span>
        )}
        {saved === "ok" && (
          <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-[11px] text-muted">
            <Check className="size-3" /> Brouillon enregistré
          </span>
        )}
      </div>

      {resumed && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold-soft bg-gold-faint px-4 py-3">
          <p className="text-[12.5px] font-semibold text-gold">
            Nous avons repris votre brouillon
            {d?.updated_at ? ` du ${new Date(d.updated_at).toLocaleDateString("fr-FR")}` : ""}.
          </p>
          <button
            type="button"
            onClick={startOver}
            className="text-[12px] font-bold text-muted underline hover:text-foreground"
          >
            Recommencer à zéro
          </button>
        </div>
      )}

      <div className="mx-auto mt-5 max-w-3xl">
        <div className="space-y-4">
          {/* ── Category ── */}
          <section
            id="f-category"
            className={`scroll-mt-24 rounded-2xl border border-border bg-surface p-4 sm:p-5${flagCls("f-category")}`}
          >
            <SectionHead icon={Tag} title="Que vendez-vous ?" />
            <p className="mt-1 text-[13px] text-muted">
              Cela décide des informations qui vous seront demandées.
            </p>

            {usingCredit && (
              <p className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gold-faint px-3 py-2 text-[12.5px] font-bold text-gold ring-1 ring-gold-soft">
                <Ticket className="size-4" />
                {creditsLeft} publication{creditsLeft > 1 ? "s" : ""} dans votre forfait
              </p>
            )}

            {/* Family first, then the category. One choice, so a segmented
                control — the shape every OS uses to say "one of these" — rather
                than a grid of tiles, which reads as a multi-select. */}
            <div className="mt-4">
              <div
                role="radiogroup"
                aria-label="Famille de bien"
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

              <div role="radiogroup" aria-label="Catégorie" className="mt-2.5 flex flex-wrap gap-1.5">
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

              {/* The price of publishing, said once, instead of repeated on
                  every tile. */}
              {category && fee != null && (
                <p
                  className={cn(
                    "mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] font-bold",
                    free ? "text-[var(--tone-ok)]" : "text-muted",
                  )}
                >
                  {free ? (
                    <><Gift className="size-3.5" /> Publication gratuite dans cette catégorie.</>
                  ) : (
                    <>Publication : {formatTND(fee, locale)} TND</>
                  )}
                </p>
              )}
            </div>
          </section>

          {/* ── Photos ── */}
          <section
            id="f-photos"
            className={`scroll-mt-24 rounded-2xl border border-border bg-surface p-4 sm:p-5${flagCls("f-photos")}`}
          >
            <SectionHead icon={Camera} title="Vos photos" />
            <p className="mt-1 text-[13px] text-muted">
              Elles décident si un acheteur clique. Montrez la façade, le séjour, les chambres, la
              cuisine et la vue — et le plan ou le titre foncier si vous l&apos;avez.
            </p>
            <div className="mt-5">
              <PhotoUploader
                photos={photos}
                onChange={setPhotos}
                onPendingChange={setPhotosUploading}
              />
            </div>
          </section>

          {/* ── Details, generated from category_attributes ── */}
          <section
            id="f-details"
            className={`scroll-mt-24 rounded-2xl border border-border bg-surface p-4 sm:p-5${flagCls("f-details")}`}
          >
            <SectionHead icon={ClipboardList} title="Le bien" />
            <p className="mt-1 text-[13px] text-muted">
              {categoryId
                ? "Ces informations servent aux filtres de recherche — c'est ainsi qu'on vous trouve."
                : "Choisissez d'abord le type de bien ci-dessus."}
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
                  Aucune caractéristique n&apos;est demandée pour cette catégorie. Décrivez le bien
                  dans la description plus bas.
                </p>
              )
            )}
          </section>

          {/* ── Title & price ── */}
          <section
            id="f-price"
            className={`scroll-mt-24 rounded-2xl border border-border bg-surface p-4 sm:p-5${flagCls("f-price")}`}
          >
            <SectionHead icon={Wallet} title="Titre et prix" />
            <p className="mt-1 text-[13px] text-muted">
              Le titre est proposé d&apos;après ce que vous avez saisi — modifiez-le si vous voulez.
            </p>

            <div className="mt-5 space-y-4">
              <div id="f-title" className={`scroll-mt-24 rounded-xl${flagCls("f-title")}`}>
                <Field
                  label="Titre de l'annonce"
                  required
                  value={title}
                  onChange={setTitle}
                  placeholder="Appartement S+2 · 120 m² · La Marsa"
                />
              </div>

              <div>
                <Label>Prix {!onRequest && <span className="text-gold">*</span>}</Label>
                <div className="relative mt-1">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={price}
                    disabled={onRequest}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="250000"
                    className="w-full rounded-xl border border-border bg-surface px-3 py-3 pe-16 text-[16px] font-bold text-foreground placeholder:font-normal placeholder:text-muted focus:border-gold focus:outline-none disabled:opacity-40"
                  />
                  <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[13px] font-bold text-muted">
                    TND
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Toggle label="Négociable" on={negotiable} onClick={() => setNegotiable((v) => !v)} />
                  <Toggle label="Prix sur demande" on={onRequest} onClick={() => setOnRequest((v) => !v)} />
                </div>
              </div>

              <div>
                <Label>Description</Label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  maxLength={4000}
                  placeholder="Situation, exposition, état, charges, ce qu'il y a à refaire, papiers disponibles. Soyez honnête : c'est ce qui évite les visites pour rien."
                  className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-[13.5px] leading-relaxed text-foreground placeholder:text-muted focus:border-gold focus:outline-none"
                />
                <p className="mt-1 text-end text-[10.5px] text-muted">{description.length} / 4000</p>
              </div>
            </div>
          </section>

          {/* ── Contact, preview, publish ── */}
          <section
            id="f-contact"
            className={`scroll-mt-24 rounded-2xl border border-border bg-surface p-4 sm:p-5${flagCls("f-contact")}`}
          >
            <SectionHead icon={Phone} title="Contact et publication" />
            <p className="mt-1 text-[13px] text-muted">
              Les acheteurs vous appellent directement sur ce numéro. Il n&apos;apparaît jamais dans
              la page : il n&apos;est affiché qu&apos;à ceux qui le demandent.
            </p>

            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nom affiché" value={contactName} onChange={setContactName} placeholder="Karim B." />
                <div id="f-phone" className={`scroll-mt-24 rounded-xl${flagCls("f-phone")}`}>
                  <Field label="Téléphone" required value={contactPhone} onChange={setContactPhone} placeholder="+216 …" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Gouvernorat <span className="text-gold">*</span></Label>
                  <div className="relative mt-1">
                    <MapPin className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                    <select
                      value={governorate}
                      onChange={(e) => setGovernorate(e.target.value)}
                      className="w-full appearance-none rounded-xl border border-border bg-surface py-3 ps-9 pe-3 text-[14px] text-foreground focus:border-gold focus:outline-none"
                    >
                      {TUNISIAN_GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                </div>
                {/* Free text on purpose. A délégation list for all 24
                    governorates is 260 rows that would go stale, and getting it
                    wrong costs a filter nobody uses — the governorate is what
                    search actually keys on. */}
                <Field
                  label="Délégation / quartier"
                  value={delegation}
                  onChange={setDelegation}
                  placeholder="La Marsa"
                />
              </div>

              {/* Preview — the exact card a buyer will see, using the same
                  ListingImage every real card uses so a portrait photo behaves
                  here the way it will there. */}
              <div>
                <Label>Aperçu</Label>
                <div className="mt-1 w-[180px] overflow-hidden rounded-2xl border border-border bg-surface">
                  <div className="relative aspect-[4/3] bg-surface-2">
                    {photos[0] ? (
                      <ListingImage path={photos[0].path} alt="" sizes="180px" />
                    ) : (
                      <span className="grid size-full place-items-center gap-1 text-center text-muted">
                        <ImageOff className="mx-auto size-5" />
                        <span className="px-2 text-[10px] leading-tight">Aucune photo</span>
                      </span>
                    )}
                  </div>
                  <div className="p-2.5">
                    <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted">
                      <Home className="size-2.5" /> {category?.label}
                    </span>
                    <h3 className="mt-0.5 line-clamp-2 text-[12.5px] font-bold leading-snug">
                      {title || "—"}
                    </h3>
                    <p className="batta-tabular mt-1 text-[13px] font-extrabold">
                      {onRequest || !(Number(price) > 0)
                        ? "Sur demande"
                        : `${formatTND(Number(price), locale)} TND`}
                    </p>
                    <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-muted">
                      <MapPin className="size-2.5" /> {delegation.trim() || governorate}
                    </p>
                  </div>
                </div>
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-surface-2/40 p-3.5">
                <input
                  type="checkbox"
                  checked={attested}
                  onChange={(e) => setAttested(e.target.checked)}
                  className="mt-0.5 size-5 shrink-0 accent-[var(--gold)]"
                />
                <span className="text-[12.5px] leading-relaxed text-foreground">{ATTESTATION_TEXT}</span>
              </label>

              <div className="rounded-2xl bg-surface-2 p-4 ring-1 ring-border">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-muted">
                    {usingCredit
                      ? "Publication depuis votre forfait"
                      : free
                        ? "Publication"
                        : "Frais de publication"}
                  </span>
                  <span className="batta-tabular text-[18px] font-extrabold text-foreground">
                    {usingCredit
                      ? `1 / ${creditsLeft}`
                      : fee == null
                        ? "—"
                        : free
                          ? "Gratuit"
                          : `${formatTND(fee, locale)} TND`}
                  </span>
                </div>
                <p className="mt-1.5 text-[11.5px] leading-snug text-muted">
                  {usingCredit
                    ? "Aucun paiement : une publication est décomptée de votre forfait."
                    : free
                      ? "Gratuit dans cette catégorie : votre annonce part directement en vérification."
                      : "Vous serez redirigé vers le paiement. L'annonce part en vérification dès la réception du reçu."}
                </p>
              </div>
            </div>
          </section>

          {/* Everything you need before publishing, at the END of the form. A
              form is read top to bottom and submitted at the end; a panel
              parked beside it is something you have to notice. */}
          <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 p-4 sm:p-5">
              <div className="min-w-0">
                <span className="block text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted">
                  Avant de publier
                </span>
                {missing.length === 0 ? (
                  <p className="mt-1 flex items-center gap-1.5 text-[14.5px] font-extrabold text-foreground">
                    <Check className="size-4 shrink-0 text-gold" strokeWidth={3} />
                    Tout est prêt.
                  </p>
                ) : (
                  <p className="mt-1 text-[14.5px] font-extrabold text-foreground">
                    {missing.length} élément{missing.length > 1 ? "s" : ""} à compléter
                  </p>
                )}
              </div>

              {/* lg only: below that the floating bar carries this button, and
                  two "Publier" buttons on one screen is a question, not a
                  convenience.

                  `hidden` sits on this WRAPPER, not on the button:
                  `.batta-btn-luxe` sets `display: inline-flex` from globals.css,
                  which is unlayered CSS and outranks anything in
                  `@layer utilities` — so `hidden` on the button itself loses the
                  cascade and both buttons show at every width. */}
              <div className="hidden shrink-0 lg:block">
                <button
                  type="button"
                  onClick={publishNow}
                  disabled={busy || photosUploading > 0}
                  className="batta-btn-luxe tap-target h-11 shrink-0 items-center justify-center gap-1.5 px-7 text-[13.5px] disabled:opacity-60"
                >
                  {busy ? (
                    <><Loader2 className="size-4 animate-spin" /> Un instant…</>
                  ) : photosUploading > 0 ? (
                    <><Loader2 className="size-4 animate-spin" /> Envoi des photos…</>
                  ) : (
                    <>Publier mon annonce</>
                  )}
                </button>
              </div>
            </div>

            {missing.length > 0 && (
              <ul className="grid border-t border-border p-2 sm:grid-cols-2 sm:p-3">
                {missing.map((m) => (
                  <li key={m.label}>
                    <button
                      type="button"
                      onClick={() => goToField(m.fieldId)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-start text-[12.5px] transition hover:bg-surface-2",
                        flaggedNow.has(m.fieldId)
                          ? "font-bold text-danger"
                          : "text-muted hover:text-foreground",
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
            )}
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-[calc(var(--batta-bottombar-h,64px)+env(safe-area-inset-bottom))] z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-md lg:hidden">
        <button
          type="button"
          onClick={publishNow}
          disabled={busy || photosUploading > 0}
          className="batta-btn-luxe tap-target inline-flex h-12 w-full items-center justify-center gap-1.5 text-[14px] disabled:opacity-60"
        >
          {busy ? (
            <><Loader2 className="size-4 animate-spin" /> Un instant…</>
          ) : photosUploading > 0 ? (
            <><Loader2 className="size-4 animate-spin" /> Envoi des photos…</>
          ) : (
            <>Publier mon annonce</>
          )}
        </button>
        <p className="mt-2 text-center text-[11px] text-muted lg:mt-3">
          {free
            ? "Publication gratuite dans cette catégorie."
            : usingCredit
              ? `Utilise 1 de vos ${creditsLeft} publications.`
              : fee != null
                ? `${fee} TND — à régler après vérification.`
                : "Le prix de publication s'affiche dès que la catégorie est choisie."}
        </p>
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
            { v: "true", label: "Oui" },
            { v: "false", label: "Non" },
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
  label, value, onChange, placeholder, type = "text", required, suffix, compact,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  suffix?: string;
  compact?: boolean;
}) {
  return (
    <label className="block">
      {label && <Label>{label} {required && <span className="text-gold">*</span>}</Label>}
      <div className="relative mt-1">
        <input
          type={type}
          inputMode={type === "number" ? "numeric" : undefined}
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
