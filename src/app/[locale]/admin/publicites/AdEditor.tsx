"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AdminButton, adminBtn } from "@/components/admin/AdminButton";
import { TextField, NumberField, ToggleField, FieldGrid, useAdminAction, EYEBROW } from "@/components/admin/kit";
import { useToast } from "@/components/ui/Toast";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { AD_IMAGE, AD_PLACEMENTS, adImageExt, safeAdLink, type AdPlacement } from "@/lib/ads/ads";
import { monthsFrom, tunisDay } from "@/lib/ads/dates";
import { ChevronLeft, ImagePlus, Loader2, Save } from "lucide-react";

/**
 * Create or change a campaign, typing as little as possible.
 *
 * A new campaign opens filled in: from today, for one month, switched on, in
 * the home page's top space — the admin names the advertiser, drops two
 * images and pastes the link. The space is a chip, the dates are chips
 * (« Aujourd'hui », « +1 mois », « +3 mois », « Sans fin ») with a date field
 * for anything else, and the link takes « www.banque.tn » as it is typed.
 *
 * Images go straight to storage through a signed URL (as annonce photos do)
 * the moment they are picked, so « Enregistrer » only sends their paths. The
 * size of a picked image is read and compared with the one the space is
 * drawn at: a 1200 × 800 photo in a 4:1 strip loses most of itself, and the
 * admin hears it before the advertiser does.
 */

export type EditableAd = {
  id: string;
  advertiser: string;
  title: string | null;
  titleAr: string | null;
  imagePath: string;
  imageMobilePath: string | null;
  link: string;
  placement: AdPlacement;
  startDay: string | null;
  endDay: string | null;
  active: boolean;
  sortOrder: number;
};

type Img = { path: string; src: string; width?: number; height?: number };
type Slot = "wide" | "mobile";

// The kit's field look (src/components/admin/kit/Field.tsx), for the controls
// it has no primitive for: a date, a group of chips.
const LABEL = "block text-[11.5px] font-semibold uppercase tracking-[0.08em] text-subtle";
const INPUT =
  "h-9 rounded-lg border border-border bg-surface-2 px-3 text-[13px] text-foreground transition focus:border-gold focus:outline-none";

function chip(on: boolean): string {
  return `inline-flex h-8 items-center rounded-full px-3 text-[12px] font-semibold transition ${
    on ? "bg-[var(--gold)] text-[var(--background)]" : "border border-border text-muted hover:border-[var(--gold-soft)] hover:text-[var(--gold)]"
  }`;
}

/** Off by more than this from the space's ratio, and the crop shows. */
const RATIO_TOLERANCE = 0.12;

