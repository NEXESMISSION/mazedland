import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { adminBtn } from "@/components/admin/AdminButton";
import { FullBleed, EmptyState, QueueKeys, EYEBROW } from "@/components/admin/kit";
import { ROW_BASE, ROW_IDLE, ROW_SELECTED, ROW_FOCUS } from "@/components/admin/kit/surface";
import { ProductEditor, type EditableProduct } from "./ProductEditor";
import {
  PRODUCT_SELECT, PRODUCT_KIND_LABEL, toProduct, type ProductKind,
} from "@/lib/products";
import { formatTND } from "@/lib/utils";
import { Tag, Plus } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Offres & prix — the only place a price exists.
 *
 * This replaces `/admin/pricing`, and it is meant to end a split brain that
 * has been live for weeks: `/admin/pricing` wrote the `products` table (which
 * the sell flow reads), while `/admin/settings` wrote
 * `app_settings.fee_listing_*` (which only a legacy route reads). They held
 * different numbers — 20 TND against 15 — so an admin changing the publication
 * fee in Réglages changed nothing a seller would ever see. Migration 0172
 * folds those keys into this table and deletes them; until it runs, this
 * screen is already the one that decides.
 *
 * Inactive products are listed on purpose: you cannot switch something back on
 * that you cannot see.
 */

const KIND_ORDER: ProductKind[] = [
  "listing_single",
  "listing_pack",
  "subscription",
  "renewal",
  "promo",
  "badge_verified",
];

