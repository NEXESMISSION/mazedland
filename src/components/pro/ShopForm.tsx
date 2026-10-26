"use client";

import { useId, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { TUNISIAN_GOVERNORATES, governorateLabel } from "@/lib/tunisia";
import { canonicalDelegation, delegationLabel, delegationsOf } from "@/lib/delegations";
import { SHOP_KINDS, type ShopKind } from "@/lib/pro/shops";
import { shopPresentation, slugPreview, typedSlug } from "@/lib/pro/shopForm";
import { cn } from "@/lib/utils";
import { ChevronDown, ImagePlus, Loader2, PenLine } from "lucide-react";

export type ShopFormValues = {
  id?: string;
  slug?: string;
  name: string;
  kind: ShopKind;
  description: string;
  governorate: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  hours: string;
  legal_name: string;
  legal_id: string;
  logo_path: string | null;
  cover_path: string | null;
};

/** The délégation select's « something else » entry; never sent. */
const OTHER = "__other";
/** The usual opening hours, as choices — their words are `pro.form.hoursPresets.*`. */
const HOURS_PRESETS = ["weekdays", "sixDays", "everyDay", "appointment"] as const;

const chip = (on: boolean) =>
  cn(
    "tap-target rounded-full px-4 py-2 text-[13px] font-bold transition",
    on ? "bg-[var(--gold)] text-white" : "bg-surface text-muted ring-1 ring-border hover:text-foreground",
  );

/**
 * The shop's page, as its owner fills it in — to open the shop (POST
 * /api/pro/shops) or to change it (PATCH /api/pro/shops/:id). The logo and the
 * cover go through the same signed upload as annonce photos.
 *
 * Little to type: the contacts come from the account, the kind is a chip, the
 * place is two pickers, the presentation can be written for the owner, and
 * the address follows the name. What only some shops have (website, hours,
 * legal details) waits under « Plus d'informations ». What is sent is the
 * same object as before; the choices only fill its fields.
 */
export function ShopForm({
  initial,
  mode,
  suggestedName,
}: {
  initial: ShopFormValues;
  mode: "create" | "edit";
  /** The account's own name, offered as the shop's in one tap — never typed in for them: most shops are not named after a person. */
  suggestedName?: string;
}) {
  const t = useTranslations("pro.form");
  const tKinds = useTranslations("pro.kinds");
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const moreId = useId();
  // A délégation typed in another spelling (« la marsa ») opens on the list's.
  const [v, setV] = useState<ShopFormValues>(() => ({
    ...initial,
    city: canonicalDelegation(initial.governorate, initial.city) ?? initial.city,
  }));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<null | "logo_path" | "cover_path">(null);
  // A city that is not one of the governorate's délégations was typed: it
  // opens in the text field rather than being lost.
  const [cityTyped, setCityTyped] = useState(() => Boolean(initial.city.trim()) && !canonicalDelegation(initial.governorate, initial.city));
  // Open when the shop already has one of these filled in, so it is in sight.
  const [more, setMore] = useState(() => Boolean(initial.website || initial.hours || initial.legal_name || initial.legal_id));
  const [editingSlug, setEditingSlug] = useState(false);
  // The last text « Écrire pour moi » wrote: writing again over it needs no
  // question, writing over the owner's own words does.
  const [written, setWritten] = useState<string | null>(null);

  const set = <K extends keyof ShopFormValues>(k: K, value: ShopFormValues[K]) => setV((s) => ({ ...s, [k]: value }));

  // Sorted the way the reader reads them: by the Arabic name on /ar.
  const delegationOptions = useMemo(
    () =>
      delegationsOf(v.governorate)
        .map((value) => ({ value, label: delegationLabel(value, locale) }))
        .sort((a, b) => a.label.localeCompare(b.label, locale)),
    [v.governorate, locale],
  );

  async function upload(field: "logo_path" | "cover_path", file: File) {
    if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
      toast(t("imageTooBig"), "warning");
      return;
    }
    setUploading(field);
    try {
      const ext = (file.name.split(".").pop() || "webp").toLowerCase();
      const res = await fetch("/api/annonces/photo-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exts: [ext] }),
      });
      const j = (await res.json().catch(() => ({}))) as { uploads?: { path: string; signedUrl: string }[] };
      const target = j.uploads?.[0];
      if (!res.ok || !target) {
        toast(apiError(j, t("uploadFailed")), "error");
        return;
      }
      const form = new FormData();
      form.append("cacheControl", "31536000");
      form.append("", file);
      const put = await fetch(target.signedUrl, { method: "PUT", body: form });
      if (!put.ok) {
        toast(t("uploadFailed"), "error");
        return;
      }
      set(field, target.path);
    } finally {
      setUploading(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(mode === "create" ? "/api/pro/shops" : `/api/pro/shops/${initial.id}`, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      const j = (await res.json().catch(() => ({}))) as { id?: string };
      if (!res.ok) {
        toast(apiError(j, t("saveFailed")), "error");
        return;
      }
      toast(t(mode === "create" ? "created" : "saved"), "success");
      if (mode === "create") router.push(`/pro/dashboard?shop=${j.id}` as never);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function writePresentation() {
    // The text opens on the name: without one it would have a hole.
    if (!v.name.trim()) {
      toast(t("presentationNeedsName"), "warning");
      document.getElementById("shop-name")?.focus();
      return;
    }
    const text = shopPresentation(v, locale);
    const own = v.description.trim() && v.description !== written;
    if (own && !window.confirm(t("presentationReplace"))) return;
    set("description", text);
    setWritten(text);
  }

  const field = "h-11 w-full rounded-xl border border-border bg-surface px-3 text-[14px] text-foreground focus:border-gold focus:outline-none";
  const label = "mb-1 block text-[12.5px] font-bold text-foreground";
  const hint = "mt-1 text-[11.5px] leading-snug text-muted";
  const nameSlug = slugPreview(v.name);

  const imageSlot = (k: "logo_path" | "cover_path", wide = false) => (
    <label
      className={`relative grid cursor-pointer place-items-center overflow-hidden rounded-2xl border border-dashed border-border bg-surface-2/50 text-muted transition hover:border-gold-soft ${
        wide ? "aspect-[3/1] w-full" : "size-24"
      }`}
    >
      {v[k] ? (
        // eslint-disable-next-line @next/next/no-img-element -- a just-uploaded preview
        <img src={propertyPhotoUrl(v[k]!, { transform: { width: wide ? 900 : 200, quality: 70 } })} alt="" className="absolute inset-0 size-full object-cover" />
      ) : uploading === k ? (
        <Loader2 className="size-5 animate-spin" />
      ) : (
        <span className="flex flex-col items-center gap-1 text-[11.5px] font-semibold">
          <ImagePlus className="size-5" /> {t(k === "logo_path" ? "logo" : "cover")}
        </span>
      )}
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(k, f);
        }}
      />
    </label>
  );

  return (
    <form onSubmit={submit} className="space-y-5">
      <section className="space-y-3">
        {imageSlot("cover_path", true)}
        <div className="flex items-end gap-3">
          {imageSlot("logo_path")}
          <p className="pb-1 text-[11.5px] leading-snug text-muted">{t("imagesHint")}</p>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label} htmlFor="shop-name">{t("name")}</label>
          <input id="shop-name" className={field} value={v.name} onChange={(e) => set("name", e.target.value)} required maxLength={80} dir="auto" autoComplete="organization" />
          {mode === "create" && suggestedName && !v.name.trim() && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => set("name", suggestedName)} className={chip(false)} dir="auto">
                {t("useMyName", { name: suggestedName })}
              </button>
            </div>
          )}
          {/* The address follows the name. At creation the server makes it
              (and changing it comes later); afterwards it is changed on
              purpose only, behind « Modifier ». */}
          {mode === "create" ? (
            v.name.trim() && (
              <p className={hint}>
                {t.rich("slugLine", { url: () => <span className="break-all font-semibold text-foreground" dir="ltr">mazed.immo/boutiques/{nameSlug}</span> })} · {t("slugLater")}
              </p>
            )
          ) : editingSlug ? (
            <div className="mt-3">
              <label className={label} htmlFor="shop-slug">{t("slug")}</label>
              <div className="flex items-center gap-1 rounded-xl border border-border bg-surface px-3" dir="ltr">
                <span className="text-[13px] text-muted">mazed.immo/boutiques/</span>
                <input id="shop-slug" className="h-11 min-w-0 flex-1 bg-transparent text-[14px] text-foreground focus:outline-none" value={v.slug ?? ""} onChange={(e) => set("slug", typedSlug(e.target.value))} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
              </div>
              {!nameSlug.startsWith("boutique-") && nameSlug !== v.slug && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => set("slug", nameSlug)} className={chip(false)}>
                    {t("slugFromName")} <span className="break-all" dir="ltr">{nameSlug}</span>
                  </button>
                </div>
              )}
              <p className={hint}>{t("slugHint")}</p>
            </div>
          ) : (
            <p className={cn(hint, "flex flex-wrap items-center gap-x-2")}>
              <span>{t.rich("slugLine", { url: () => <span className="break-all font-semibold text-foreground" dir="ltr">mazed.immo/boutiques/{v.slug}</span> })}</span>
              <button type="button" onClick={() => setEditingSlug(true)} className="tap-target inline-flex items-center font-bold text-gold hover:underline">
                {t("slugEdit")}
              </button>
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <span className={label} id="shop-kind-label">{t("kind")}</span>
          <div role="radiogroup" aria-labelledby="shop-kind-label" className="flex flex-wrap gap-2">
            {SHOP_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={v.kind === k} onClick={() => set("kind", k)} className={chip(v.kind === k)}>
                {tKinds(k)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={label} htmlFor="shop-gov">{t("governorate")}</label>
          <select
            id="shop-gov"
            className={field}
            value={v.governorate}
            onChange={(e) => {
              const gov = e.target.value;
              // A délégation belongs to one governorate; a typed city stays.
              setV((s) => ({ ...s, governorate: gov, city: cityTyped || delegationsOf(gov).includes(s.city) ? s.city : "" }));
            }}
            required
          >
            <option value="">—</option>
            {TUNISIAN_GOVERNORATES.map((g) => (
              <option key={g} value={g}>{governorateLabel(g, locale)}</option>
            ))}
          </select>
        </div>
        {/* The city is the governorate's délégation, picked; one that is not on
            the list is written under « Autre ». Both go out as `city`. */}
        <div>
          <label className={label} htmlFor="shop-city">{t("delegation")}</label>
          <select
            id="shop-city"
            className={field}
            value={cityTyped ? OTHER : delegationsOf(v.governorate).includes(v.city) ? v.city : ""}
            disabled={!v.governorate}
            onChange={(e) => {
              const picked = e.target.value;
              setCityTyped(picked === OTHER);
              set("city", picked === OTHER ? "" : picked);
            }}
          >
            <option value="">{t("delegationPlaceholder")}</option>
            {delegationOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
            <option value={OTHER}>{t("cityOther")}</option>
          </select>
          {cityTyped && (
            <input
              aria-label={t("city")}
              className={cn(field, "mt-2")}
              value={v.city}
              onChange={(e) => set("city", e.target.value)}
              maxLength={80}
              dir="auto"
              placeholder={t("cityOtherPlaceholder")}
              autoFocus
            />
          )}
        </div>

        <div>
          <label className={label} htmlFor="shop-phone">{t("phone")}</label>
          <input id="shop-phone" type="tel" className={field} value={v.phone} onChange={(e) => set("phone", e.target.value)} dir="ltr" inputMode="tel" autoComplete="tel" placeholder="+216 …" />
        </div>
        <div>
          <label className={label} htmlFor="shop-email">{t("email")}</label>
          <input id="shop-email" type="email" className={field} value={v.email} onChange={(e) => set("email", e.target.value)} dir="ltr" inputMode="email" autoComplete="email" autoCapitalize="none" />
        </div>

        <div className="sm:col-span-2">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <label className="block text-[12.5px] font-bold text-foreground" htmlFor="shop-desc">{t("description")}</label>
            <button
              type="button"
              onClick={writePresentation}
              className="tap-target inline-flex items-center gap-1.5 rounded-full bg-surface px-4 py-2 text-[13px] font-bold text-foreground ring-1 ring-border transition hover:ring-gold-soft"
            >
              <PenLine className="size-4" /> {t("presentationWrite")}
            </button>
          </div>
          <textarea
            id="shop-desc"
            rows={4}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-[14px] leading-relaxed text-foreground focus:border-gold focus:outline-none"
            value={v.description}
            onChange={(e) => set("description", e.target.value)}
            maxLength={2000}
            dir="auto"
            placeholder={t("descriptionPlaceholder")}
          />
          {written !== null && v.description === written && <p className={hint}>{t("presentationEdit")}</p>}
        </div>
      </div>

      {/* What only some shops have: there, never in the way. */}
      <section className="rounded-2xl border border-border">
        <button
          type="button"
          onClick={() => setMore((o) => !o)}
          aria-expanded={more}
          aria-controls={moreId}
          className="tap-target flex w-full items-center justify-between gap-3 px-4 py-3 text-start"
        >
          <span>
            <span className="block text-[13.5px] font-bold text-foreground">{t("more")}</span>
            <span className="block text-[11.5px] text-muted">{t("moreHint")}</span>
          </span>
          <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform", more && "rotate-180")} />
        </button>
        {more && (
          <div id={moreId} className="grid gap-4 border-t border-border p-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="shop-web">{t("website")}</label>
              <input id="shop-web" className={field} value={v.website} onChange={(e) => set("website", e.target.value)} dir="ltr" inputMode="url" autoComplete="url" autoCapitalize="none" placeholder="www.…" />
            </div>
            <div className="sm:col-span-2">
              <span className={label} id="shop-hours-label">{t("hours")}</span>
              <div role="radiogroup" aria-labelledby="shop-hours-label" className="mb-2 flex flex-wrap gap-2">
                {HOURS_PRESETS.map((p) => {
                  const text = t(`hoursPresets.${p}`);
                  return (
                    <button key={p} type="button" role="radio" aria-checked={v.hours === text} onClick={() => set("hours", text)} className={chip(v.hours === text)}>
                      {text}
                    </button>
                  );
                })}
              </div>
              <input aria-labelledby="shop-hours-label" className={field} value={v.hours} onChange={(e) => set("hours", e.target.value)} dir="auto" placeholder={t("hoursPlaceholder")} />
            </div>
            <div>
              <label className={label} htmlFor="shop-legal">{t("legalName")}</label>
              <input id="shop-legal" className={field} value={v.legal_name} onChange={(e) => set("legal_name", e.target.value)} dir="auto" />
              {v.name.trim() && !v.legal_name.trim() && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => set("legal_name", v.name.trim())} className={chip(false)}>
                    {t("legalSameName")}
                  </button>
                </div>
              )}
            </div>
            <div>
              <label className={label} htmlFor="shop-legal-id">{t("legalId")}</label>
              <input id="shop-legal-id" className={field} value={v.legal_id} onChange={(e) => set("legal_id", e.target.value)} dir="ltr" autoCapitalize="characters" />
            </div>
            <p className="text-[11.5px] leading-snug text-muted sm:col-span-2">{t("legalHint")}</p>
          </div>
        )}
      </section>

      <button
        type="submit"
        disabled={busy || uploading !== null}
        className="mazed-btn-luxe tap-target flex h-12 w-full items-center justify-center gap-2 text-[14px] disabled:opacity-60 sm:w-auto sm:px-8"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {t(mode === "create" ? "submitCreate" : "submitSave")}
      </button>
    </form>
  );
}