function measure(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function AdEditor({
  ad,
  baseHref,
  cancelHref,
}: {
  /** null = a new campaign. */
  ad: EditableAd | null;
  /** /<locale>/admin/publicites — next/navigation's router takes it as is. */
  baseHref: string;
  cancelHref: string;
}) {
  const t = useTranslations("adminAds");
  const router = useRouter();
  const { toast } = useToast();
  const { run, pending } = useAdminAction();
  // Read once: the day the form was opened is « today » for its chips.
  const [today] = useState(() => tunisDay());

  const isNew = ad === null;
  const [advertiser, setAdvertiser] = useState(ad?.advertiser ?? "");
  const [placement, setPlacement] = useState<AdPlacement>(ad?.placement ?? "home_top");
  const [wide, setWide] = useState<Img | null>(ad ? { path: ad.imagePath, src: propertyPhotoUrl(ad.imagePath) } : null);
  const [mobile, setMobile] = useState<Img | null>(
    ad?.imageMobilePath ? { path: ad.imageMobilePath, src: propertyPhotoUrl(ad.imageMobilePath) } : null,
  );
  const [uploading, setUploading] = useState<Slot | null>(null);
  const [link, setLink] = useState(ad?.link ?? "");
  const [title, setTitle] = useState(ad?.title ?? "");
  const [titleAr, setTitleAr] = useState(ad?.titleAr ?? "");
  const [start, setStart] = useState(ad ? ad.startDay ?? "" : today);
  const [end, setEnd] = useState(ad ? ad.endDay ?? "" : monthsFrom(today, 1));
  const [active, setActive] = useState(ad?.active ?? true);
  const [order, setOrder] = useState<number | null>(ad?.sortOrder ?? 0);

  const cleanLink = safeAdLink(link);
  const datesOk = !start || !end || end >= start;
  const maxMb = Math.round(AD_IMAGE.maxBytes / 1024 / 1024);
  const base = start || today;

  const missing = !advertiser.trim()
    ? t("editor.missing.advertiser")
    : !wide
      ? t("editor.missing.image")
      : !cleanLink
        ? t("editor.missing.link")
        : !datesOk
          ? t("editor.missing.dates")
          : uploading
            ? t("editor.missing.uploading")
            : null;

  async function upload(file: File, slot: Slot) {
    const ext = adImageExt(file.type || file.name);
    if (!ext) return toast(t("editor.badType"), "error");
    if (file.size > AD_IMAGE.maxBytes) return toast(t("editor.tooBig", { max: maxMb }), "error");

    setUploading(slot);
    try {
      const res = await fetch("/api/admin/ads/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ext, size: file.size }),
      });
      const j = (await res.json().catch(() => ({}))) as { path?: string; signedUrl?: string; detail?: string };
      if (!res.ok || !j.path || !j.signedUrl) return toast(j.detail ?? t("editor.uploadFailed"), "error");

      // Multipart with an empty field name is what a signed upload expects
      // (see PhotoUploader). The path is unique, so the file can be cached
      // for a year: it is never replaced, only superseded.
      const form = new FormData();
      form.append("cacheControl", "31536000");
      form.append("", file);
      const put = await fetch(j.signedUrl, { method: "PUT", body: form });
      if (!put.ok) return toast(t("editor.uploadFailed"), "error");

      const src = URL.createObjectURL(file);
      const size = await measure(src);
      const next: Img = { path: j.path, src, ...(size ?? {}) };
      const set = slot === "wide" ? setWide : setMobile;
      set((prev) => {
        if (prev?.src.startsWith("blob:")) URL.revokeObjectURL(prev.src);
        return next;
      });
    } catch {
      toast(t("editor.uploadFailed"), "error");
    } finally {
      setUploading(null);
    }
  }

  async function save() {
    const created = { id: "" };
    const ok = await run({
      url: isNew ? "/api/admin/ads" : `/api/admin/ads/${ad.id}`,
      method: isNew ? "POST" : "PATCH",
      body: {
        advertiser,
        title,
        title_ar: titleAr,
        image_path: wide?.path,
        image_mobile_path: mobile?.path ?? null,
        link_url: cleanLink ?? link,
        placement,
        starts_on: start || null,
        ends_on: end || null,
        active,
        sort_order: order ?? 0,
      },
      success: isNew ? t("editor.created") : t("editor.saved"),
      onSuccess: (data) => {
        created.id = (data as { id?: string }).id ?? "";
      },
    });
    if (!ok) return;
    const id = isNew ? created.id : ad.id;
    router.push(id ? `${baseHref}?a=${id}` : baseHref);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border px-5 py-3.5">
        <a
          href={cancelHref}
          className="mb-2 inline-flex items-center gap-1 text-[12px] font-medium text-subtle transition hover:text-foreground lg:hidden"
        >
          <ChevronLeft className="size-3.5 rtl:-scale-x-100" strokeWidth={2.4} />
          {t("editor.back")}
        </a>
        <h2 className="truncate text-[16px] font-semibold tracking-tight text-foreground">
          {isNew ? t("editor.newTitle") : t("editor.editTitle")}
        </h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        <div className="space-y-5">
          <TextField
            label={t("editor.advertiser")}
            value={advertiser}
            onChange={setAdvertiser}
            required
            placeholder={t("editor.advertiserPlaceholder")}
          />

          <div>
            <p className={LABEL}>{t("editor.placement")}</p>
            <div role="radiogroup" aria-label={t("editor.placement")} className="mt-1.5 flex flex-wrap gap-1.5">
              {AD_PLACEMENTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={p === placement}
                  onClick={() => setPlacement(p)}
                  className={chip(p === placement)}
                >
                  {t(`placements.${p}`)}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11.5px] text-muted">{t(`placementHints.${placement}`)}</p>
          </div>

          <section className="border-t border-border pt-4">
            <h3 className={EYEBROW}>{t("editor.images")}</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <ImageField
                label={t("editor.wide")}
                hint={t("editor.wideHint", { ...AD_IMAGE.wide, max: maxMb })}
                target={AD_IMAGE.wide}
                aspect="aspect-[4/1]"
                image={wide}
                busy={uploading === "wide"}
                disabled={uploading !== null}
                onPick={(f) => upload(f, "wide")}
              />
              <ImageField
                label={t("editor.mobile")}
                hint={t("editor.mobileHint", AD_IMAGE.mobile)}
                target={AD_IMAGE.mobile}
                aspect="aspect-[2/1]"
                image={mobile}
                busy={uploading === "mobile"}
                disabled={uploading !== null}
                onPick={(f) => upload(f, "mobile")}
                onRemove={() => setMobile(null)}
              />
            </div>
          </section>

          <section className="space-y-4 border-t border-border pt-4">
            <TextField
              label={t("editor.link")}
              type="url"
              value={link}
              onChange={setLink}
              required
              placeholder={t("editor.linkPlaceholder")}
              error={link.trim() && !cleanLink ? t("editor.linkInvalid") : null}
              // What will really be saved, when it differs from what was typed.
              hint={cleanLink && cleanLink !== link.trim() ? <span dir="ltr">→ {cleanLink}</span> : t("editor.linkHint")}
            />

            <div>
              <p className={LABEL}>{t("editor.titles")}</p>
              <p className="mt-0.5 text-[11.5px] text-muted">{t("editor.titlesHint")}</p>
              <div className="mt-2">
                <FieldGrid>
                  <TextField
                    label={t("editor.titleFr")}
                    value={title}
                    onChange={setTitle}
                    placeholder={t("editor.titleFrPlaceholder")}
                  />
                  <TextField
                    label={t("editor.titleAr")}
                    value={titleAr}
                    onChange={setTitleAr}
                    placeholder={t("editor.titleArPlaceholder")}
                  />
                </FieldGrid>
              </div>
            </div>
          </section>

          <section className="border-t border-border pt-4">
            <h3 className={EYEBROW}>{t("editor.dates")}</h3>
            <div className="mt-3 space-y-4">
              <DayField label={t("editor.start")} hint={t("editor.startHint")} value={start} onChange={setStart}>
                <button type="button" onClick={() => setStart(today)} className={chip(start === today)}>
                  {t("editor.today")}
                </button>
              </DayField>
              <DayField
                label={t("editor.end")}
                hint={datesOk ? t("editor.endHint") : undefined}
                error={datesOk ? null : t("editor.datesInvalid")}
                value={end}
                min={start || undefined}
                onChange={setEnd}
              >
                <button type="button" onClick={() => setEnd(monthsFrom(base, 1))} className={chip(end === monthsFrom(base, 1))}>
                  {t("editor.plusOne")}
                </button>
                <button type="button" onClick={() => setEnd(monthsFrom(base, 3))} className={chip(end === monthsFrom(base, 3))}>
                  {t("editor.plusThree")}
                </button>
                <button type="button" onClick={() => setEnd("")} className={chip(end === "")}>
                  {t("editor.noEnd")}
                </button>
              </DayField>
            </div>
          </section>

          <section className="border-t border-border pt-4">
            <h3 className={EYEBROW}>{t("editor.display")}</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 sm:items-start">
              <ToggleField label={t("editor.active")} hint={t("editor.activeHint")} checked={active} onChange={setActive} />
              <NumberField
                label={t("editor.order")}
                hint={t("editor.orderHint")}
                value={order}
                onChange={setOrder}
                min={0}
                max={9999}
              />
            </div>
          </section>
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border px-5 py-3">
        <AdminButton
          variant="primary"
          pending={pending}
          disabled={missing !== null}
          disabledReason={missing ?? undefined}
          icon={<Save className="size-3.5" strokeWidth={2.4} />}
          onClick={save}
        >
          {isNew ? t("editor.create") : t("editor.save")}
        </AdminButton>
        <a href={cancelHref} className={adminBtn("quiet", "sm")}>
          {t("editor.cancel")}
        </a>
        {missing && <span className="text-[11.5px] text-subtle">{missing}</span>}
      </footer>
    </div>
  );
}