export default async function AdminOffresPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string }>;
}) {
  const sp = await searchParams;
  const admin = getServiceSupabase();
  if (!admin) return <p className="text-[13px] text-muted">Service non configuré.</p>;

  const [prodRes, catRes] = await Promise.all([
    admin.from("products").select(PRODUCT_SELECT).order("sort_order").order("created_at"),
    admin
      .from("categories")
      .select("id, label_fr, parent_id, sort_order")
      .eq("is_active", true)
      .order("sort_order"),
  ]);

  const products = (prodRes.data ?? []).map((r) => toProduct(r as Parameters<typeof toProduct>[0]));

  // Only leaf categories can carry a price: "Résidentiel" is a heading, and
  // pricing a heading would silently shadow its children.
  type Cat = { id: string; label_fr: string; parent_id: string | null };
  const catRows = (catRes.data ?? []) as Cat[];
  const categories = catRows
    .filter((c) => c.parent_id !== null)
    .map((c) => ({ id: c.id, label: c.label_fr }));

  const openId = sp.a ?? null;
  const creating = openId === "new";
  const selected = creating ? null : products.find((p) => p.id === openId) ?? null;

  const editable: EditableProduct | null = selected
    ? {
        id: selected.id,
        slug: selected.slug,
        kind: selected.kind,
        nameFr: selected.nameFr,
        description: selected.description,
        price: selected.price,
        categoryId: selected.categoryId,
        listingQuota: selected.listingQuota,
        durationDays: selected.durationDays,
        isActive: selected.isActive,
        sortOrder: selected.sortOrder,
      }
    : null;

  const showEditor = creating || Boolean(editable);

  // Anything the seller can see but not buy is a dead end on the Tarifs page.
  const misconfigured = products.filter((p) => p.isActive && (p.price === null || p.price === undefined));

  return (
    <FullBleed>
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border px-4">
        <h1 className="shrink-0 text-[13px] font-semibold tracking-tight text-foreground">
          Offres &amp; prix
        </h1>
        <span className="text-[11.5px] text-subtle">
          {products.filter((p) => p.isActive).length} en vente · {products.length} au total
        </span>
        <Link href="/admin/offres?a=new" className={`${adminBtn("primary", "sm")} ms-auto shrink-0`}>
          <Plus className="size-3.5" strokeWidth={2.8} />
          <span className="hidden sm:inline">Nouvelle offre</span>
        </Link>
      </header>

      <QueueKeys />

      <div className="flex min-h-0 flex-1">
        <div
          className={`flex min-h-0 w-full flex-col border-border lg:w-[360px] lg:shrink-0 lg:border-e xl:w-[400px] ${
            showEditor ? "hidden lg:flex" : "flex"
          }`}
        >
          {products.length === 0 ? (
            <div className="p-5">
              <EmptyState
                Icon={Tag}
                title="Aucune offre"
                hint="Créez ce qu'un vendeur peut acheter : une publication, un pack, une mise en avant, le badge."
              />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {misconfigured.length > 0 && (
                <p className="border-b border-border bg-[var(--tone-warn-bg)] px-4 py-2.5 text-[11.5px] text-[var(--tone-warn)]">
                  {misconfigured.length} offre{misconfigured.length === 1 ? "" : "s"} en vente sans
                  prix configuré — le vendeur ne peut pas payer.
                </p>
              )}

              {KIND_ORDER.map((kind) => {
                const group = products.filter((p) => p.kind === kind);
                if (group.length === 0) return null;
                return (
                  <section key={kind}>
                    <h2
                      className={`${EYEBROW} border-b border-border bg-background px-4 py-1.5`}
                    >
                      {PRODUCT_KIND_LABEL[kind]}
                    </h2>
                    <ul className="divide-y divide-border/70">
                      {group.map((p) => {
                        const sel = p.id === openId;
                        return (
                          <li key={p.id}>
                            <Link
                              href={`/admin/offres?a=${p.id}` as "/admin/offres"}
                              data-row-id={p.id}
                              aria-current={sel ? "true" : undefined}
                              prefetch={false}
                              className={`${ROW_BASE} ${ROW_FOCUS} ${sel ? ROW_SELECTED : ROW_IDLE}`}
                            >
                              <span
                                className={`mt-[7px] size-[5px] shrink-0 rounded-full ${
                                  p.isActive ? "bg-[var(--tone-ok)]" : "bg-[var(--foreground-subtle)]"
                                }`}
                              />
                              <span className="min-w-0 flex-1">
                                <span
                                  className={`block truncate text-[13px] ${
                                    sel
                                      ? "font-semibold text-foreground"
                                      : "font-medium text-foreground/90"
                                  } ${p.isActive ? "" : "line-through decoration-[var(--foreground-subtle)]"}`}
                                >
                                  {p.nameFr}
                                </span>
                                <span className="mt-0.5 block truncate text-[11.5px] text-subtle">
                                  {[
                                    p.categoryId
                                      ? categories.find((c) => c.id === p.categoryId)?.label
                                      : kind === "listing_single"
                                        ? "toutes catégories"
                                        : null,
                                    p.listingQuota ? `${p.listingQuota} annonces` : null,
                                    p.durationDays ? `${p.durationDays} j` : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ") || "—"}
                                </span>
                              </span>
                              <span className="shrink-0 text-end">
                                <span
                                  className={`batta-tabular block text-[12.5px] ${
                                    p.price == null
                                      ? "text-[var(--tone-warn)]"
                                      : p.price === 0
                                        ? "text-[var(--tone-ok)]"
                                        : "text-foreground/90"
                                  }`}
                                >
                                  {p.price == null
                                    ? "sans prix"
                                    : p.price === 0
                                      ? "gratuit"
                                      : `${formatTND(p.price, "fr")} TND`}
                                </span>
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <div className={`min-w-0 flex-1 ${showEditor ? "flex" : "hidden lg:flex"}`}>
          {showEditor ? (
            <div className="w-full">
              <ProductEditor
                product={editable}
                categories={categories}
                backHref="/fr/admin/offres"
              />
            </div>
          ) : (
            <div className="grid w-full place-items-center px-6">
              <p className="max-w-xs text-center text-[12.5px] text-subtle">
                Choisissez une offre à gauche, ou créez-en une.
                <br />
                <span className="text-[11.5px]">
                  Tout ce qu'un vendeur peut acheter vit ici — jamais dans le code.
                </span>
              </p>
            </div>
          )}
        </div>
      </div>
    </FullBleed>
  );
}
