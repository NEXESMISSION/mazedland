import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { categoryLabel } from "@/lib/i18n";
import { governorateLabel } from "@/lib/tunisia";
import { shownDelegation } from "@/lib/delegations";
import { formatDate, formatNumber, formatTND } from "@/lib/utils";
import { asDealType } from "@/lib/listings/deal";
import { bestOf, comparable, parseCompareIds, pricePerSqm } from "@/lib/compare";
import { getSettings } from "@/lib/settings/server";
import { Ltr } from "@/components/ui/Ltr";
import { Home, Scale, Trophy } from "lucide-react";
import { CompareSync, RemoveFromCompare } from "./CompareControls";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("compare");
  return { title: t("title"), robots: { index: false } };
}

type Row = {
  id: string;
  title: string;
  price: number | string | null;
  price_on_request: boolean | null;
  negotiable: boolean | null;
  deal_type: string | null;
  governorate: string | null;
  delegation: string | null;
  attributes: Record<string, unknown> | null;
  deposit_amount: number | string | null;
  charges_amount: number | string | null;
  furnished: string | null;
  available_from: string | null;
  published_at: string | null;
  category: { id: string; label_fr: string; label_ar: string | null } | { id: string; label_fr: string; label_ar: string | null }[] | null;
  photos: { storage_path: string; sort_order: number }[] | null;
};

/**
 * Comparer (P3): two annonces side by side, or up to the console's
 * `compare_max` — price, price per m², surface, rooms, place, the rent terms,
 * then every detail either seller filled. The best on each of the first four
 * lines is marked. The ids live in the address, so a comparison can be sent
 * to someone. Switched off in the console, the page is not there.
 */