/** A picked banner image: its preview at the space's ratio, and its size. */
function ImageField({
  label,
  hint,
  target,
  aspect,
  image,
  busy,
  disabled,
  onPick,
  onRemove,
}: {
  label: string;
  hint: string;
  target: { width: number; height: number };
  aspect: string;
  image: Img | null;
  busy: boolean;
  disabled: boolean;
  onPick: (file: File) => void;
  onRemove?: () => void;
}) {
  const t = useTranslations("adminAds.editor");
  const input = useRef<HTMLInputElement>(null);
  const pick = () => input.current?.click();

  const ratio = image?.width && image.height ? image.width / image.height : null;
  const want = target.width / target.height;
  const off = ratio !== null && Math.abs(ratio - want) / want > RATIO_TOLERANCE;

  return (
    <div className="min-w-0">
      <p className={LABEL}>{label}</p>
      <div className={`relative mt-1.5 overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border ${aspect}`}>
        {image ? (
          // A blob: preview of the file just picked, or the stored image —
          // next/image cannot take the first, and the second is a thumbnail.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.src} alt="" className="size-full object-cover" />
        ) : (
          <button
            type="button"
            onClick={pick}
            disabled={disabled}
            className="flex size-full flex-col items-center justify-center gap-1 text-[12px] font-semibold text-subtle transition hover:text-foreground disabled:opacity-50"
          >
            <ImagePlus className="size-4" strokeWidth={2} />
            {t("choose")}
          </button>
        )}
        {busy && (
          <span className="absolute inset-0 grid place-items-center bg-black/50 text-[12px] font-semibold text-white">
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" />
              {t("uploading")}
            </span>
          </span>
        )}
      </div>
      {image && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <AdminButton disabled={disabled} onClick={pick}>
            {t("replace")}
          </AdminButton>
          {onRemove && (
            <AdminButton variant="quiet" disabled={disabled} onClick={onRemove}>
              {t("remove")}
            </AdminButton>
          )}
          {image.width && image.height && (
            <span className="mazed-tabular text-[11px] text-subtle" dir="ltr">
              {t("size", { width: image.width, height: image.height })}
            </span>
          )}
        </div>
      )}
      {off && image?.width && image.height && (
        <p className="mt-1 text-[11.5px] text-[var(--tone-warn)]">
          {t("ratioWarn", { width: image.width, height: image.height, target: `${target.width} × ${target.height} px` })}
        </p>
      )}
      <p className="mt-1 text-[11.5px] text-muted">{hint}</p>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so the same file can be picked again after a failed send.
          e.target.value = "";
          if (file) onPick(file);
        }}
      />
    </div>
  );
}

/** A day, with chips beside it for the usual answers. */
function DayField({
  label,
  hint,
  error,
  value,
  min,
  onChange,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  value: string;
  min?: string;
  onChange: (day: string) => void;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <input
          id={id}
          type="date"
          dir="ltr"
          value={value}
          min={min}
          onChange={(e) => onChange(e.target.value)}
          className={INPUT}
        />
        {children}
      </div>
      {error ? (
        <p className="mt-1 text-[11.5px] font-semibold text-[var(--tone-bad)]">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[11.5px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
