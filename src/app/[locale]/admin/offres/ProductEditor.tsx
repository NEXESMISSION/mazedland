"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AdminButton } from "@/components/admin/AdminButton";
import {
  TextField, TextareaField, NumberField, SelectField, ToggleField,
  FieldGrid, Confirm, useAdminAction, EYEBROW,
} from "@/components/admin/kit";
import { PRODUCT_KINDS, type ProductKind } from "@/lib/products";
import { Save, Power, ChevronLeft } from "lucide-react";

/**
 * The right pane: one thing a seller can buy.
 *
 * Every price on the platform is a row in `products` — never a constant in
 * code, never a jsonb blob in `app_settings`. That is the rule the pivot plan
 * set (§2.2) and it is what makes "3 annonces pour 50 TND" a form rather than
 * a deploy.
 *
 * Which fields matter depends on the kind, so the form shows only those: a
 * pack needs a quota, a badge needs a validity, a single publication can be
 * priced per category. Rendering all of them all the time is how you end up
 * with a badge that grants 5 publications.
 *
 * The Arabic name and description sit next to the French ones. Both are
 * optional: left empty, the Arabic site shows the French text.
 */

export type EditableProduct = {
  id: string;
  slug: string;
  kind: ProductKind;
  nameFr: string;
  nameAr: string | null;
  description: string | null;
  descriptionAr: string | null;
  price: number;
  categoryId: string | null;
  listingQuota: number | null;
  durationDays: number | null;
  isActive: boolean;
  sortOrder: number;
};

