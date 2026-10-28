"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Gift, Keyboard, Loader2, Mic, Camera, Send, Sparkles, Square, Store } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { useApiError } from "@/lib/useApiError";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { useSetting } from "@/components/settings/SettingsProvider";
import { PhotoUploader, type UploadedPhoto } from "@/components/listing/PhotoUploader";
import { DictationLangPicker, useDictationProblem } from "@/components/listing/ListingDictation";
import { useDictation, useDictationLang } from "@/components/listing/useDictation";
import { appliesTo } from "@/lib/listings/deal";
import { governorateLabel } from "@/lib/tunisia";
import { formatTND, cn } from "@/lib/utils";
import { CHAT_MAX_TURN_CHARS, type ChatTurn, type ListingDraft } from "@/lib/ai/listing";
import { SELLER_ATTESTATION_VERSION, typedAttributes, type AttributeDef } from "../PublishWizard";

export type ChatCategory = { id: string; slug: string; label: string };

/** A line of the conversation. `local` lines (errors) are shown, never sent back to the model. */
type Line = ChatTurn & { local?: boolean };

type Done = { status: string; id: string; paidWith?: string; remaining?: number; freeLeft?: number };

/**
 * « Publier en parlant » — version B of the publish flow.
 *
 * The seller holds a conversation instead of filling four steps: the big
 * microphone is the main control (Tunisian, French or English), typing is one
 * tap away. Every message goes to /api/ai/listing-chat with the whole
 * exchange, which answers with the annonce as understood now and the next
 * question; the card at the top shows what is known and what is missing.
 * Saying « انشر » / « publier » / « publish » — or the « Publier » button —
 * opens the last step: photos, the number buyers call, the attestation, and
 * the one button that saves and submits through the ordinary routes, so the
 * free places, moderation and the Pro plans apply exactly as in the form.
 */
