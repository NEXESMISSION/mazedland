import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PropertyCard } from "@/components/property/PropertyCard";
import { getServerSupabase } from "@/lib/supabase/server";
import type { AuctionWithProperty } from "@/lib/types";
import {
  buildIlikeOrClause,
  normalizeSearchQuery,
  PROPERTY_SEARCH_FIELDS,
} from "@/lib/search";
import { Search, SlidersHorizontal } from "lucide-react";

const GOVERNORATES = [
  "Tunis", "Ariana", "Ben Arous", "Manouba",
  "Sousse", "Monastir", "Mahdia", "Nabeul",
  "Sfax", "Bizerte", "Gabès", "Médenine",
];

const TYPES = ["apartment", "house", "villa", "land", "commercial", "office"] as const;

/**
 * Catalogue index — sticky search head, then an editorial title row,
 * then a 2-up (mobile) / 4-up (desktop) grid of estate cards. All
 * surfaces use the auto-style black + gold tokens.
 */
export default async function PropertiesIndex({
  searchParams,
}: {
  searchParams: Promise<{ gov?: string; type?: string; q?: string }>;
}) {
  const t = await getTranslations();
  const locale = await getLocale();
  const isRTL = locale === "ar";
  const sp = await searchParams;
  const cleanedQ = normalizeSearchQuery(sp.q);

  let auctions: AuctionWithProperty[] = [];
  let savedAuctionIds = new Set<string>();
  let loggedIn = false;
  try {
    const supabase = await getServerSupabase();
    let query = supabase
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
      .order("ends_at", { ascending: true })
      .limit(48);

    if (sp.gov) query = query.eq("property.governorate", sp.gov);
    if (sp.type) query = query.eq("property.type", sp.type);
    if (cleanedQ) {
      // Search title + description + every location field. PostgREST
      // `.or()` against a nested table needs `foreignTable` so the
      // ilike binds to the joined `properties` row, not `auctions`.
      query = query.or(
        buildIlikeOrClause(cleanedQ, PROPERTY_SEARCH_FIELDS),
        { foreignTable: "property" },
      );
    }

    const [auctionsRes, userRes] = await Promise.all([query, supabase.auth.getUser()]);
    if (auctionsRes.error) console.error("[/properties] supabase error", auctionsRes.error);
    auctions = (auctionsRes.data ?? []) as unknown as AuctionWithProperty[];
    loggedIn = !!userRes.data.user;

    if (loggedIn && auctions.length > 0) {
      const ids = auctions.map((a) => a.id);
      const { data: saves } = await supabase
        .from("watchlist")
        .select("auction_id")
        .eq("user_id", userRes.data.user!.id)
        .in("auction_id", ids);
      savedAuctionIds = new Set((saves ?? []).map((s) => s.auction_id as string));
    }
  } catch (err) {
    console.warn("[/properties] supabase unavailable:", err instanceof Error ? err.message : err);
  }

  const activeType = sp.type ?? "";
  const activeGov = sp.gov ?? "";

  return (
    <div className="mx-auto max-w-[var(--max-w)] lg:max-w-[var(--max-w-wide)]">
      {/* Sticky search head — pure dark surface flush with the top bar. */}
      <div className="sticky top-[calc(var(--batta-topbar-h)+var(--batta-safe-top))] z-30 bg-background/95 backdrop-blur-md">
        <form className="px-4 pt-3" action="" method="get">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted ltr:left-3.5 rtl:right-3.5" strokeWidth={2} />
              <input
                name="q"
                defaultValue={sp.q ?? ""}
                placeholder={t("common.search")}
                className="w-full rounded-full border border-border bg-surface py-2.5 text-[13px] text-foreground placeholder:text-muted focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40 ltr:pl-9 ltr:pr-3 rtl:pl-3 rtl:pr-9"
              />
            </div>
            <select
              name="gov"
              defaultValue={activeGov}
              className="tap-target rounded-full border border-border bg-surface px-3 text-[12.5px] font-medium text-foreground focus:border-gold focus:outline-none"
              aria-label="Governorate"
            >
              <option value="">{t("common.all")}</option>
              {GOVERNORATES.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <button
              type="submit"
              className="batta-gold-fill tap-target inline-flex size-10 items-center justify-center rounded-full shadow-[var(--shadow-gold)] ring-1 ring-black/10"
              aria-label={t("common.filter")}
            >
              <SlidersHorizontal className="size-4" strokeWidth={2.2} />
            </button>
          </div>

          {/* Type chip rail */}
          <div className="snap-rail hide-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-3">
            <TypeChip
              label={t("common.all")}
              href={buildHref({ ...sp, type: undefined })}
              active={!activeType}
            />
            {TYPES.map((tp) => (
              <TypeChip
                key={tp}
                label={t(`property.types.${tp}`)}
                href={buildHref({ ...sp, type: tp })}
                active={activeType === tp}
              />
            ))}
          </div>
        </form>
        <div aria-hidden className="batta-gold-rule" />
      </div>

      {/* Editorial page title */}
      <div className="px-4 pt-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <span className="batta-eyebrow">The catalogue</span>
            <h1
              className={`mt-1.5 text-[26px] font-extrabold leading-tight tracking-tight ${
                isRTL ? "font-arabic" : ""
              }`}
            >
              {t("nav.properties")}
            </h1>
          </div>
          <span className="batta-pill-gold mb-1">
            {auctions.length} · {t("auction.live")}
          </span>
        </div>

        <div className="mt-5">
          {auctions.length === 0 ? (
            cleanedQ ? <NoSearchResults q={cleanedQ} /> : <EmptyState />
          ) : (
            <div className="grid grid-cols-2 gap-3 pb-6 lg:grid-cols-4 lg:gap-5">
              {auctions.map((a, i) => (
                <PropertyCard
                  key={a.id}
                  auction={a}
                  saved={savedAuctionIds.has(a.id)}
                  loggedIn={loggedIn}
                  priority={i < 4}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function buildHref(sp: { q?: string; gov?: string; type?: string }) {
  const params = new URLSearchParams();
  if (sp.q) params.set("q", sp.q);
  if (sp.gov) params.set("gov", sp.gov);
  if (sp.type) params.set("type", sp.type);
  const qs = params.toString();
  return (qs ? `/properties?${qs}` : "/properties") as "/properties";
}

function TypeChip({
  label,
  href,
  active,
}: {
  label: string;
  href: "/properties";
  active: boolean;
}) {
  // Same rationale as the auctions page TypeChip — fixed height,
  // symmetric padding, solid navy active state. The previous
  // `tap-target` forced 44px minimum width which uneven-spaced
  // short labels.
  return (
    <Link
      href={href}
      className={`inline-flex h-9 shrink-0 snap-start items-center justify-center whitespace-nowrap rounded-full border px-4 text-[12.5px] font-semibold transition-colors ${
        active
          ? "border-[var(--gold)] bg-[var(--gold)] text-white"
          : "border-[var(--border)] bg-white text-[var(--foreground-muted)] hover:border-[var(--gold-soft)] hover:text-[var(--gold)]"
      }`}
    >
      {label}
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="batta-frame-gold relative px-6 py-10 text-center">
      <div className="relative">
        <span className="batta-monogram batta-monogram-filled mx-auto mb-4 size-12 text-[20px]">
          ✦
        </span>
        <p className="text-[20px] font-bold text-foreground">
          The catalogue is closed
        </p>
        <p className="mt-2 text-[12px] text-muted">
          Consignments are being prepared. Check back shortly.
        </p>
        <Link
          href="/sell"
          className="batta-btn-luxe tap-target mt-6 px-5 py-2.5 text-[12.5px]"
        >
          List your estate
        </Link>
      </div>
    </div>
  );
}

// Separate state from the true empty-catalogue case — a buyer who
// typed a search should be told their *query* came up empty (and
// offered a one-tap reset), not that the marketplace is shut.
function NoSearchResults({ q }: { q: string }) {
  return (
    <div className="batta-frame relative px-6 py-10 text-center">
      <div className="relative">
        <span className="batta-monogram mx-auto mb-4 size-12 text-[20px]">
          <Search className="size-5" strokeWidth={1.8} />
        </span>
        <p className="text-[18px] font-bold text-foreground">
          No matches for &ldquo;{q}&rdquo;
        </p>
        <p className="mt-2 text-[12px] text-muted">
          Try a different keyword, governorate, or property type.
        </p>
        <Link
          href="/properties"
          className="batta-btn-ghost-gold tap-target mt-6 px-5 py-2.5 text-[12.5px]"
        >
          Clear search
        </Link>
      </div>
    </div>
  );
}
