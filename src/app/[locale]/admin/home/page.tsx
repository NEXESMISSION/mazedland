import { getServerSupabase } from "@/lib/supabase/server";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { HomeControlClient, type HomeRow } from "./HomeControlClient";

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

export default async function AdminHomePage() {
  const supabase = await getServerSupabase();
  const { data } = await supabase
    .from("properties")
    .select(`
      id, title, governorate,
      promo_home_featured, promo_top_listed, promo_banner, promo_expires_at, promo_manual,
      photos:property_photos ( storage_path, sort_order )
    `)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(150);

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

  return (
    <div>
      <span className="batta-eyebrow">Vitrine d&apos;accueil</span>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <h2 className="text-[22px] font-extrabold leading-tight tracking-tight">Accueil</h2>
        {activeCount > 0 && (
          <span className="shrink-0 rounded-full bg-gold-faint px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-gold-bright">
            {activeCount} en vedette
          </span>
        )}
      </div>
      <p className="mt-1 text-[12px] text-muted">
        Contrôlez les annonces mises en avant (accueil, top recherche,
        bannière). « Payé » = via une option achetée, « Manuel » = ajouté ici.
        Vous pouvez mettre n&apos;importe quelle annonce publiée en vedette.
      </p>

      <HomeControlClient rows={rows} />
    </div>
  );
}