export function ChatPublisher({
  categories,
  attributesByCategory,
  defaultContactName,
  defaultContactPhone,
  freePlacesFull,
  freeLimit,
}: {
  categories: ChatCategory[];
  attributesByCategory: Record<string, AttributeDef[]>;
  defaultContactName: string;
  defaultContactPhone: string;
  /** Every free place is taken (no plan): « Publier » will say so; the page says it first. */
  freePlacesFull: boolean;
  freeLimit: number;
}) {
  const t = useTranslations("publishChat");
  const tp = useTranslations("publish");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const voiceOn = useSetting("feature_ai_voice");

  const [lines, setLines] = useState<Line[]>(() => [{ role: "assistant", text: t("greeting") }]);
  const [interim, setInterim] = useState("");
  const [draft, setDraft] = useState<ListingDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [uploading, setUploading] = useState(0);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [phone, setPhone] = useState(defaultContactPhone);
  const [attested, setAttested] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [limitHit, setLimitHit] = useState(false);
  const [listingId, setListingId] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const [lang, setLang] = useDictationLang(locale);
  const { supported, listening, start, stop } = useDictation(useDictationProblem());
  const canSpeak = voiceOn && supported;

  // The conversation as it stands, for a message sent from a callback that
  // closed over an older render (the microphone's end).
  const linesRef = useRef(lines);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines, interim, busy]);

  // ── What is known, and what is still missing ────────────────────────────────
  const category = draft?.categorySlug ? categories.find((c) => c.slug === draft.categorySlug) ?? null : null;
  const deal = draft?.deal ?? "sale";
  const defs = (category ? attributesByCategory[category.id] ?? [] : []).filter((d) => appliesTo(d.deal_types, deal));
  const said: Record<string, string> = {};
  if (draft) {
    if (draft.areaSqm != null) said.area_sqm = String(draft.areaSqm);
    if (draft.rooms != null) said.rooms = String(draft.rooms);
    if (draft.bathrooms != null) said.bathrooms = String(draft.bathrooms);
    if (draft.floor != null) said.floor = String(draft.floor);
    for (const [k, v] of Object.entries(draft.legal)) said[k] = v ? "true" : "false";
  }
  const attributes = typedAttributes(defs, said);

  /** What the conversation still has to give (the form's required questions). */
  const toSay = [
    !category && t("missing.category"),
    !draft?.governorate && t("missing.governorate"),
    draft?.price == null && t("missing.price"),
    ...defs.filter((d) => d.required && attributes[d.field_key] === undefined).map((d) => d.label),
  ].filter((x): x is string => typeof x === "string");
  /** What only the last step asks. */
  const phoneOk = phone.replace(/\D/g, "").length >= 8;
  const ready = !!draft && toSay.length === 0 && photos.length > 0 && uploading === 0 && phoneOk && attested;

  const money = (n: number) => `${formatTND(n, locale)} ${tc("tnd")}`;
  const chips = draft
    ? [
        t(deal === "rent" ? "fields.rent" : "fields.sale"),
        category?.label,
        draft.governorate ? [draft.delegation, governorateLabel(draft.governorate, locale)].filter(Boolean).join(", ") : null,
        draft.price != null ? (deal === "rent" ? tp("perMonth", { amount: money(draft.price) }) : money(draft.price)) : null,
        draft.areaSqm != null ? t("fields.area", { n: draft.areaSqm }) : null,
        draft.rooms != null ? t("fields.rooms", { n: draft.rooms }) : null,
        draft.floor != null ? t("fields.floor", { n: draft.floor }) : null,
        draft.furnished ? tp(`furnished.${draft.furnished}`) : null,
      ].filter((x): x is string => !!x)
    : [];

  // ── The conversation ────────────────────────────────────────────────────────
  async function send(text: string) {
    const words = text.trim().slice(0, CHAT_MAX_TURN_CHARS);
    if (!words) return;
    const next: Line[] = [...linesRef.current, { role: "seller", text: words }];
    linesRef.current = next;
    setLines(next);
    setBusy(true);
    try {
      const res = await fetch("/api/ai/listing-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns: next.filter((l) => !l.local).map(({ role, text: x }) => ({ role, text: x })) }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        draft?: ListingDraft; reply?: string; wantsToPublish?: boolean; error?: string; detail?: string;
      };
      if (!res.ok || !j.draft) {
        setLines((ls) => [...ls, { role: "assistant", text: apiError(j, t("failed")), local: true }]);
        return;
      }
      setDraft(j.draft);
      setLines((ls) => [...ls, { role: "assistant", text: j.reply || j.draft!.questions[0] || t("noted") }]);
      if (j.wantsToPublish) setSheetOpen(true);
    } catch {
      setLines((ls) => [...ls, { role: "assistant", text: t("offline"), local: true }]);
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    if (listening) return stop();
    setInterim("");
    start(lang, {
      onText: setInterim,
      onEnd: (heard) => {
        setInterim("");
        if (heard.trim()) void send(heard);
      },
    });
  }

  function sendTyped(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !typed.trim()) return;
    void send(typed);
    setTyped("");
  }

  // ── Saving and publishing, through the form's own routes ───────────────────
  function body(withAttestation: boolean): Record<string, unknown> | null {
    if (!draft || !category || !draft.governorate) return null;
    const rent = deal === "rent";
    const title = (draft.title || [category.label, draft.governorate].join(" · ")).slice(0, 140);
    return {
      ...(listingId ? { id: listingId } : {}),
      category_id: category.id,
      title,
      description: draft.description || null,
      price: draft.price,
      price_on_request: draft.price == null,
      negotiable: false,
      deal_type: deal,
      deposit_amount: rent ? draft.deposit : null,
      charges_amount: rent ? draft.charges : null,
      furnished: rent ? draft.furnished : null,
      available_from: rent ? draft.availableFrom : null,
      min_lease_months: rent ? draft.minLeaseMonths : null,
      governorate: draft.governorate,
      delegation: draft.delegation,
      attributes,
      photos: photos.map((p, i) => ({ storage_path: p.path, sort_order: i })),
      contact_name: defaultContactName.trim() || null,
      contact_phone: phone.trim(),
      contact_whatsapp: phone.trim(),
      show_phone: true,
      ...(withAttestation ? { attestation_version: SELLER_ATTESTATION_VERSION } : {}),
    };
  }

  async function save(withAttestation: boolean): Promise<string | null> {
    const b = body(withAttestation);
    if (!b) return null;
    const res = await fetch("/api/annonces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
    });
    const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string; detail?: string };
    if (!res.ok || !j.id) {
      toast(apiError(j, t("saveFailed")), "error");
      return null;
    }
    setListingId(j.id);
    return j.id;
  }

  async function publish() {
    if (!ready || publishing) return;
    setPublishing(true);
    try {
      const id = await save(true);
      if (!id) return;
      const res = await fetch(`/api/annonces/${id}/submit`, { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as {
        status?: string; paidWith?: string; remaining?: number; freeLeft?: number; error?: string; detail?: string;
      };
      if (j.error === "free_limit_reached") {
        setLimitHit(true);
        return;
      }
      if (!res.ok) {
        toast(apiError(j, tp("submitFailed")), "error");
        return;
      }
      setSheetOpen(false);
      setDone({ status: j.status ?? "pending_review", id, paidWith: j.paidWith, remaining: j.remaining, freeLeft: j.freeLeft });
    } catch {
      toast(t("offline"), "error");
    } finally {
      setPublishing(false);
    }
  }

  /** Everything said so far, into the form, for a seller who prefers to finish there. */
  async function openInForm() {
    const id = await save(false);
    router.push((id ? `/annonces/nouvelle?draft=${id}&forme=1` : "/annonces/nouvelle?forme=1") as never);
  }

  // ── Done ────────────────────────────────────────────────────────────────────
  if (done) {
    return (
      <main className="mx-auto max-w-md px-5 py-16 text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-gold-faint text-gold ring-1 ring-gold-soft">
          <Check className="size-8" strokeWidth={2.6} />
        </span>
        <h1 className="mt-5 text-[22px] font-extrabold tracking-tight">
          {done.status === "published" ? tp("donePublishedTitle") : tp("doneTitle")}
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          {done.status === "published" ? tp("donePublishedBody") : tp("doneBody")}
          {done.paidWith === "credit" && typeof done.remaining === "number" && <> {tp("doneCreditsLeft", { count: done.remaining })}</>}
          {done.paidWith === "subscription" && typeof done.remaining === "number" && <> {tp("doneSubscription", { count: done.remaining })}</>}
        </p>
        {done.paidWith === "free_quota" && (
          <div className="mt-4 rounded-2xl bg-surface-2 p-4 text-start ring-1 ring-border">
            <p className="inline-flex items-center gap-1.5 text-[13px] font-extrabold text-[var(--tone-ok)]">
              <Gift className="size-4" /> {tp("doneFreeQuota")}
            </p>
            {typeof done.freeLeft === "number" && (
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                {tp("doneFreeLeft", { left: done.freeLeft, limit: freeLimit })}
                {done.freeLeft === 0 && (
                  <>
                    {" "}
                    <Link href={"/pro" as never} className="font-bold text-gold underline-offset-2 hover:underline">{tp("seePro")}</Link>
                  </>
                )}
              </p>
            )}
          </div>
        )}
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
          {done.status === "published" && (
            <Link href={`/annonces/${done.id}` as never} className="mazed-btn-luxe tap-target inline-flex px-6 py-3 text-[13.5px]">
              {tp("seeListing")}
            </Link>
          )}
          <Link
            href={"/account/listings" as never}
            className={
              done.status === "published"
                ? "tap-target inline-flex rounded-full border border-border px-6 py-3 text-[13.5px] font-bold text-foreground"
                : "mazed-btn-luxe tap-target inline-flex px-6 py-3 text-[13.5px]"
            }
          >
            {tp("seeMyListings")}
          </Link>
        </div>
      </main>
    );
  }

  // ── The conversation screen ─────────────────────────────────────────────────
  return (
    <main className="mx-auto max-w-2xl px-4 pb-80 pt-4 lg:pb-72 lg:pt-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-[13px] text-muted">{t("subtitle")}</p>
        </div>
        <Link href={"/annonces/nouvelle?forme=1" as never} className="shrink-0 text-[12px] font-bold text-muted underline-offset-2 hover:text-foreground hover:underline">
          {t("toForm")}
        </Link>
      </div>

      {freePlacesFull && (
        <p className="mazed-tone-warn mt-3 rounded-2xl px-4 py-2.5 text-[12.5px]">
          {tp("limitTitle", { limit: freeLimit })}.{" "}
          <Link href={"/pro" as never} className="font-bold underline-offset-2 hover:underline">{tp("seePro")}</Link>
        </p>
      )}

      {/* What the conversation has built so far. */}
      {draft && (
        <section className="mt-4 rounded-2xl border border-gold-soft bg-gold-faint p-3.5 shadow-sm lg:sticky lg:top-[calc(var(--mazed-topbar-h,64px)+8px)] lg:z-10">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-gold">{t("yourAnnonce")}</p>
          {draft.title && <p className="mt-1 text-[14px] font-extrabold text-foreground" dir="auto">{draft.title}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span key={c} className="rounded-full bg-surface px-2.5 py-1 text-[11.5px] font-bold text-foreground ring-1 ring-border" dir="auto">{c}</span>
            ))}
            <span className={cn("rounded-full px-2.5 py-1 text-[11.5px] font-bold ring-1", photos.length ? "bg-surface text-foreground ring-border" : "bg-surface text-muted ring-border")}>
              {t("photosCount", { count: photos.length })}
            </span>
          </div>
          {toSay.length > 0 && (
            <p className="mt-2 text-[11.5px] leading-snug text-muted">{t("stillMissing", { list: toSay.join(", ") })}</p>
          )}
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button type="button" onClick={() => setPhotosOpen(true)} className="tap-target inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-[12.5px] font-bold text-foreground ring-1 ring-gold-soft">
              <Camera className="size-3.5" /> {t("addPhotos")}
            </button>
            <button type="button" onClick={() => setSheetOpen(true)} className="mazed-btn-luxe tap-target inline-flex h-9 items-center gap-1.5 px-4 text-[12.5px]">
              <Sparkles className="size-3.5" /> {t("publish")}
            </button>
          </div>
        </section>
      )}

      {/* The conversation. */}
      <ol className="mt-4 space-y-2.5" aria-live="polite">
        {lines.map((l, i) => (
          <li key={i} className={cn("flex", l.role === "seller" ? "justify-end" : "justify-start")}>
            <p
              dir="auto"
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed",
                l.role === "seller"
                  ? "rounded-ee-md bg-gold-faint text-foreground ring-1 ring-gold-soft"
                  : cn("rounded-es-md bg-surface ring-1 ring-border", l.local ? "text-[var(--tone-bad)]" : "text-foreground"),
              )}
            >
              {l.text}
            </p>
          </li>
        ))}
        {interim && (
          <li className="flex justify-end">
            <p dir="auto" className="max-w-[85%] rounded-2xl rounded-ee-md bg-gold-faint/60 px-3.5 py-2.5 text-[14px] italic text-muted ring-1 ring-gold-soft">
              {interim}
            </p>
          </li>
        )}
        {busy && (
          <li className="flex justify-start">
            <p className="inline-flex items-center gap-2 rounded-2xl rounded-es-md bg-surface px-3.5 py-2.5 text-[13px] text-muted ring-1 ring-border">
              <Loader2 className="size-3.5 animate-spin" /> {t("thinking")}
            </p>
          </li>
        )}
      </ol>
      {/* Scrolled to after each message, clear of the controls fixed below it. */}
      <div ref={bottom} className="scroll-mb-[20rem] lg:scroll-mb-[16rem]" />

      {/* The controls, always under the thumb: the microphone first. */}
      <div className="fixed inset-x-0 bottom-[calc(var(--mazed-bottombar-h,64px)+env(safe-area-inset-bottom))] z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-md lg:bottom-0">
        <div className="mx-auto max-w-2xl">
          {/* The way out, always in reach once the annonce has what it needs. */}
          {draft && toSay.length === 0 && !listening && (
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="mazed-btn-luxe tap-target mb-2.5 flex h-11 w-full items-center justify-center gap-2 text-[14px]"
            >
              <Check className="size-4" /> {t("publishWhenReady")}
            </button>
          )}
          {canSpeak && (
            <div className="flex justify-center">
              <DictationLangPicker value={lang} onChange={setLang} disabled={listening} />
            </div>
          )}
          <div className="mt-2.5 flex items-center justify-center gap-5">
            <button
              type="button"
              onClick={() => setTyping((v) => !v)}
              aria-pressed={typing}
              aria-label={t("type")}
              title={t("type")}
              className={cn("tap-target grid size-11 place-items-center rounded-full ring-1 transition", typing ? "bg-surface-2 text-foreground ring-gold-soft" : "text-muted ring-border hover:text-foreground")}
            >
              <Keyboard className="size-5" />
            </button>
            {canSpeak ? (
              <button
                type="button"
                onClick={toggleMic}
                disabled={busy && !listening}
                aria-pressed={listening}
                aria-label={listening ? t("stop") : t("speak")}
                className={cn(
                  "tap-target grid size-16 place-items-center rounded-full shadow-lg transition disabled:opacity-60",
                  listening
                    ? "bg-[var(--tone-bad)] text-white motion-safe:animate-pulse"
                    : "bg-[var(--gold)] text-[var(--background)] hover:brightness-110",
                )}
              >
                {listening ? <Square className="size-6" fill="currentColor" /> : <Mic className="size-7" />}
              </button>
            ) : (
              <span className="text-[12px] text-muted">{t("noMic")}</span>
            )}
            <button
              type="button"
              onClick={() => setPhotosOpen(true)}
              aria-label={t("addPhotos")}
              title={t("addPhotos")}
              className="tap-target relative grid size-11 place-items-center rounded-full text-muted ring-1 ring-border transition hover:text-foreground"
            >
              <Camera className="size-5" />
              {photos.length > 0 && (
                <span className="absolute -end-1 -top-1 grid size-5 place-items-center rounded-full bg-[var(--gold)] text-[10px] font-extrabold text-[var(--background)]">
                  {photos.length}
                </span>
              )}
            </button>
          </div>
          <p role="status" className="mt-1.5 text-center text-[11.5px] text-muted">
            {listening ? t("listening") : busy ? t("thinking") : canSpeak ? t("tapToSpeak") : ""}
          </p>
          {(typing || !canSpeak) && (
            <form onSubmit={sendTyped} className="mt-2 flex items-center gap-2">
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                maxLength={CHAT_MAX_TURN_CHARS}
                dir="auto"
                placeholder={t("typePlaceholder")}
                aria-label={t("type")}
                className="h-11 min-w-0 flex-1 rounded-full border border-border bg-surface px-4 text-[14px] text-foreground placeholder:text-muted focus:border-gold focus:outline-none"
              />
              <button type="submit" disabled={busy || !typed.trim()} aria-label={t("send")} className="mazed-btn-luxe tap-target grid size-11 place-items-center disabled:opacity-60">
                <Send className="size-4 rtl:-scale-x-100" />
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Photos, from the camera button or the card. */}
      <Modal open={photosOpen} onClose={() => setPhotosOpen(false)} title={t("addPhotos")} description={t("photosHint")}>
        <PhotoUploader photos={photos} onChange={setPhotos} onPendingChange={setUploading} />
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={() => setPhotosOpen(false)} className="mazed-btn-luxe tap-target inline-flex h-11 items-center px-6 text-[13px]">
            {t("photosDone")}
          </button>
        </div>
      </Modal>

      {/* The last step: what will be published, and the button. */}
      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} title={t("sheetTitle")} size="lg">
        {limitHit ? (
          <div className="mazed-tone-warn rounded-2xl p-4 text-[13px] leading-relaxed">
            <p className="font-extrabold">{tp("limitTitle", { limit: freeLimit })}</p>
            <p className="mt-1">{tp("limitModalBody", { limit: freeLimit })}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Link href={"/pro" as never} className="inline-flex items-center gap-1.5 font-bold underline-offset-2 hover:underline">
                <Store className="size-4" /> {tp("seePro")}
              </Link>
              <Link href={"/account/listings" as never} className="font-bold underline-offset-2 hover:underline">{tp("seeMyListings")}</Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {draft ? (
              <div className="rounded-2xl bg-surface-2 p-3.5 ring-1 ring-border">
                {draft.title && <p className="text-[15px] font-extrabold" dir="auto">{draft.title}</p>}
                <p className="mt-1 text-[12.5px] text-muted" dir="auto">{chips.join(" · ")}</p>
                {draft.description && <p className="mt-2 text-[13px] leading-relaxed" dir="auto">{draft.description}</p>}
              </div>
            ) : (
              <p className="text-[13px] text-muted">{t("nothingYet")}</p>
            )}

            {toSay.length > 0 && (
              <p className="mazed-tone-warn rounded-xl px-3 py-2 text-[12.5px]">{t("sayMissing", { list: toSay.join(", ") })}</p>
            )}

            <div>
              <p className="text-[13px] font-bold">{t("photosTitle")}</p>
              <p className="text-[11.5px] text-muted">{t("photosHint")}</p>
              <div className="mt-2">
                <PhotoUploader photos={photos} onChange={setPhotos} onPendingChange={setUploading} />
              </div>
            </div>

            <label className="block">
              <span className="text-[13px] font-bold">{tp("phoneLabel")}</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                dir="ltr"
                inputMode="tel"
                placeholder="+216 …"
                className="mt-1 h-11 w-full rounded-xl border border-border bg-surface px-3 text-[14px] focus:border-gold focus:outline-none"
              />
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-surface-2/40 p-3.5">
              <input
                type="checkbox"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
                className="mt-0.5 size-5 shrink-0 accent-[var(--gold)]"
              />
              <span className="text-[12px] leading-relaxed text-foreground">{tp("attestation")}</span>
            </label>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              {category && draft?.governorate ? (
                <button type="button" onClick={openInForm} className="text-[12.5px] font-bold text-muted underline-offset-2 hover:text-foreground hover:underline">
                  {t("finishInForm")}
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={publish}
                disabled={!ready || publishing}
                className="mazed-btn-luxe tap-target inline-flex h-12 items-center justify-center gap-2 px-8 text-[14px] disabled:opacity-60"
              >
                {publishing ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                {t("publishNow")}
              </button>
            </div>
            {!ready && draft && (
              <p className="text-end text-[11.5px] text-muted">
                {toSay.length > 0
                  ? t("needMissing")
                  : photos.length === 0
                    ? t("needPhoto")
                    : !phoneOk
                      ? t("needPhone")
                      : uploading > 0
                        ? t("needUploads")
                        : t("needAttestation")}
              </p>
            )}
          </div>
        )}
      </Modal>
    </main>
  );
}
