import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { governorateLabel } from "@/lib/tunisia";
import { delegationLabel } from "@/lib/delegations";
import { absoluteUrl } from "@/lib/siteUrl";
import { AnnonceCard, type AnnonceCardRow } from "@/components/listing/AnnonceCard";
import { Ltr } from "@/components/ui/Ltr";
import { formatTND } from "@/lib/utils";
import { publishedProjects } from "@/lib/pro/projectsServer";
import { deliveryParts, priceFrom, unitCounts } from "@/lib/pro/projects";
import { getSettings } from "@/lib/settings/server";
import { pageNumber } from "@/lib/paging";
import { BadgeCheck, Building2, ChevronLeft, ChevronRight, Clock, Globe, Mail, MapPin, Phone, Store } from "lucide-react";
import { listingDescription } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Shop = {
  id: string; slug: string; name: string; kind: string; description: string | null; logo_path: string | null; cover_path: string | null;
  governorate: string; city: string | null; phone: string | null; email: string | null; website: string | null; hours: string | null;
  verified_at: string | null;
};

async function loadShop(slug: string): Promise<Shop | null> {
  const admin = getServiceSupabase();
  if (!admin || !/^[a-z0-9-]{3,60}$/.test(slug)) return null;
  const { data } = await admin
    .from("shops")
    .select("id, slug, name, kind, description, logo_path, cover_path, governorate, city, phone, email, website, hours, verified_at")
    .eq("slug", slug)
    .eq("status", "approved")
    .maybeSingle();
  return (data as Shop | null) ?? null;
}

export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> }): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const shop = await loadShop(slug);
  if (!shop) return {};
  const t = await getTranslations("shops");
  const tKinds = await getTranslations("pro.kinds");
  const locale = await getLocale();
  // « pro immo » alone said nothing in a result: what it is and where.
  const where = shop.governorate ? governorateLabel(shop.governorate, locale) : null;
  // Page 2 and beyond are addresses of their own, as in the catalogue — and a
  // page past the last one is not: it shows page 1 and must not be indexed as
  // a page of its own (the QA tour found ?page=9999 with a canonical).
  const page = pageNumber(sp.page);
  let beyond = false;
  if (page > 1) {
    const admin = getServiceSupabase();
    const { count } = admin
      ? await admin.from("listings").select("id", { count: "exact", head: true }).eq("shop_id", shop.id).eq("status", "published")
      : { count: null };
    const pageSize = (await getSettings()).catalogue_page_size;
    beyond = page > Math.max(1, Math.ceil((count ?? 0) / pageSize));
  }
  const path = `/agences/${shop.slug}${page > 1 && !beyond ? `?page=${page}` : ""}`;
  return {
    title: `${shop.name} — ${tKinds(shop.kind)}${where ? ` · ${where}` : ""} · Mazed Immo`,
    description: listingDescription(shop.description, t("shopMetaDescription", { name: shop.name })),
    ...(beyond ? { robots: { index: false, follow: true } } : {}),
    // With the locale: « /agences/x » redirects, and a canonical must not.
    alternates: {
      canonical: `/${locale}${path}`,
      languages: { fr: `/fr${path}`, ar: `/ar${path}`, "x-default": `/fr${path}` },
    },
    // Shared into WhatsApp or Messenger, the link showed no name and no
    // picture: `openGraph` replaces the layout's block, so the name and the
    // description have to be restated here, with the cover (or the logo).
    openGraph: {
      title: `${shop.name} — ${tKinds(shop.kind)}${where ? ` · ${where}` : ""}`,
      description: listingDescription(shop.description, t("shopMetaDescription", { name: shop.name })),
      type: "website",
      siteName: "Mazed Immo",
      locale: locale === "ar" ? "ar_TN" : "fr_TN",
      url: `/${locale}/agences/${shop.slug}`,
      ...(shop.cover_path || shop.logo_path
        ? { images: [{ url: propertyPhotoUrl((shop.cover_path || shop.logo_path) as string), alt: shop.name }] }
        : {}),
    },
  };
}

const LISTING_SELECT = `
  id, title, price, price_on_request, negotiable, governorate, delegation,
  reference, attributes, deal_type, availability,
  category:categories!listings_category_id_fkey ( label_fr, label_ar ),
  photos:listing_photos ( storage_path, sort_order )
`;

/**
 * A shop's page (0173): who they are, how to reach them, and their annonces —
 * the same rows as the marketplace, filtered by shop, for sale or for rent,
 * paged like the catalogue. Only an approved shop has a page; « vérifié »
 * shows only when an admin checked their papers.
 */
