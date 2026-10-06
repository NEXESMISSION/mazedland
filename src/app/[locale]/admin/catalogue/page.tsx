import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { categoryLabel } from "@/lib/i18n";
import { FullBleed, EmptyState, EYEBROW } from "@/components/admin/kit";
import { ROW_BASE, ROW_IDLE, ROW_SELECTED, ROW_FOCUS } from "@/components/admin/kit/surface";
import { AttributeEditor, type Attribute, type CategoryInfo } from "./AttributeEditor";
import { FolderTree, Pencil } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Catalogue — the category tree, and what an annonce in each one is made of.
 *
 * The definitions behind the fixed-price catalogue — 32 attributes across 11
 * categories — which until now had no admin screen at all, so the new seller
 * wizard could only be changed by a developer.
 *
 * `/admin/characteristics` stays where it is. On Auto that screen was dead;
 * here it still drives the auction sell form, and both products are live.
 *
 * Categories are shown as the tree they are: a parent is a heading, and only
 * a leaf can hold annonces and attributes. Pricing and attributes both attach
 * to leaves, which is why "Résidentiel" has no attribute pane: opening a
 * heading only edits its names, French and Arabic (`label_ar`, which the
 * Arabic site shows through categoryLabel()).
 */

export default async function AdminCataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string }>;
}) {
  const sp = await searchParams;
  const t = await getTranslations("adminCatalogue");
  const locale = await getLocale();
  const admin = getServiceSupabase();
  if (!admin) return <p className="text-[13px] text-muted">{t("notConfigured")}</p>;

  const [catRes, attrRes, listingRes] = await Promise.all([
    admin
      .from("categories")
      .select("id, parent_id, slug, label_fr, label_ar, kind, sort_order, is_active")
      .order("sort_order"),
    admin
      .from("category_attributes")
      .select("id, category_id, field_key, label, data_type, options, unit, required, filterable, sort_order")
      .order("sort_order"),
    // How many annonces sit in each category — the number that says whether a
    // category is real or aspirational, and whether it is safe to touch.
    admin.from("listings").select("category_id, attributes"),
  ]);

  type Cat = {
    id: string; parent_id: string | null; slug: string; label_fr: string;
    label_ar: string | null; kind: string; sort_order: number; is_active: boolean;
  };
  type Attr = {
    id: string; category_id: string; field_key: string; label: string;
    data_type: string; options: { value: string; label: string }[] | null;
    unit: string | null; required: boolean; filterable: boolean; sort_order: number;
  };
  type Listing = { category_id: string; attributes: Record<string, unknown> | null };

  const cats = (catRes.data ?? []) as Cat[];
  const attrs = (attrRes.data ?? []) as Attr[];
  const listings = (listingRes.data ?? []) as Listing[];

  const countByCat = new Map<string, number>();
  // Per-attribute usage, so the editor can refuse a delete that would orphan
  // values — counted here in one pass instead of one query per attribute.
  const usage = new Map<string, number>();
  for (const l of listings) {
    countByCat.set(l.category_id, (countByCat.get(l.category_id) ?? 0) + 1);
    for (const key of Object.keys(l.attributes ?? {})) {
      const k = `${l.category_id}:${key}`;
      usage.set(k, (usage.get(k) ?? 0) + 1);
    }
  }

  const parents = cats.filter((c) => c.parent_id === null);
  const openId = sp.a ?? null;
  // A leaf opens its attributes; a heading opens only its names.
  const selected = cats.find((c) => c.id === openId) ?? null;
  const selectedIsHeading = selected !== null && selected.parent_id === null;

  const selectedInfo: CategoryInfo | null = selected
    ? {
        id: selected.id,
        parentId: selected.parent_id,
        labelFr: selected.label_fr,
        labelAr: selected.label_ar,
        kind: selected.kind,
        sortOrder: selected.sort_order,
        isActive: selected.is_active,
      }
    : null;

  const selectedAttrs: Attribute[] =
    selected && !selectedIsHeading
      ? attrs
          .filter((a) => a.category_id === selected.id)
          .map((a) => ({
            id: a.id,
            fieldKey: a.field_key,
            label: a.label,
            dataType: a.data_type,
            options: a.options,
            unit: a.unit,
            required: a.required,
            filterable: a.filterable,
            sortOrder: a.sort_order,
            usedBy: usage.get(`${a.category_id}:${a.field_key}`) ?? 0,
          }))
      : [];

  /** The name in the other language, beside the main one: Arabic on the French
   *  console, French on the Arabic one (when the Arabic name exists at all). */
  function otherName(c: Cat): string | null {
    if (locale === "ar") return c.label_ar ? c.label_fr : null;
    return c.label_ar ?? null;
  }

  return (
    <FullBleed>
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border px-4">
        <h1 className="shrink-0 text-[13px] font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <span className="text-[11.5px] text-subtle">
          {t("summary", {
            categories: cats.filter((c) => c.parent_id !== null).length,
            attributes: attrs.length,
          })}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <div
          className={`flex min-h-0 w-full flex-col border-border lg:w-[300px] lg:shrink-0 lg:border-e xl:w-[340px] ${
            selected ? "hidden lg:flex" : "flex"
          }`}
        >
          {cats.length === 0 ? (
            <div className="p-5">
              <EmptyState Icon={FolderTree} title={t("emptyCategories")} />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {parents.map((parent) => {
                const children = cats.filter((c) => c.parent_id === parent.id);
                const parentName = categoryLabel(parent, locale);
                return (
                  <section key={parent.id}>
                    <h2
                      className={`${EYEBROW} flex items-center gap-2 border-b border-border px-4 py-1.5 ${
                        parent.id === openId ? "bg-[var(--row-selected)]" : ""
                      }`}
                    >
                      <span className="min-w-0 truncate">{parentName}</span>
                      {!parent.label_ar && locale !== "ar" && (
                        <span className="shrink-0 font-medium normal-case tracking-normal text-[var(--tone-warn)]">
                          {t("noArabicName")}
                        </span>
                      )}
                      <Link
                        href={`/admin/catalogue?a=${parent.id}` as "/admin/catalogue"}
                        prefetch={false}
                        aria-current={parent.id === openId ? "true" : undefined}
                        aria-label={t("editNames", { name: parentName })}
                        title={t("editNames", { name: parentName })}
                        className="ms-auto grid size-5 shrink-0 place-items-center text-subtle transition hover:text-foreground"
                      >
                        <Pencil className="size-3" strokeWidth={2.4} />
                      </Link>
                    </h2>
                    <ul className="divide-y divide-border/70">
                      {children.map((c) => {
                        const sel = c.id === openId;
                        const nAttrs = attrs.filter((a) => a.category_id === c.id).length;
                        const nListings = countByCat.get(c.id) ?? 0;
                        const other = otherName(c);
                        return (
                          <li key={c.id}>
                            <Link
                              href={`/admin/catalogue?a=${c.id}` as "/admin/catalogue"}
                              aria-current={sel ? "true" : undefined}
                              prefetch={false}
                              className={`${ROW_BASE} ${ROW_FOCUS} ${sel ? ROW_SELECTED : ROW_IDLE}`}
                            >
                              <span
                                className={`mt-[7px] size-[5px] shrink-0 rounded-full ${
                                  c.is_active ? "bg-[var(--tone-ok)]" : "bg-[var(--foreground-subtle)]"
                                }`}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="flex min-w-0 items-baseline gap-2">
                                  <span
                                    className={`truncate text-[13px] ${
                                      sel
                                        ? "font-semibold text-foreground"
                                        : "font-medium text-foreground/90"
                                    }`}
                                  >
                                    {categoryLabel(c, locale)}
                                  </span>
                                  {other ? (
                                    <span
                                      lang={locale === "ar" ? "fr" : "ar"}
                                      dir="auto"
                                      className="min-w-0 truncate text-[11.5px] text-subtle"
                                    >
                                      {other}
                                    </span>
                                  ) : locale !== "ar" ? (
                                    <span className="shrink-0 text-[11px] text-[var(--tone-warn)]">
                                      {t("noArabicName")}
                                    </span>
                                  ) : null}
                                </span>
                                <span className="mt-0.5 block truncate text-[11.5px] text-subtle">
                                  {nListings > 0
                                    ? t("rowAttributesListings", { attributes: nAttrs, listings: nListings })
                                    : t("rowAttributes", { attributes: nAttrs })}
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

        <div className={`min-w-0 flex-1 ${selected ? "flex" : "hidden lg:flex"}`}>
          {selectedInfo ? (
            <div className="w-full">
              <AttributeEditor
                key={selectedInfo.id}
                category={selectedInfo}
                heading={selectedIsHeading}
                attributes={selectedAttrs}
              />
            </div>
          ) : (
            <div className="grid w-full place-items-center px-6">
              <p className="max-w-xs text-center text-[12.5px] text-subtle">
                {t("pickCategory")}
                <br />
                <span className="text-[11.5px]">{t("pickCategoryHint")}</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </FullBleed>
  );
}