export function ProductEditor({
  product,
  categories,
  backHref,
}: {
  /** null = the "new product" form. */
  product: EditableProduct | null;
  categories: { id: string; label: string }[];
  /** With the locale prefix: it goes to next/navigation's router as is. */
  backHref: string;
}) {
  const t = useTranslations("adminOffers");
  const tc = useTranslations("common");
  const router = useRouter();
  const { run, pending } = useAdminAction();
  const [confirmOff, setConfirmOff] = useState(false);

  const [kind, setKind] = useState<ProductKind>(product?.kind ?? "listing_single");
  const [nameFr, setNameFr] = useState(product?.nameFr ?? "");
  const [nameAr, setNameAr] = useState(product?.nameAr ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [descriptionAr, setDescriptionAr] = useState(product?.descriptionAr ?? "");
  const [price, setPrice] = useState<number | null>(product?.price ?? null);
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [quota, setQuota] = useState<number | null>(product?.listingQuota ?? null);
  const [duration, setDuration] = useState<number | null>(product?.durationDays ?? null);
  const [isActive, setIsActive] = useState(product?.isActive ?? false);
  const [sortOrder, setSortOrder] = useState<number | null>(product?.sortOrder ?? 100);

  const isNew = product === null;
  const needsQuota = kind === "listing_pack" || kind === "subscription";
  const needsDuration = kind === "badge_verified" || kind === "listing_single" || kind === "renewal";
  const perCategory = kind === "listing_single";

  async function save() {
    const payload = {
      ...(isNew ? {} : { id: product.id }),
      kind,
      name_fr: nameFr,
      // The API trims both and stores an empty one as null.
      name_ar: nameAr,
      description,
      description_ar: descriptionAr,
      price,
      category_id: perCategory ? categoryId || null : null,
      listing_quota: needsQuota ? quota : null,
      duration_days: needsDuration ? duration : null,
      is_active: isActive,
      sort_order: sortOrder,
    };
    const ok = await run({
      url: "/api/admin/products",
      method: isNew ? "POST" : "PATCH",
      body: payload,
      success: isNew ? t("editor.created") : t("editor.saved"),
    });
    if (ok && isNew) router.push(backHref);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border px-5 py-3.5">
        <a
          href={backHref}
          className="mb-2 inline-flex items-center gap-1 text-[12px] font-medium text-subtle transition hover:text-foreground lg:hidden"
        >
          <ChevronLeft className="size-3.5 rtl:-scale-x-100" strokeWidth={2.4} />
          {t("editor.back")}
        </a>
        <h1 className="truncate text-[16px] font-semibold tracking-tight text-foreground">
          {isNew ? t("editor.newTitle") : nameFr || product.slug}
        </h1>
        <p className="mt-1 text-[11.5px] text-subtle">
          {t(`kindHints.${kind}`)}
          {!isNew && <span className="ms-2 opacity-70">· {product.slug}</span>}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        <div className="space-y-4">
          <SelectField
            label={t("editor.type")}
            value={kind}
            onChange={(v) => setKind(v as ProductKind)}
            disabled={!isNew}
            hint={isNew ? undefined : t("editor.typeLocked")}
            options={PRODUCT_KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }))}
          />

          <FieldGrid>
            <TextField
              label={t("editor.name")}
              value={nameFr}
              onChange={setNameFr}
              required
              placeholder={t("editor.namePlaceholder")}
            />
            <TextField
              label={t("editor.nameAr")}
              value={nameAr}
              onChange={setNameAr}
              placeholder={t("editor.nameArPlaceholder")}
              hint={t("editor.nameArHint")}
            />
          </FieldGrid>

          <FieldGrid>
            <TextareaField
              label={t("editor.description")}
              value={description}
              onChange={setDescription}
              rows={2}
              hint={t("editor.descriptionHint")}
            />
            <TextareaField
              label={t("editor.descriptionAr")}
              value={descriptionAr}
              onChange={setDescriptionAr}
              rows={2}
              hint={t("editor.descriptionArHint")}
            />
          </FieldGrid>

          <FieldGrid>
            <NumberField
              label={t("editor.price")}
              value={price}
              onChange={setPrice}
              min={0}
              step={0.5}
              suffix={tc("tnd")}
              hint={t("editor.priceHint")}
            />
            <NumberField
              label={t("editor.sortOrder")}
              value={sortOrder}
              onChange={setSortOrder}
              min={0}
              hint={t("editor.sortOrderHint")}
            />
          </FieldGrid>

          {perCategory && (
            <SelectField
              label={t("editor.category")}
              value={categoryId}
              onChange={setCategoryId}
              options={[
                { value: "", label: t("editor.allCategories") },
                ...categories.map((c) => ({ value: c.id, label: c.label })),
              ]}
              hint={t("editor.categoryHint")}
            />
          )}

          {needsQuota && (
            <NumberField
              label={t("editor.quota")}
              value={quota}
              onChange={setQuota}
              min={1}
              required
              suffix={t("editor.quotaSuffix")}
              hint={t("editor.quotaHint")}
            />
          )}

          {needsDuration && (
            <NumberField
              label={
                kind === "badge_verified"
                  ? t("editor.badgeValidity")
                  : t("editor.publicationDuration")
              }
              value={duration}
              onChange={setDuration}
              min={1}
              required={kind === "badge_verified"}
              suffix={t("editor.daysSuffix")}
              hint={
                kind === "badge_verified"
                  ? t("editor.badgeValidityHint")
                  : t("editor.publicationDurationHint")
              }
            />
          )}

          <div className="border-t border-border pt-4">
            <h2 className={EYEBROW}>{t("editor.availability")}</h2>
            <div className="mt-3">
              <ToggleField
                label={t("editor.onSale")}
                checked={isActive}
                onChange={setIsActive}
                hint={t("editor.onSaleHint")}
              />
            </div>
            {isActive && price == null && (
              <p className="mt-3 border-s-2 border-[var(--tone-warn)] ps-3 text-[12px] text-[var(--tone-warn)]">
                {t("editor.onSaleNoPrice")}
              </p>
            )}
          </div>
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border px-5 py-3">
        <AdminButton
          variant="primary"
          pending={pending}
          disabled={!nameFr.trim()}
          disabledReason={t("editor.nameMissing")}
          icon={<Save className="size-3.5" strokeWidth={2.4} />}
          onClick={save}
        >
          {isNew ? t("editor.create") : t("editor.save")}
        </AdminButton>

        {!isNew && isActive && (
          <AdminButton
            variant="quiet"
            className="ms-auto"
            icon={<Power className="size-3.5" strokeWidth={2.4} />}
            onClick={() => setConfirmOff(true)}
          >
            {t("editor.withdraw")}
          </AdminButton>
        )}
      </footer>

      <Confirm
        open={confirmOff}
        title={t("editor.confirmWithdrawTitle")}
        body={t("editor.confirmWithdrawBody")}
        confirmLabel={t("editor.confirmWithdraw")}
        variant="default"
        pending={pending}
        onCancel={() => setConfirmOff(false)}
        onConfirm={async () => {
          const ok = await run({
            url: `/api/admin/products?id=${product!.id}`,
            method: "DELETE",
            success: t("editor.withdrawn"),
          });
          if (ok) {
            setIsActive(false);
            setConfirmOff(false);
          }
        }}
      />
    </div>
  );
}
