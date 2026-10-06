/* eslint-disable react-hooks/purity -- Server Component.
 * The react-hooks v7 purity rule governs the CLIENT render path: it forbids
 * impure reads (Date.now(), Math.random()) during a render React may replay.
 * This module is an async Server Component — it runs once, per request, on the
 * server, and reading the clock is the correct way to answer "what is overdue"
 * or "which badge has lapsed". There is no render to replay. */
import { getTranslations } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { HomeControlClient, type HomeRow } from "./HomeControlClient";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Search } from "lucide-react";
import { SiteTabs } from "@/components/admin/kit/SiteTabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Raw = {
  id: string;
  title: string;
  governorate: string;
  promo_home_featured: boolean;
  promo_top_listed: boolean;
  promo_banner: boolean;
  promo_expires_at: string | null;
  promo_manual: boolean;
  photos: { storage_path: string; sort_order: number }[];
};

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q: qParam } = await searchParams;
  const q = (qParam ?? "").trim().slice(0, 60).replace(/[,()*%]/g, " ").trim();
  const supabase = await getServerSupabase();
  // `properties` / `property_photos` / `status = 'ready'` until migration 0153
  // dropped all three with the auction product. The promo columns moved to
  // `listings` in 0156; `published` is the classifieds equivalent of `ready`.
  let pq = supabase
    .from("listings")
    .select(`
      id, title, governorate,
      promo_home_featured, promo_top_listed, promo_banner, promo_expires_at, promo_manual,
      photos:listing_photos ( storage_path, sort_order )
    `)
    .eq("status", "published");
  if (q) pq = pq.or(`title.ilike.%${q}%,governorate.ilike.%${q}%`);
  const { data } = await pq.order("created_at", { ascending: false }).limit(150);

  const now = Date.now();
  const rows: HomeRow[] = ((data ?? []) as unknown as Raw[]).map((p) => {
    const cover = (p.photos ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)[0];
    const expired = p.promo_expires_at ? new Date(p.promo_expires_at).getTime() < now : false;
    const anyOn = (p.promo_home_featured || p.promo_top_listed || p.promo_banner) && !expired;
    return {
      id: p.id,
      title: p.title,
      governorate: p.governorate,
      home: p.promo_home_featured && !expired,
      top: p.promo_top_listed && !expired,
      banner: p.promo_banner && !expired,
      expiresAt: p.promo_expires_at,
      expired,
      manual: p.promo_manual,
      featured: anyOn,
      coverUrl: cover ? propertyPhotoUrl(cover.storage_path) : null,
    };
  });

  // Featured first, then the rest.
  rows.sort((a, b) => Number(b.featured) - Number(a.featured));
  const activeCount = rows.filter((r) => r.featured).length;
  const t = await getTranslations("adminHome");

  return (
    <div>
      <SiteTabs />
      <AdminPageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          activeCount > 0 ? (
            <span className="shrink-0 rounded-full bg-gold-faint px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-gold-bright">
              {t("featuredCount", { count: activeCount })}
            </span>
          ) : undefined
        }
      />

      {/* Server search — find any published listing by title or governorate
          (the list is capped at 150, so search is the way to reach the rest). */}
      <form method="get" role="search" className="mt-4 flex items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" strokeWidth={2} />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={t("searchPlaceholder")}
            className="h-9 w-full rounded-lg border border-border bg-surface ps-8 pe-3 text-[12px] text-foreground placeholder:text-muted focus:border-gold focus:outline-none"
          />
        </div>
        {q && (
          <span className="mazed-tabular text-[12px] text-muted">
            {t("results", { count: rows.length })}
          </span>
        )}
      </form>

      <HomeControlClient rows={rows} />
    </div>
  );
}
