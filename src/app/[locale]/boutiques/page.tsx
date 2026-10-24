import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { governorateLabel } from "@/lib/tunisia";
import { BadgeCheck, Store } from "lucide-react";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shops");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

/** Les boutiques (0173): the open shops, verified ones first, each with its count of annonces online. */
export default async function ShopsPage() {
  const locale = await getLocale();
  const t = await getTranslations("shops");
  const tKinds = await getTranslations("pro.kinds");
  const admin = getServiceSupabase();
  if (!admin) return <p className="p-6 text-[13px] text-muted">{t("unavailable")}</p>;

  const { data } = await admin
    .from("shops")
    .select("id, slug, name, kind, logo_path, governorate, city, verified_at")
    .eq("status", "approved")
    .order("verified_at", { ascending: false, nullsFirst: false })
    .order("name");
  const shops = (data ?? []) as { id: string; slug: string; name: string; kind: string; logo_path: string | null; governorate: string; city: string | null; verified_at: string | null }[];

  const counts = new Map<string, number>();
  if (shops.length) {
    const { data: rows } = await admin.from("listings").select("shop_id").eq("status", "published").in("shop_id", shops.map((s) => s.id));
    for (const r of (rows ?? []) as { shop_id: string }[]) counts.set(r.shop_id, (counts.get(r.shop_id) ?? 0) + 1);
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-tight lg:text-[30px]">{t("title")}</h1>
          <p className="mt-1 text-[13px] text-muted">{t("subtitle")}</p>
        </div>
        <Link href="/pro" className="text-[12.5px] font-bold text-gold hover:underline">{t("openYours")}</Link>
      </div>

      {shops.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed border-border p-10 text-center text-[13px] text-muted">{t("empty")}</p>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shops.map((s) => (
            <li key={s.id}>
              <Link
                href={`/boutiques/${s.slug}` as never}
                className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 transition hover:border-gold-soft"
              >
                <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-2 ring-1 ring-border">
                  {s.logo_path ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a small logo
                    <img src={propertyPhotoUrl(s.logo_path, { transform: { width: 120, quality: 70 } })} alt="" className="size-full object-cover" />
                  ) : (
                    <Store className="size-6 text-muted" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 truncate text-[14.5px] font-extrabold text-foreground" dir="auto">
                    {s.name}
                    {s.verified_at && <BadgeCheck className="size-4 shrink-0 text-gold" aria-label={t("verified")} />}
                  </span>
                  <span className="block truncate text-[12px] text-muted">
                    {tKinds(s.kind)} · {s.city ? `${s.city}, ` : ""}{governorateLabel(s.governorate, locale)}
                  </span>
                  <span className="block text-[12px] font-bold text-gold">{t("listingsCount", { count: counts.get(s.id) ?? 0 })}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
