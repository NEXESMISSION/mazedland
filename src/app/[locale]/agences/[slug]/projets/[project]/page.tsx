import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { governorateLabel } from "@/lib/tunisia";
import { delegationLabel } from "@/lib/delegations";
import { absoluteUrl } from "@/lib/siteUrl";
import { listingDescription } from "@/lib/seo";
import { cn, formatNumber, formatTND } from "@/lib/utils";
import { Ltr } from "@/components/ui/Ltr";
import { publicProject, type PublicProject } from "@/lib/pro/projectsServer";
import { deliveryParts, priceFrom, unitCounts } from "@/lib/pro/projects";
import { ArrowLeft, BadgeCheck, MapPin, Phone, Store } from "lucide-react";

export const dynamic = "force-dynamic";

type Shop = { id: string; slug: string; name: string; logo_path: string | null; phone: string | null; verified_at: string | null };

async function load(slug: string, projectSlug: string): Promise<{ shop: Shop; project: PublicProject } | null> {
  const admin = getServiceSupabase();
  if (!admin || !/^[a-z0-9-]{3,60}$/.test(slug)) return null;
  const { data: shop } = await admin
    .from("shops")
    .select("id, slug, name, logo_path, phone, verified_at")
    .eq("slug", slug)
    .eq("status", "approved")
    .maybeSingle();
  if (!shop) return null;
  const project = await publicProject(admin, shop.id as string, projectSlug);
  return project ? { shop: shop as Shop, project } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; project: string }> }): Promise<Metadata> {
  const { slug, project: projectSlug } = await params;
  const found = await load(slug, projectSlug);
  if (!found) return {};
  const { shop, project } = found;
  const locale = await getLocale();
  const path = `/agences/${shop.slug}/projets/${project.slug}`;
  const title = `${project.name} · ${shop.name}`;
  const description = listingDescription(project.description, `${project.name} — ${shop.name}`);
  // The picture a shared link shows: the project's cover, else the agence's logo.
  const image = project.cover_path || shop.logo_path;
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}${path}`,
      languages: { fr: `/fr${path}`, ar: `/ar${path}`, "x-default": `/fr${path}` },
    },
    // `openGraph` replaces the layout's block whole, so a project link shared
    // into WhatsApp or Facebook showed no name and no text (the QA tour,
    // 2026-10-30): the name and the description are restated here, as on the
    // agence's page.
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "Mazed Immo",
      locale: locale === "ar" ? "ar_TN" : "fr_TN",
      url: `/${locale}${path}`,
      ...(image ? { images: [{ url: propertyPhotoUrl(image), alt: project.name }] } : {}),
    },
  };
}

const STATUS_TONE: Record<string, string> = {
  available: "mazed-tone-ok",
  reserved: "mazed-tone-warn",
  sold: "bg-surface-2 text-muted ring-1 ring-border",
};

/**
 * A promoter's project (0179): what it is, where, when it is delivered, and
 * its units with what is still available — under the agence that sells it.
 */
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; project: string }>;
  searchParams: Promise<{ f?: string }>;
}) {
  const { slug, project: projectSlug } = await params;
  const sp = await searchParams;
  const found = await load(slug, projectSlug);
  if (!found) notFound();
  const { shop, project } = found;
  const locale = await getLocale();
  const t = await getTranslations("shops.projects");
  const tp = await getTranslations("pro.projects");
  const tShops = await getTranslations("shops");
  const tRoot = await getTranslations();
  // A price and a surface read like everywhere else on the site: « 350 000
  // TND » / « 350 000 د.ت », « 120,5 m² » / « م² » — the table showed bare
  // numbers and a Latin « m² » on the Arabic page (the QA tour, 2026-10-30).
  const money = (v: number) => `${formatTND(v, locale)} ${tRoot("common.tnd")}`;
  const area = (v: number) => `${formatNumber(v, locale, { maxDecimals: 1 })} ${tRoot("common.sqm")}`;

  const counts = unitCounts(project.units);
  const from = priceFrom(project.units);
  const onlyAvailable = sp.f === "available";
  const units = onlyAvailable ? project.units.filter((u) => u.status === "available") : project.units;
  const due = deliveryParts(project.delivery);
  const dueText = !due ? null : due.delivered ? tp("delivery.delivered") : tp("delivery.quarter", { q: String(due.q), year: String(due.year) });
  const place = `${project.address ? `${project.address}, ` : ""}${project.delegation ? `${delegationLabel(project.delegation, locale)}, ` : ""}${governorateLabel(project.governorate, locale)}`;
  const base = `/agences/${shop.slug}/projets/${project.slug}`;
  const floorName = (n: number | null) => (n === null ? "—" : n === 0 ? tp("generator.ground") : String(n));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": project.kind === "residence" ? "ApartmentComplex" : "Place",
    name: project.name,
    url: absoluteUrl(`/${locale}${base}`),
    ...(project.cover_path ? { image: absoluteUrl(propertyPhotoUrl(project.cover_path)) } : {}),
    address: {
      "@type": "PostalAddress",
      addressRegion: project.governorate,
      ...(project.delegation ? { addressLocality: project.delegation } : {}),
      addressCountry: "TN",
    },
  };

  return (
    <main className="mx-auto max-w-6xl pb-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      {/* No cover, no empty band: the page opens on the name. */}
      {project.cover_path && (
        <div className="relative aspect-[3/1] max-h-80 w-full overflow-hidden bg-surface-2 lg:rounded-b-3xl">
          {/* eslint-disable-next-line @next/next/no-img-element -- the project's own cover */}
          <img src={propertyPhotoUrl(project.cover_path, { transform: { width: 1600, quality: 75 } })} alt="" className="size-full object-cover" />
        </div>
      )}
      <div className="px-4 lg:px-8">
        <Link href={`/agences/${shop.slug}` as never} className="mt-4 inline-flex items-center gap-1 text-[12.5px] font-bold text-muted hover:text-foreground">
          <ArrowLeft className="size-3.5 rtl:-scale-x-100" /> <span dir="auto">{shop.name}</span>
        </Link>
        <header className="mt-2">
          <h1 className="text-[26px] font-extrabold tracking-tight lg:text-[32px]" dir="auto">{project.name}</h1>
          <p className="mt-1 text-[13px] text-muted">
            {tp(`kinds.${project.kind}`)}
            {dueText ? ` · ${tp("delivery.label")} : ${dueText}` : ""}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-foreground"><MapPin className="size-4 text-muted" /> <span dir="auto">{place}</span></p>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
          {/* min-w-0: the units table scrolls inside its box, the page does not. */}
          <div className="order-2 min-w-0 space-y-5 lg:order-1">
            {project.description && (
              <p className="whitespace-pre-line text-[14px] leading-relaxed text-foreground" dir="auto">{project.description}</p>
            )}

            <section>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[17px] font-extrabold tracking-tight text-foreground">{t("unitsTitle")}</h2>
                <nav className="ms-auto flex gap-1.5">
                  {[
                    { key: "all", href: base, on: !onlyAvailable, text: t("filterAll") },
                    { key: "available", href: `${base}?f=available`, on: onlyAvailable, text: t("filterAvailable") },
                  ].map((f) => (
                    <Link
                      key={f.key}
                      href={f.href as never}
                      aria-current={f.on ? "page" : undefined}
                      className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold ring-1 ${f.on ? "bg-gold-faint text-foreground ring-gold-soft" : "text-muted ring-border"}`}
                    >
                      {f.text}
                    </Link>
                  ))}
                </nav>
              </div>
              {units.length === 0 ? (
                <p className="mt-3 rounded-2xl border border-dashed border-border p-6 text-center text-[13px] text-muted">{t("none")}</p>
              ) : (
                <div className="mt-3 overflow-x-auto rounded-2xl border border-border">
                  <table className="w-full min-w-[560px] text-[13px]">
                    <thead className="bg-surface-2 text-[11.5px] uppercase tracking-wide text-muted">
                      <tr>
                        <th className="px-3 py-2 text-start">{tp("units.ref")}</th>
                        <th className="px-3 py-2 text-start">{tp("units.kind")}</th>
                        <th className="px-3 py-2 text-start">{tp("units.floor")}</th>
                        <th className="px-3 py-2 text-start">{tp("units.rooms")}</th>
                        <th className="px-3 py-2 text-start">{tp("units.area")}</th>
                        <th className="px-3 py-2 text-start">{tp("units.price")}</th>
                        <th className="px-3 py-2 text-start">{tp("units.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {units.map((u) => (
                        <tr key={u.id} className={cn("border-t border-border", u.status === "sold" && "text-muted")}>
                          <td className="px-3 py-2 font-bold"><Ltr>{u.ref}</Ltr></td>
                          <td className="px-3 py-2">{tp(`unitKinds.${u.kind}`)}</td>
                          <td className="px-3 py-2">{floorName(u.floor)}</td>
                          <td className="px-3 py-2">{u.rooms ?? "—"}</td>
                          <td className="px-3 py-2">{u.area_sqm ? area(u.area_sqm) : "—"}</td>
                          <td className="px-3 py-2">{u.status === "sold" ? "—" : u.price ? money(u.price) : t("onRequest")}</td>
                          <td className="px-3 py-2">
                            <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-bold", STATUS_TONE[u.status])}>{tp(`unitStatus.${u.status}`)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <aside className="order-1 min-w-0 space-y-3 lg:order-2">
            <div className="rounded-2xl border border-border bg-surface p-4">
              <p className="text-[22px] font-extrabold text-foreground">
                {t("available", { count: counts.available })} <span className="text-[13px] font-normal text-muted">{t("ofTotal", { total: counts.total })}</span>
              </p>
              <p className="mt-1 text-[12.5px] text-muted">{tp("counts", counts)}</p>
              {from !== null && <p className="mt-2 text-[14px] font-extrabold text-gold">{tp("priceFrom", { price: money(from) })}</p>}
            </div>
            <div className="space-y-2 rounded-2xl border border-border bg-surface p-4">
              <p className="text-[13px] font-bold text-foreground">{t("contact")}</p>
              <Link href={`/agences/${shop.slug}` as never} className="flex items-center gap-2.5">
                <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-2">
                  {shop.logo_path ? (
                    // eslint-disable-next-line @next/next/no-img-element -- the agence's logo
                    <img src={propertyPhotoUrl(shop.logo_path, { transform: { width: 120, quality: 80 } })} alt="" className="size-full object-cover" />
                  ) : (
                    <Store className="size-5 text-muted" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1 truncate text-[13.5px] font-extrabold text-foreground" dir="auto">
                    {shop.name}
                    {shop.verified_at && <BadgeCheck className="size-4 shrink-0 text-gold" aria-label={tShops("verified")} />}
                  </span>
                  <span className="block text-[11.5px] text-muted">{t("seeAgency")}</span>
                </span>
              </Link>
              {shop.phone && (
                <a href={`tel:${shop.phone}`} className="mazed-btn-luxe tap-target flex w-full justify-center px-4 py-2.5 text-[13.5px]">
                  <Phone className="size-4" /> {t("call")} · <Ltr>{shop.phone}</Ltr>
                </a>
              )}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