export default async function ShopPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ deal?: string; page?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const shop = await loadShop(slug);
  if (!shop) notFound();
  const locale = await getLocale();
  const t = await getTranslations("shops");
  const tKinds = await getTranslations("pro.kinds");
  // The pager's words are the catalogue's.
  const tc = await getTranslations("catalogue");
  const tRoot = await getTranslations();
  const settings = await getSettings();
  const admin = getServiceSupabase()!;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  const tp = await getTranslations("pro.projects");
  const tShopProjects = await getTranslations("shops.projects");
  // The promoter's projects (0179), when they may show (src/lib/pro/projectsServer.ts).
  const projects = await publishedProjects(admin, shop.id);
  const deliveryText = (v: string | null) => {
    const p = deliveryParts(v);
    return !p ? null : p.delivered ? tp("delivery.delivered") : tp("delivery.quarter", { q: String(p.q), year: String(p.year) });
  };

  const deal = sp.deal === "sale" || sp.deal === "rent" ? sp.deal : null;
  // Paged on the catalogue's page size. This was a `.limit(60)` with no pager:
  // an agence on the Business plan has 120 annonces online, and its page
  // showed the first sixty with nothing to say the rest existed, while the
  // directory counted them all. The id is the unique last key — a batch
  // approved together shares its published_at, and without it an annonce
  // could sit on two pages, or on none.
  const pageSize = settings.catalogue_page_size;
  let page = pageNumber(sp.page);
  let q = admin.from("listings").select(LISTING_SELECT, { count: "exact" }).eq("shop_id", shop.id).eq("status", "published");
  if (deal) q = q.eq("deal_type", deal);
  q = q.order("published_at", { ascending: false }).order("id", { ascending: true });
  const from = (page - 1) * pageSize;
  let res = await q.range(from, from + pageSize - 1);
  // A page past the end — a stale link, annonces expired since — makes
  // PostgREST refuse the range: the first page, not an empty one.
  if (res.error && page > 1) {
    page = 1;
    res = await q.range(0, pageSize - 1);
  }
  const listings = (res.data ?? []) as unknown as AnnonceCardRow[];
  const total = res.count ?? listings.length;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  // The deal tab and the page in one address; changing the tab returns to page 1.
  const href = (d: "sale" | "rent" | null, p = 1) => {
    const s = new URLSearchParams();
    if (d) s.set("deal", d);
    if (p > 1) s.set("page", String(p));
    return `/agences/${shop.slug}${s.size ? `?${s}` : ""}`;
  };

  const place = `${shop.city ? `${delegationLabel(shop.city, locale)}, ` : ""}${governorateLabel(shop.governorate, locale)}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "RealEstateAgent",
    name: shop.name,
    url: absoluteUrl(`/${locale}/agences/${shop.slug}`),
    ...(shop.logo_path ? { logo: absoluteUrl(propertyPhotoUrl(shop.logo_path)) } : {}),
    ...(shop.phone ? { telephone: shop.phone } : {}),
    address: { "@type": "PostalAddress", addressRegion: shop.governorate, ...(shop.city ? { addressLocality: shop.city } : {}), addressCountry: "TN" },
  };

  return (
    <main className="mx-auto max-w-6xl pb-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <div className="relative aspect-[3/1] max-h-72 w-full overflow-hidden bg-surface-2 lg:rounded-b-3xl">
        {shop.cover_path && (
          // eslint-disable-next-line @next/next/no-img-element -- the shop's own banner
          <img src={propertyPhotoUrl(shop.cover_path, { transform: { width: 1600, quality: 75 } })} alt="" className="size-full object-cover" />
        )}
      </div>
      <div className="px-4 lg:px-8">
        <header className="-mt-10 flex flex-wrap items-end gap-4">
          <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-surface shadow-md ring-4 ring-[var(--background)]">
            {shop.logo_path ? (
              // eslint-disable-next-line @next/next/no-img-element -- the shop's logo
              <img src={propertyPhotoUrl(shop.logo_path, { transform: { width: 200, quality: 80 } })} alt={shop.name} className="size-full object-cover" />
            ) : (
              <Store className="size-8 text-muted" />
            )}
          </span>
          <div className="min-w-0 pb-1">
            <h1 className="flex items-center gap-2 text-[24px] font-extrabold tracking-tight lg:text-[30px]" dir="auto">
              {shop.name}
              {shop.verified_at && (
                <span className="inline-flex items-center gap-1 rounded-full bg-gold-faint px-2 py-0.5 text-[11.5px] font-bold text-foreground ring-1 ring-gold-soft">
                  <BadgeCheck className="size-3.5 text-gold" /> {t("verified")}
                </span>
              )}
            </h1>
            <p className="text-[13px] text-muted">{tKinds(shop.kind)} · {place}</p>
          </div>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="order-2 lg:order-1">
            {projects.length > 0 && (
              <section className="mb-7">
                <h2 className="text-[17px] font-extrabold tracking-tight text-foreground">{tShopProjects("title")}</h2>
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {projects.map((p) => {
                    const counts = unitCounts(p.units);
                    const from = priceFrom(p.units);
                    const due = deliveryText(p.delivery);
                    return (
                      <li key={p.id}>
                        <Link
                          href={`/agences/${shop.slug}/projets/${p.slug}` as never}
                          className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface transition hover:border-gold-soft"
                        >
                          <span className="relative grid aspect-[16/9] w-full place-items-center bg-surface-2">
                            {p.cover_path ? (
                              // eslint-disable-next-line @next/next/no-img-element -- the project's own cover
                              <img src={propertyPhotoUrl(p.cover_path, { transform: { width: 700, quality: 72 } })} alt="" className="size-full object-cover" />
                            ) : (
                              <Building2 className="size-8 text-muted" />
                            )}
                          </span>
                          <span className="flex flex-1 flex-col gap-0.5 p-3">
                            <span className="text-[15px] font-extrabold text-foreground" dir="auto">{p.name}</span>
                            <span className="text-[12px] text-muted">
                              {tp(`kinds.${p.kind}`)} · {p.delegation ? `${delegationLabel(p.delegation, locale)}, ` : ""}{governorateLabel(p.governorate, locale)}
                              {due ? ` · ${due}` : ""}
                            </span>
                            <span className="mt-1 text-[12.5px] font-bold text-foreground">
                              {tShopProjects("available", { count: counts.available })} <span className="font-normal text-muted">{tShopProjects("ofTotal", { total: counts.total })}</span>
                            </span>
                            {from !== null && <span className="text-[12.5px] font-bold text-gold">{tp("priceFrom", { price: `${formatTND(from, locale)} ${tRoot("common.tnd")}` })}</span>}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            <nav className="flex gap-1.5">
              {([null, "sale", "rent"] as const).map((d) => (
                <Link
                  key={d ?? "all"}
                  href={href(d) as never}
                  aria-current={deal === d ? "page" : undefined}
                  className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold ring-1 ${deal === d ? "bg-gold-faint text-foreground ring-gold-soft" : "text-muted ring-border"}`}
                >
                  {t(`deal.${d ?? "all"}`)}
                </Link>
              ))}
            </nav>
            {/* The same count the directory's card shows, so the two agree. */}
            <p className="mt-4 text-[12.5px] text-muted">{t("listingsCount", { count: total })}</p>
            {listings.length === 0 ? (
              <p className="mt-3 rounded-2xl border border-dashed border-border p-8 text-center text-[13px] text-muted">{t("noListings")}</p>
            ) : (
              <ul className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:gap-5">
                {listings.map((l) => (
                  <li key={l.id}>
                    <AnnonceCard listing={l} loggedIn={!!user} />
                  </li>
                ))}
              </ul>
            )}
            {lastPage > 1 && (
              <nav className="mt-6 flex items-center justify-center gap-2" aria-label={tc("pagination")}>
                {page > 1 ? (
                  <Link
                    href={href(deal, page - 1) as never}
                    className="tap-target inline-flex items-center gap-1 rounded-full bg-surface-2 px-4 py-2 text-[12.5px] font-bold text-foreground ring-1 ring-border transition hover:ring-foreground/30"
                  >
                    <ChevronLeft className="size-4 rtl:-scale-x-100" /> {tc("previous")}
                  </Link>
                ) : (
                  <span aria-hidden className="w-[108px]" />
                )}
                <span className="mazed-tabular px-2 text-[12.5px] font-semibold text-muted">
                  {page} / {lastPage}
                </span>
                {page < lastPage ? (
                  <Link
                    href={href(deal, page + 1) as never}
                    className="tap-target inline-flex items-center gap-1 rounded-full bg-surface-2 px-4 py-2 text-[12.5px] font-bold text-foreground ring-1 ring-border transition hover:ring-foreground/30"
                  >
                    {tc("next")} <ChevronRight className="size-4 rtl:-scale-x-100" />
                  </Link>
                ) : (
                  <span aria-hidden className="w-[108px]" />
                )}
              </nav>
            )}
          </div>

          <aside className="order-1 space-y-3 lg:order-2">
            {shop.description && (
              <p className="whitespace-pre-line rounded-2xl border border-border bg-surface p-4 text-[13px] leading-relaxed text-foreground" dir="auto">
                {shop.description}
              </p>
            )}
            <ul className="space-y-2 rounded-2xl border border-border bg-surface p-4 text-[13px]">
              <li className="flex items-center gap-2 text-foreground"><MapPin className="size-4 text-muted" /> {place}</li>
              {shop.phone && (
                <li className="flex items-center gap-2">
                  <Phone className="size-4 text-muted" />
                  <a href={`tel:${shop.phone}`} className="font-bold text-foreground hover:underline"><Ltr>{shop.phone}</Ltr></a>
                </li>
              )}
              {shop.email && (
                <li className="flex items-center gap-2"><Mail className="size-4 text-muted" /> <a href={`mailto:${shop.email}`} className="truncate text-foreground hover:underline" dir="ltr">{shop.email}</a></li>
              )}
              {shop.website && (
                <li className="flex items-center gap-2"><Globe className="size-4 text-muted" /> <a href={shop.website} target="_blank" rel="noreferrer nofollow" className="truncate text-foreground hover:underline" dir="ltr">{shop.website.replace(/^https?:\/\//, "")}</a></li>
              )}
              {shop.hours && <li className="flex items-center gap-2 text-foreground"><Clock className="size-4 text-muted" /> <span dir="auto">{shop.hours}</span></li>}
            </ul>
            <p className="px-1 text-[11px] leading-snug text-muted">{shop.verified_at ? t("verifiedMeans") : t("notVerifiedMeans")}</p>
          </aside>
        </div>
      </div>
    </main>
  );
}
