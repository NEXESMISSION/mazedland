"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { TUNISIAN_GOVERNORATES, governorateLabel } from "@/lib/tunisia";
import { SHOP_KINDS, type ShopKind } from "@/lib/pro/shops";
import { ImagePlus, Loader2 } from "lucide-react";

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

/**
 * The shop's page, as its owner fills it in — to open the shop (POST
 * /api/pro/shops) or to change it (PATCH /api/pro/shops/:id). The logo and the
 * cover go through the same signed upload as annonce photos.
 */
export function ShopForm({ initial, mode }: { initial: ShopFormValues; mode: "create" | "edit" }) {
  const t = useTranslations("pro.form");
  const tKinds = useTranslations("pro.kinds");
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const [v, setV] = useState<ShopFormValues>(initial);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<null | "logo_path" | "cover_path">(null);

  const set = <K extends keyof ShopFormValues>(k: K, value: ShopFormValues[K]) => setV((s) => ({ ...s, [k]: value }));

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

  const field = "h-11 w-full rounded-xl border border-border bg-surface px-3 text-[14px] text-foreground focus:border-gold focus:outline-none";
  const label = "mb-1 block text-[12.5px] font-bold text-foreground";

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
          <input id="shop-name" className={field} value={v.name} onChange={(e) => set("name", e.target.value)} required maxLength={80} dir="auto" />
        </div>
        <div>
          <span className={label}>{t("kind")}</span>
          <div className="grid grid-cols-2 gap-1.5">
            {SHOP_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => set("kind", k)}
                aria-pressed={v.kind === k}
                className={`rounded-xl border px-2.5 py-2 text-[12.5px] font-bold transition ${
                  v.kind === k ? "border-gold bg-gold-faint text-foreground" : "border-border text-muted hover:text-foreground"
                }`}
              >
                {tKinds(k)}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={label} htmlFor="shop-gov">{t("governorate")}</label>
            <select id="shop-gov" className={field} value={v.governorate} onChange={(e) => set("governorate", e.target.value)} required>
              <option value="">—</option>
              {TUNISIAN_GOVERNORATES.map((g) => (
                <option key={g} value={g}>{governorateLabel(g, locale)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="shop-city">{t("city")}</label>
            <input id="shop-city" className={field} value={v.city} onChange={(e) => set("city", e.target.value)} maxLength={80} dir="auto" />
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="shop-desc">{t("description")}</label>
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
        </div>
        <div>
          <label className={label} htmlFor="shop-phone">{t("phone")}</label>
          <input id="shop-phone" className={field} value={v.phone} onChange={(e) => set("phone", e.target.value)} dir="ltr" inputMode="tel" placeholder="+216 …" />
        </div>
        <div>
          <label className={label} htmlFor="shop-email">{t("email")}</label>
          <input id="shop-email" className={field} value={v.email} onChange={(e) => set("email", e.target.value)} dir="ltr" inputMode="email" />
        </div>
        <div>
          <label className={label} htmlFor="shop-web">{t("website")}</label>
          <input id="shop-web" className={field} value={v.website} onChange={(e) => set("website", e.target.value)} dir="ltr" placeholder="www.…" />
        </div>
        <div>
          <label className={label} htmlFor="shop-hours">{t("hours")}</label>
          <input id="shop-hours" className={field} value={v.hours} onChange={(e) => set("hours", e.target.value)} dir="auto" placeholder={t("hoursPlaceholder")} />
        </div>
        <div>
          <label className={label} htmlFor="shop-legal">{t("legalName")}</label>
          <input id="shop-legal" className={field} value={v.legal_name} onChange={(e) => set("legal_name", e.target.value)} dir="auto" />
        </div>
        <div>
          <label className={label} htmlFor="shop-legal-id">{t("legalId")}</label>
          <input id="shop-legal-id" className={field} value={v.legal_id} onChange={(e) => set("legal_id", e.target.value)} dir="ltr" />
        </div>
        {mode === "edit" && (
          <div className="sm:col-span-2">
            <label className={label} htmlFor="shop-slug">{t("slug")}</label>
            <div className="flex items-center gap-1 rounded-xl border border-border bg-surface px-3" dir="ltr">
              <span className="text-[13px] text-muted">mazed.immo/boutiques/</span>
              <input id="shop-slug" className="h-11 min-w-0 flex-1 bg-transparent text-[14px] text-foreground focus:outline-none" value={v.slug ?? ""} onChange={(e) => set("slug", e.target.value)} />
            </div>
            <p className="mt-1 text-[11.5px] text-muted">{t("slugHint")}</p>
          </div>
        )}
      </div>

      <p className="text-[11.5px] leading-snug text-muted">{t("legalHint")}</p>
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
