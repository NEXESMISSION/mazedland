"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { compressImage } from "@/lib/imageCompress";
import type { PropertyType } from "@/lib/types";
import { Camera, FileText, Trash2, CheckCircle2 } from "lucide-react";

const TYPES: PropertyType[] = ["apartment", "house", "villa", "land", "commercial", "office", "warehouse", "farm"];

const GOVERNORATES = [
  "Tunis", "Ariana", "Ben Arous", "Manouba",
  "Sousse", "Monastir", "Mahdia", "Nabeul",
  "Sfax", "Bizerte", "Gabès", "Médenine",
  "Kairouan", "Béja", "Jendouba", "Kef",
  "Kasserine", "Sidi Bouzid", "Gafsa", "Tozeur",
  "Kebili", "Tataouine", "Siliana", "Zaghouan",
];

const DOC_KINDS = ["Titre foncier", "Permis de bâtir", "Certificat de propriété", "Quitus fiscal", "Autre"];

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
 * Property listing form. Insert mode (default) creates a new row +
 * uploads photos & docs. Edit mode (when `initial` is passed) updates
 * the existing row, appends any newly-picked photos/docs to the
 * existing storage, and flips status back to `pending_review` so the
 * admin re-reviews after a fix (audit #14).
 */
export function SellForm({ initial }: { initial?: SellFormInitial } = {}) {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const isRTL = locale === "ar";
  const isEdit = !!initial;

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
  const [docs, setDocs] = useState<{ kind: string; file: File }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const next = [...photos, ...Array.from(files)].slice(0, 10);
    setPhotos(next);
  }
  function addDoc(file: File | null, kind: string) {
    if (!file) return;
    setDocs((prev) => [...prev, { kind, file }]);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // In edit mode the user keeps existing photos by default — only
    // first-time creates require at least one new upload.
    if (!isEdit && photos.length === 0) {
      setError("At least one photo is required.");
      return;
    }
    startTransition(async () => {
      const supabase = getBrowserSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("Not signed in."); return; }

      try {
        // 1. Create or update the property row. Edit-mode flips status
        //    back to pending_review and clears any prior rejection so the
        //    next admin pass treats it as a fresh review.
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
        // Sentinel kept so the rest of the function keeps using `prop.id`-style refs
        // through a single name. Same value as propId.
        const prop = { id: propId };

        // 2. Compress + upload photos in parallel. Storage paths are
        //    owner-scoped to satisfy the storage RLS policy that gates
        //    uploads on `(storage.foldername(name))[1] = auth.uid()`.
        //    In edit mode we APPEND — existing photos stay; the user
        //    can use the photo manager (TBD) to remove specific shots
        //    later.
        //
        //    compressImage runs decode → 1600px resize → WebP q0.80 on
        //    a canvas. A 4 MB phone capture lands at ~250 KB without a
        //    perceptual loss, and the resulting File still uploads
        //    through the same supabase.storage path. The helper is
        //    failure-tolerant: on any error it returns the original
        //    file unchanged so the upload never breaks on the
        //    compression step.
        if (photos.length > 0) {
          const compressed = await Promise.all(
            photos.map((file) =>
              compressImage(file, { maxEdge: 1600, quality: 0.8, format: "webp" }),
            ),
          );
          const photoUploads = await Promise.all(
            compressed.map(async (file, i) => {
              const ext = file.name.split(".").pop()?.toLowerCase() || "webp";
              const path = `${user.id}/${prop.id}/photo-${Date.now()}-${i}.${ext}`;
              const { error } = await supabase.storage.from("properties").upload(path, file, {
                contentType: file.type, upsert: false,
              });
              if (error) throw new Error(`photo ${i}: ${error.message}`);
              return { storage_path: path, sort_order: i };
            }),
          );
          await supabase.from("property_photos").insert(
            photoUploads.map((p) => ({ ...p, property_id: prop.id })),
          );
        }

        // 3. Documents — optional. Sensitive (titre foncier, permis de
        //    bâtir, quitus fiscal) so they land in the PRIVATE bucket
        //    `property-documents` instead of the public `properties`
        //    photo bucket. Storage RLS gates reads to: owner, admin, or
        //    any KYC-verified bidder with an active deposit on this
        //    property's auction. Path layout
        //    `<owner_uuid>/<property_uuid>/doc-...`
        //    matches the policy's foldername[1]/foldername[2] check.
        if (docs.length > 0) {
          const docUploads = await Promise.all(
            docs.map(async ({ kind, file }, i) => {
              const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
              const path = `${user.id}/${prop.id}/doc-${Date.now()}-${i}.${ext}`;
              const { error } = await supabase.storage
                .from("property-documents")
                .upload(path, file, { contentType: file.type, upsert: false });
              if (error) throw new Error(`doc ${i}: ${error.message}`);
              return { property_id: prop.id, kind, storage_path: path };
            }),
          );
          await supabase.from("property_documents").insert(docUploads);
        }

        setSuccess(true);
        setTimeout(() => router.replace("/sell"), 2400);
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

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-4">
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
                type="file" accept="image/*" multiple capture="environment"
                className="hidden"
                onChange={(e) => addPhotos(e.target.files)}
              />
            </label>
          )}
        </div>
      </div>

      {/* Documents */}
      <div>
        <span className="text-xs font-semibold text-batta-ink/80">{t("sell.form.documents")}</span>
        <p className="mt-0.5 text-[10px] text-batta-muted">{t("sell.form.documentsHint")}</p>
        <div className="mt-2 space-y-1.5">
          {docs.map((d, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg bg-batta-surface-2 px-3 py-2 text-xs text-batta-cream">
              <span className="flex items-center gap-2 truncate">
                <FileText className="size-3.5 shrink-0 text-batta-blue" />
                <span className="font-semibold text-batta-cream">{d.kind}</span>
                <span className="truncate text-batta-muted">· {d.file.name}</span>
              </span>
              <button
                type="button"
                onClick={() => setDocs((prev) => prev.filter((_, idx) => idx !== i))}
                className="text-red-500"
                aria-label="Remove"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          <DocPicker onPick={addDoc} />
        </div>
      </div>

      {error && (
        <p className="batta-tone-bad rounded-lg px-3 py-2 text-xs">{error}</p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="batta-btn-luxe tap-target sticky bottom-[calc(var(--batta-bottombar-h)+var(--batta-safe-bottom)+12px)] z-20 mt-4 w-full px-5 py-3.5 text-[13.5px] disabled:opacity-50"
      >
        {isEdit
          ? (isPending ? t("sell.saving") : t("sell.saveChanges"))
          : (isPending ? t("sell.form.submitting") : t("sell.form.submit"))}
      </button>
    </form>
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

function DocPicker({ onPick }: { onPick: (file: File | null, kind: string) => void }) {
  const [kind, setKind] = useState(DOC_KINDS[0]);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-batta-gold/30 bg-batta-surface-2 p-2">
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        className="rounded-md border border-batta-gold/25 bg-batta-surface px-2 py-1.5 text-xs text-batta-cream"
      >
        {DOC_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
      <label className="tap-target inline-flex flex-1 cursor-pointer items-center justify-center rounded-md bg-batta-gold/12 px-2 py-1.5 text-xs font-semibold text-batta-gold-bright ring-1 ring-batta-gold/30">
        + Pick file
        <input
          type="file" accept=".pdf,image/*" className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            onPick(f ?? null, kind);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}
