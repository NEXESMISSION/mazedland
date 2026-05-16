import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { PropertyCard } from "@/components/property/PropertyCard";
import type { AuctionWithProperty } from "@/lib/types";
import { Heart, Search } from "lucide-react";

/**
 * Watchlist — the user's saved auctions. The page renders the same
 * image-forward grid as the catalogue (so the visual language is
 * consistent), with a gold-framed empty state when nothing is saved.
 */
export default async function WatchlistPage() {
  const t = await getTranslations("watchlistPage");
  const locale = await getLocale();
  const isRTL = locale === "ar";

  let auctions: AuctionWithProperty[] = [];
  let loggedIn = false;
  try {
    const supabase = await getServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    loggedIn = !!user;
    if (user) {
      const { data: saves } = await supabase
        .from("watchlist")
        .select(`
          auction:auctions!inner (
            *,
            property:properties!inner (
              *,
              photos:property_photos (id, storage_path, sort_order, caption)
            )
          )
        `)
        .eq("user_id", user.id);
      auctions = ((saves ?? []) as unknown as Array<{ auction: AuctionWithProperty }>)
        .map((s) => s.auction)
        .filter(Boolean);
    }
  } catch {
    // env missing — render empty state
  }

  const savedIds = new Set(auctions.map((a) => a.id));

  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 py-6 lg:max-w-[var(--max-w-wide)]">
      <div className="flex items-end justify-between gap-3">
        <div>
          <span className="batta-eyebrow">Saved estates</span>
          <h1
            className={`mt-1.5 text-[26px] font-extrabold leading-tight tracking-tight ${
              isRTL ? "font-arabic" : ""
            }`}
          >
            {t("title")}
          </h1>
        </div>
        {auctions.length > 0 && (
          <span className="batta-pill-gold mb-1">{auctions.length}</span>
        )}
      </div>

      {auctions.length === 0 ? (
        <div className="batta-frame-gold relative mt-6 px-6 py-10 text-center">
          <div className="relative">
            <span className="batta-monogram mx-auto mb-4 inline-flex size-12 items-center justify-center text-[20px]">
              <Heart className="size-5" strokeWidth={2.2} />
            </span>
            <p className={`text-[20px] font-bold text-foreground ${isRTL ? "font-arabic" : ""}`}>
              {t("empty")}
            </p>
            <p className="mt-2 text-[12px] text-muted">{t("emptyBody")}</p>
            <Link
              href="/properties"
              className="batta-btn-luxe tap-target mt-6 inline-flex px-5 py-2.5 text-[12.5px]"
            >
              <Search className="size-4" strokeWidth={2.2} />
              {t("browseCta")}
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-3 pb-6 lg:grid-cols-4 lg:gap-5">
          {auctions.map((a, i) => (
            <PropertyCard
              key={a.id}
              auction={a}
              saved={savedIds.has(a.id)}
              loggedIn={loggedIn}
              priority={i < 4}
            />
          ))}
        </div>
      )}
    </div>
  );
}