export default async function ComparePage({ searchParams }: { searchParams: Promise<{ ids?: string | string[] }> }) {
  const settings = await getSettings();
  if (!settings.feature_compare) notFound();
  const sp = await searchParams;
  const locale = await getLocale();
  const t = await getTranslations("compare");
  const tRoot = await getTranslations();
  const ids = parseCompareIds(sp.ids, settings.compare_max);
  const admin = getServiceSupabase();

  let rows: Row[] = [];
  if (admin && ids.length) {
    const { data } = await admin
      .from("listings")
      .select(
        `id, title, price, price_on_request, negotiable, deal_type, governorate, delegation, attributes,
         deposit_amount, charges_amount, furnished, available_from, published_at,
         category:categories!listings_category_id_fkey (id, label_fr, label_ar),
         photos:listing_photos (storage_path, sort_order)`,
      )
      .in("id", ids)
      .eq("status", "published");
    // In the order they were picked.
    rows = ((data ?? []) as unknown as Row[]).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  }

  if (rows.length < 2) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-gold-faint text-gold ring-1 ring-gold-soft">
          <Scale className="size-6" />
        </span>
        <h1 className="mt-4 text-[22px] font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{t("needTwo")}</p>
        <Link href="/annonces" className="mazed-btn-luxe tap-target mt-6 inline-flex h-11 items-center px-6 text-[13.5px]">
          {t("browse")}
        </Link>
        <CompareSync ids={rows.map((r) => r.id)} />
      </main>
    );
  }

  const items = rows.map(comparable);
  const best = bestOf(items);
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

  // Every detail a seller filled, under the label the site uses for it.
  const categoryIds = [...new Set(rows.map((r) => one(r.category)?.id).filter(Boolean))] as string[];
  const { data: defRows } = admin && categoryIds.length
    ? await admin.from("category_attributes").select("field_key, label, unit, options, sort_order").in("category_id", categoryIds).order("sort_order")
    : { data: [] };
  const defs = new Map<string, { label: string; unit: string | null; options: { value: string; label: string }[] | null }>();
  for (const d of (defRows ?? []) as { field_key: string; label: string; unit: string | null; options: { value: string; label: string }[] | null }[]) {
    if (!defs.has(d.field_key)) defs.set(d.field_key, d);
  }
  const SHOWN_ABOVE = new Set(["area_sqm", "rooms"]);
  const extraKeys = [...defs.keys()].filter((k) => !SHOWN_ABOVE.has(k) && rows.some((r) => {
    const v = (r.attributes ?? {})[k];
    return v != null && v !== "" && v !== false;
  }));
  const attrValue = (r: Row, key: string): string => {
    const raw = (r.attributes ?? {})[key];
    if (raw == null || raw === "" || raw === false) return "—";
    if (raw === true) return tRoot("listing.yes");
    const d = defs.get(key);
    const unit = d?.unit === "m²" ? tRoot("common.sqm") : d?.unit;
    const opt = d?.options?.find((o) => o.value === String(raw))?.label;
    if (opt) return opt;
    const n = /^\d+(\.\d+)?$/.test(String(raw)) ? formatNumber(Number(raw), locale) : String(raw);
    return unit ? `${n} ${unit}` : n;
  };
  const labelOf = (key: string) => (tRoot.has(`attributes.${key}`) ? tRoot(`attributes.${key}`) : defs.get(key)?.label ?? key);

  const money = (v: number) => `${formatTND(v, locale)} ${tRoot("common.tnd")}`;
  const anyRent = rows.some((r) => asDealType(r.deal_type) === "rent");

  type Line = { label: string; cells: React.ReactNode[]; bestId?: string | null };
  const lines: Line[] = [
    {
      label: t("price"),
      bestId: best.price,
      cells: rows.map((r, i) =>
        items[i].price == null ? t("onRequest") : `${money(items[i].price!)}${asDealType(r.deal_type) === "rent" ? ` ${t("perMonth")}` : ""}${r.negotiable ? ` · ${t("negotiable")}` : ""}`,
      ),
    },
    {
      label: t("perSqm"),
      bestId: best.perSqm,
      // A rent's per-m² is per month: « 15 TND/m²/mois », so it is not read as
      // a sale price per m².
      cells: items.map((c) => {
        const v = pricePerSqm(c);
        return v == null ? "—" : t(c.deal === "rent" ? "perSqmRent" : "perSqmSale", { amount: formatTND(v, locale) });
      }),
    },
    { label: t("area"), bestId: best.area, cells: items.map((c) => (c.area != null ? `${formatNumber(c.area, locale)} ${tRoot("common.sqm")}` : "—")) },
    { label: t("rooms"), bestId: best.rooms, cells: items.map((c) => (c.rooms != null ? <Ltr key={c.id}>S+{c.rooms}</Ltr> : "—")) },
    { label: t("place"), cells: rows.map((r) => [shownDelegation(r.governorate, r.delegation, locale), governorateLabel(r.governorate, locale)].filter(Boolean).join(", ") || "—") },
    { label: t("category"), cells: rows.map((r) => (one(r.category) ? categoryLabel(one(r.category)!, locale) : "—")) },
    { label: t("deal"), cells: rows.map((r) => t(asDealType(r.deal_type) === "rent" ? "rent" : "sale")) },
    ...(anyRent
      ? [
          { label: t("deposit"), cells: rows.map((r) => (r.deposit_amount != null ? money(Number(r.deposit_amount)) : "—")) },
          { label: t("charges"), cells: rows.map((r) => (r.charges_amount != null ? money(Number(r.charges_amount)) : "—")) },
          { label: t("furnished"), cells: rows.map((r) => (r.furnished ? tRoot(`publish.furnished.${r.furnished}`) : "—")) },
          { label: t("available"), cells: rows.map((r) => (r.available_from ? formatDate(r.available_from, locale, "medium") : "—")) },
        ]
      : []),
    ...extraKeys.map((k) => ({ label: labelOf(k), cells: rows.map((r) => attrValue(r, k)) })),
    { label: t("published"), cells: rows.map((r) => (r.published_at ? formatDate(r.published_at, locale, "medium") : "—")) },
  ].filter((line) => line.cells.some((c) => c !== "—")); // a line nobody filled (rooms on land) says nothing

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 lg:py-10">
      <CompareSync ids={rows.map((r) => r.id)} />
      <h1 className="text-[24px] font-extrabold tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-[13px] text-muted">{t("subtitle")}</p>

      <div className="-mx-4 mt-5 overflow-x-auto px-4 pb-2">
        <table className="w-full min-w-[560px] table-fixed border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th className="sticky start-0 z-10 w-32 bg-background" />
              {rows.map((r) => {
                const photo = (r.photos ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)[0]?.storage_path;
                return (
                  <th key={r.id} className="min-w-[170px] p-2 text-start align-top font-normal">
                    <Link href={`/annonces/${r.id}` as never} className="block overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-border">
                      <span className="block aspect-[4/3]">
                        {photo ? (
                          // eslint-disable-next-line @next/next/no-img-element -- a compact thumbnail
                          <img src={propertyPhotoUrl(photo, { transform: { width: 400, quality: 70 } })} alt="" className="size-full object-cover" />
                        ) : (
                          <span className="grid size-full place-items-center"><Home className="size-6 text-muted" /></span>
                        )}
                      </span>
                    </Link>
                    <Link href={`/annonces/${r.id}` as never} className="mt-2 line-clamp-2 text-[13px] font-bold leading-snug text-foreground hover:underline" dir="auto">
                      {r.title}
                    </Link>
                    <RemoveFromCompare id={r.id} ids={rows.map((x) => x.id)} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.label}>
                <th scope="row" className="sticky start-0 z-10 border-t border-border bg-background py-2.5 pe-3 text-start align-top text-[12px] font-bold text-muted">
                  {line.label}
                </th>
                {line.cells.map((cell, i) => {
                  const win = line.bestId === rows[i].id;
                  return (
                    <td key={rows[i].id} className={`border-t border-border px-2 py-2.5 align-top ${win ? "font-extrabold text-foreground" : "text-foreground"}`}>
                      <span className="inline-flex items-start gap-1">
                        {win && <Trophy className="mt-0.5 size-3.5 shrink-0 text-gold" aria-label={t("best")} />}
                        <span className="mazed-tabular">{cell}</span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11.5px] text-muted">{t("bestNote")}</p>
    </main>
  );
}
