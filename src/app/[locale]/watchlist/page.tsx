import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { PropertyCard } from "@/components/property/PropertyCard";
import type { AuctionWithProperty } from "@/lib/types";
import { Heart, Search, Sparkles, ArrowRight, Bell } from "lucide-react";

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
  let suggested: AuctionWithProperty[] = [];
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
    // Empty state needs something to do — pull 4 live listings as
    // suggestions so the page feels alive instead of dead-ended.
    if (auctions.length === 0) {
      const { data: trending } = await supabase
        .from("auctions")
        .select(`
          *,
          property:properties!inner (
            *,
            photos:property_photos (id, storage_path, sort_order, caption)
          )
        `)
        .in("status", ["scheduled", "live", "extending"])
        .eq("property.status", "ready")
        .order("current_price", { ascending: false })
        .limit(4);
      suggested = (trending ?? []) as unknown as AuctionWithProperty[];
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
        <>
          {/* Hero empty state — gradient backdrop with a glowing heart
              icon, two CTAs, and a row of trending listings as a soft
              landing instead of a dead-end. */}
          <section className="relative mt-6 overflow-hidden rounded-3xl bg-gradient-to-br from-[var(--gold)] via-[var(--gold-bright)] to-[var(--gold-deep)] px-6 py-12 text-center shadow-[var(--shadow-gold)] sm:px-10 sm:py-16">
            {/* Decorative bubbles for depth */}
            <div
              aria-hidden
              className="pointer-events-none absolute -top-16 -right-12 size-56 rounded-full bg-white/15 blur-3xl"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-20 -left-16 size-72 rounded-full bg-white/10 blur-3xl"
            />
            <div className="relative">
              <div className="mx-auto inline-flex size-16 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/30 backdrop-blur-sm">
                <Heart className="size-8 text-white" strokeWidth={2} fill="currentColor" />
              </div>
              <h2
                className={`mt-5 text-[24px] font-extrabold leading-tight tracking-tight text-white sm:text-[28px] ${
                  isRTL ? "font-arabic" : ""
                }`}
              >
                {t("empty")}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-white/85">
                {t("emptyBody")}
              </p>
              <div className="mt-7 flex flex-col items-center justify-center gap-2 sm:flex-row">
                <Link
                  href="/properties"
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-white px-6 text-[13px] font-bold text-[var(--gold-deep)] shadow-md hover:bg-white/95 active:scale-[0.98] transition-all"
                >
                  <Search className="size-4" strokeWidth={2.5} />
                  {t("browseCta")}
                </Link>
                <Link
                  href={{ pathname: "/properties", query: { filter: "auction" } }}
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-white/40 bg-white/10 px-6 text-[13px] font-bold text-white backdrop-blur-sm hover:bg-white/20"
                >
                  <Sparkles className="size-4" strokeWidth={2.5} />
                  En direct
                </Link>
              </div>
              <p className="mt-5 inline-flex items-center gap-1.5 text-[11px] font-medium text-white/75">
                <Bell className="size-3" strokeWidth={2.2} />
                Vous serez notifié(e) sur chaque enregistrement.
              </p>
            </div>
          </section>

          {/* Trending row — gentle "while you're here, look at these" prompt. */}
          {suggested.length > 0 && (
            <section className="mt-6">
              <div className="mb-3 flex items-end justify-between">
                <div>
                  <span className="batta-eyebrow">À découvrir</span>
                  <h3 className="mt-1 text-[16px] font-bold text-foreground">
                    Tendances aujourd&apos;hui
                  </h3>
                </div>
                <Link
                  href="/properties"
                  className="inline-flex items-center gap-1 text-[12px] font-bold text-[var(--gold)] hover:text-[var(--gold-bright)]"
                >
                  Tout voir <ArrowRight className="size-3.5" strokeWidth={2.5} />
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-3 pb-6 lg:grid-cols-4 lg:gap-5">
                {suggested.map((a, i) => (
                  <PropertyCard
                    key={a.id}
                    auction={a}
                    saved={false}
                    loggedIn={loggedIn}
                    priority={i < 2}
                  />
                ))}
              </div>
            </section>
          )}
        </>
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
