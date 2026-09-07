"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminButton } from "@/components/admin/AdminButton";
import {
  TextField, TextareaField, NumberField, SelectField, ToggleField,
  FieldGrid, Confirm, useAdminAction, EYEBROW,
} from "@/components/admin/kit";
import {
  PRODUCT_KINDS, PRODUCT_KIND_LABEL, PRODUCT_KIND_HINT, type ProductKind,
} from "@/lib/products";
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
 */

export type EditableProduct = {
  id: string;
  slug: string;
  kind: ProductKind;
  nameFr: string;
  description: string | null;
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
  backHref: string;
}) {
  const router = useRouter();
  const { run, pending } = useAdminAction();
  const [confirmOff, setConfirmOff] = useState(false);

  const [kind, setKind] = useState<ProductKind>(product?.kind ?? "listing_single");
  const [nameFr, setNameFr] = useState(product?.nameFr ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
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
      description,
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
      success: isNew ? "Offre créée." : "Offre enregistrée.",
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
          <ChevronLeft className="size-3.5" strokeWidth={2.4} />
          Offres
        </a>
        <h1 className="truncate text-[16px] font-semibold tracking-tight text-foreground">
          {isNew ? "Nouvelle offre" : nameFr || product.slug}
        </h1>
        <p className="mt-1 text-[11.5px] text-subtle">
          {PRODUCT_KIND_HINT[kind]}
          {!isNew && <span className="ms-2 opacity-70">· {product.slug}</span>}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        <div className="space-y-4">
          <SelectField
            label="Type"
            value={kind}
            onChange={(v) => setKind(v as ProductKind)}
            disabled={!isNew}
            hint={
              isNew
                ? undefined
                : "Le type ne change pas après création — des paiements y font référence."
            }
            options={PRODUCT_KINDS.map((k) => ({ value: k, label: PRODUCT_KIND_LABEL[k] }))}
          />

          <TextField
            label="Nom affiché"
            value={nameFr}
            onChange={setNameFr}
            required
            placeholder="Annonce standard, Pack 5 annonces…"
          />

          <TextareaField
            label="Description"
            value={description}
            onChange={setDescription}
            rows={2}
            hint="Visible par le vendeur sur la page Tarifs."
          />

          <FieldGrid>
            <NumberField
              label="Prix"
              value={price}
              onChange={setPrice}
              min={0}
              step={0.5}
              suffix="TND"
              hint="0 = gratuit. Vide = non configuré, et rien ne peut être vendu."
            />
            <NumberField
              label="Ordre d'affichage"
              value={sortOrder}
              onChange={setSortOrder}
              min={0}
              hint="Petit d'abord."
            />
          </FieldGrid>

          {perCategory && (
            <SelectField
              label="Catégorie"
              value={categoryId}
              onChange={setCategoryId}
              options={[
                { value: "", label: "Toutes les catégories" },
                ...categories.map((c) => ({ value: c.id, label: c.label })),
              ]}
              hint="Un prix par catégorie l'emporte sur le prix global. Une seule annonce à l'unité active par catégorie."
            />
          )}

          {needsQuota && (
            <NumberField
              label="Publications accordées"
              value={quota}
              onChange={setQuota}
              min={1}
              required
              suffix="annonces"
              hint="Ce que le vendeur peut publier avec ce forfait."
            />
          )}

          {needsDuration && (
            <NumberField
              label={kind === "badge_verified" ? "Validité du badge" : "Durée de publication"}
              value={duration}
              onChange={setDuration}
              min={1}
              required={kind === "badge_verified"}
              suffix="jours"
              hint={
                kind === "badge_verified"
                  ? "Renouvelable, et révocable à tout moment."
                  : "Combien de temps l'annonce reste en ligne. Vide = 30 jours."
              }
            />
          )}

          <div className="border-t border-border pt-4">
            <h2 className={EYEBROW}>Disponibilité</h2>
            <div className="mt-3">
              <ToggleField
                label="En vente"
                checked={isActive}
                onChange={setIsActive}
                hint="Désactivée, l'offre disparaît de la page Tarifs mais reste liée aux paiements déjà faits."
              />
            </div>
            {isActive && price == null && (
              <p className="mt-3 border-s-2 border-[var(--tone-warn)] ps-3 text-[12px] text-[var(--tone-warn)]">
                En vente sans prix configuré : le vendeur ne pourra pas payer.
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
          disabledReason="Donnez un nom à l'offre."
          icon={<Save className="size-3.5" strokeWidth={2.4} />}
          onClick={save}
        >
          {isNew ? "Créer" : "Enregistrer"}
        </AdminButton>

        {!isNew && isActive && (
          <AdminButton
            variant="quiet"
            className="ms-auto"
            icon={<Power className="size-3.5" strokeWidth={2.4} />}
            onClick={() => setConfirmOff(true)}
          >
            Retirer de la vente
          </AdminButton>
        )}
      </footer>

      <Confirm
        open={confirmOff}
        title="Retirer cette offre de la vente ?"
        body="Elle disparaît de la page Tarifs. Elle n'est jamais supprimée : des paiements et des forfaits déjà vendus y font référence."
        confirmLabel="Retirer"
        variant="default"
        pending={pending}
        onCancel={() => setConfirmOff(false)}
        onConfirm={async () => {
          const ok = await run({
            url: `/api/admin/products?id=${product!.id}`,
            method: "DELETE",
            success: "Offre retirée de la vente.",
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
