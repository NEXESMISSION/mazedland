import { cache } from "react";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { absoluteUrl } from "@/lib/siteUrl";
import { cn, formatDate, formatNumber, formatTND } from "@/lib/utils";
import { asDealType, firstMonthCost } from "@/lib/listings/deal";
import { categoryLabel } from "@/lib/i18n";
import { governorateLabel } from "@/lib/tunisia";
import { canonicalDelegation, shownDelegation } from "@/lib/delegations";
import { routing } from "@/i18n/routing";
import { Ltr } from "@/components/ui/Ltr";
import { PhotoCarousel } from "@/components/listing/PhotoCarousel";
import { ContactReveal } from "./ContactReveal";
import { StickyContact } from "./StickyContact";
import { ReportListing } from "./ReportListing";
import { VisitRequest } from "./VisitRequest";
import { CompareToggle } from "@/components/compare/CompareToggle";
import type { VisitSlot, VisitStatus } from "@/lib/visits";
import { isEditable } from "@/lib/listings/edit";
import { getSettings } from "@/lib/settings/server";
import { FavoriteButton } from "@/components/property/FavoriteButton";
import { RelatedListings } from "@/components/listing/RelatedListings";
import { ViewTracker } from "@/components/listing/ViewTracker";
import { AdSlot } from "@/components/ads/AdSlot";
import { BadgeCheck, MapPin, Clock, ShieldAlert, Hash, Home, Store, PencilLine } from "lucide-react";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

/**
 * One annonce — the page the catalogue has been missing.
 *
 * `/annonces` has listed the fixed-price catalogue since the pivot began, and
 * every card led nowhere: there was no detail page to open. The moderation
 * queue could publish a listing that no buyer could read.
 *
 * Note what is NOT on this page: the seller's phone number. `contact_phone` is
 * granted to service_role alone (0146), so it is not in the HTML and cannot
 * be — ContactReveal fetches it on a click, and that click is logged and
 * rate-limited. On a property site that is not a nicety: a list of everyone
 * selling land in a governorate is something an agency would pay for.
 *
 * Differences from Mazed Auto's equivalent, all deliberate:
 *
 *   • No `condition`. Neuf / occasion does not describe a building; a property
 *     carries `year_built` and its category attributes instead.
 *   • No fitments. A part fits a car; a villa fits nothing.
 *   • No seller avatar. Mazed Immo has no avatars bucket, so the contact card shows
 *     an initial rather than a broken image frame.
 *   • No inspection sheet. Mazed Immo's inspection reports belong to the auction
 *     product, which is being retired; wiring them in here would tie the new
 *     catalogue to the old one.
 */

type Row = {
  id: string; title: string; description: string | null;
  price: number | null; price_on_request: boolean; negotiable: boolean;
  governorate: string; delegation: string | null; address: string | null;
  attributes: Record<string, unknown> | null;
  contact_name: string | null; show_phone: boolean;
  status: string; published_at: string | null; expires_at: string | null;
  rejection_reason: string | null;
  reference: string | null;
  seller_id: string;
  category:
    | { id: string; label_fr: string; label_ar: string | null; kind: string }
    | { id: string; label_fr: string; label_ar: string | null; kind: string }[]
    | null;
  photos: { storage_path: string; sort_order: number }[] | null;
  deal_type: string | null;
  deposit_amount: number | null;
  charges_amount: number | null;
  furnished: string | null;
  available_from: string | null;
  min_lease_months: number | null;
  availability: string | null;
  shop_id: string | null;
  review_flags: string[] | null;
};

const SELECT = `
  id, title, description, price, price_on_request, negotiable,
  governorate, delegation, address, attributes, contact_name, show_phone, status,
  published_at, expires_at, seller_id, reference, rejection_reason, review_flags,
  deal_type, deposit_amount, charges_amount, furnished, available_from,
  min_lease_months, availability, shop_id,
  category:categories (id, label_fr, label_ar, kind),
  photos:listing_photos (storage_path, sort_order)
`;

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

/** The phone column's seller card, which StickyContact steps away from. */
const CONTACT_CARD_ID = "annonce-contact";

// How a non-public status reads in the seller's own preview banner:
// `listing.previewStatus.<status>` in messages/.

const OG_LOCALE: Record<string, string> = { fr: "fr_TN", ar: "ar_TN" };

// `cache`: generateMetadata and the page both need the listing for the same
// request, and without it that was two identical database round trips.
const fetchListing = cache(async (id: string): Promise<Row | null> => {
  const admin = getServiceSupabase();
  if (!admin) return null;
  const { data } = await admin.from("listings").select(SELECT).eq("id", id).maybeSingle();
  return (data as Row | null) ?? null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}): Promise<Metadata> {
  const { id, locale } = await params;
  const [l, t] = await Promise.all([
    fetchListing(id),
    getTranslations({ locale, namespace: "listing" }),
  ]);
  if (!l) return { title: t("metaNotFound"), robots: { index: false } };
  // Visible to its seller and to an admin (see the page), never to a crawler.
  if (l.status !== "published") {
    return { title: `${l.title} · Mazed Immo`, robots: { index: false } };
  }
  const price =
    l.price != null && !l.price_on_request
      ? t(asDealType(l.deal_type) === "rent" ? "rentAmount" : "priceAmount", {
          amount: formatNumber(Number(l.price), locale),
        })
      : t("priceOnRequest");
  const title = `${l.title} · ${price}`;
  const description =
    l.description?.slice(0, 160) ??
    t("metaDescriptionFallback", {
      title: l.title,
      governorate: governorateLabel(l.governorate, locale),
    });
  const url = `/${locale}/annonces/${l.id}`;
  const cover = (l.photos ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)[0];
  const image = cover ? propertyPhotoUrl(cover.storage_path) : null;

  // An annonce is shared as a link — into WhatsApp, Messenger, a family group —
  // and the preview is what gets it opened. Without its own Open Graph block
  // the preview was the site-wide one: brand banner and slogan, no photo, no
  // price. `openGraph` replaces the parent's block instead of merging with it,
  // hence the site name, type and locale restated here — and `alternates`
  // likewise replaces the layout's, so the hreflang pair is this annonce's own.
  return {
    title: `${title} · Mazed Immo`,
    description,
    alternates: {
      canonical: url,
      languages: {
        ...Object.fromEntries(routing.locales.map((lc) => [lc, `/${lc}/annonces/${l.id}`])),
        "x-default": `/${routing.defaultLocale}/annonces/${l.id}`,
      },
    },
    openGraph: {
      type: "website",
      siteName: "Mazed Immo",
      locale: OG_LOCALE[locale],
      url,
      title,
      description,
      ...(image ? { images: [{ url: image, alt: l.title }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function AnnoncePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale = await getLocale();
  const [t, tRoot] = await Promise.all([getTranslations("listing"), getTranslations()]);
  const l = await fetchListing(id);
  if (!l) notFound();

  const category = one(l.category);
  const rent = asDealType(l.deal_type) === "rent";
  const reserved = l.availability === "reserved";
  const photos = (l.photos ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => ({ id: p.storage_path, storage_path: p.storage_path, sort_order: p.sort_order }));

  const admin = getServiceSupabase();

  const userClient = await getServerSupabase();
  const { data: { user } } = await userClient.auth.getUser();

  // An unpublished annonce stays visible to its seller, and to an admin. Every
  // link in « Mes annonces » — the title, the thumbnail, « Voir » — points here
  // and answered « Page introuvable » for drafts, annonces waiting for payment
  // or review, rejected, expired and sold ones alike.
  const isOwner = !!user && user.id === l.seller_id;
  const isPreview = l.status !== "published";
  let isAdmin = false;
  if (isPreview && user && !isOwner && admin) {
    const { data: prof } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    isAdmin = prof?.role === "admin";
  }
  if (isPreview && !isOwner && !isAdmin) notFound();

  // « Demander une visite » (0174): the buyer's name and number to start from,
  // and the request they already have open on this annonce, if any.
  let visitDefaults = { name: "", phone: "" };
  let openVisit: { status: VisitStatus; when: string | null } | null = null;
  if (user && !isOwner && !isPreview && admin) {
    const [{ data: me }, { data: v }] = await Promise.all([
      admin.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle(),
      admin
        .from("visit_requests")
        .select("status, confirmed_slot")
        .eq("listing_id", l.id)
        .eq("buyer_id", user.id)
        .in("status", ["requested", "confirmed"])
        .maybeSingle(),
    ]);
    visitDefaults = { name: (me?.full_name as string | null) ?? "", phone: (me?.phone as string | null) ?? "" };
    if (v) {
      const slot = v.confirmed_slot as VisitSlot | null;
      openVisit = {
        status: v.status as VisitStatus,
        when: slot
          ? `${formatDate(`${slot.day}T12:00:00Z`, locale, "weekday")} · ${tRoot(`visits.parts.${slot.part}`)}`
          : null,
      };
    }
  }

  let saved = false;
  if (user) {
    const { data: w } = await userClient
      .from("watchlist")
      .select("id")
      .eq("user_id", user.id)
      .eq("listing_id", l.id)
      .maybeSingle();
    saved = !!w;
  }

  const [{ data: badge }, { data: attrDefs }, { data: shopRow }] = await Promise.all([
    admin
      ? admin.rpc("has_verified_badge", { p_seller: l.seller_id })
      : Promise.resolve({ data: false }),
    admin && category
      ? admin
          .from("category_attributes")
          .select("field_key, label, unit, options, sort_order")
          .eq("category_id", category.id)
          .order("sort_order")
      : Promise.resolve({ data: [] }),
    // Published for a shop (0173): its card replaces the private seller's, while the shop is open.
    admin && l.shop_id
      ? admin.from("shops").select("slug, name, logo_path, verified_at").eq("id", l.shop_id).eq("status", "approved").maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const shop = shopRow as { slug: string; name: string; logo_path: string | null; verified_at: string | null } | null;

  // Only the attributes the seller actually filled, labelled the way the
  // category defines them — a raw jsonb dump ("titre_foncier: true") is not
  // something a buyer should have to decode. The label is the shared
  // `attributes.<field_key>` message when there is one (the stored label is
  // French), and the stored label for anything an admin added since.
  const attrs = (l.attributes ?? {}) as Record<string, unknown>;
  const specs = ((attrDefs ?? []) as {
    field_key: string; label: string; unit: string | null;
    options: { value: string; label: string }[] | null;
  }[])
    .map((d) => {
      const raw = attrs[d.field_key];
      if (raw == null || raw === "" || raw === false) return null;
      const unit = d.unit === "m²" ? tRoot("common.sqm") : d.unit;
      // Rooms are counted the Tunisian way everywhere — S+2 is two rooms besides
      // the living room — and isolated so RTL does not turn « S+2 » into « 2+S ».
      const value =
        d.field_key === "rooms" && /^\d+$/.test(String(raw))
          ? `\u2066S+${raw}\u2069`
          : raw === true
          ? t("yes")
          : d.options?.find((o) => o.value === String(raw))?.label ??
            (unit
              ? `${/^\d+(\.\d+)?$/.test(String(raw)) ? formatNumber(Number(raw), locale) : raw} ${unit}`
              : String(raw));
      const label = tRoot.has(`attributes.${d.field_key}`)
        ? tRoot(`attributes.${d.field_key}`)
        : d.label;
      return { label, value };
    })
    .filter(Boolean) as { label: string; value: string }[];

  // Structured data. A plain Offer, not the auction-shaped Product with bidding
  // fields that /auctions/[id] emits — this listing has a price, not a bid.
  // The seller's phone is deliberately absent: JSON-LD is the easiest thing on
  // a page to scrape, and the whole point of ContactReveal is that it is not
  // in the markup. Name and description are the seller's own words, in
  // whatever language they wrote them; the category and place follow the page.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: l.title,
    description: l.description ?? undefined,
    image: photos.slice(0, 6).map((p) => absoluteUrl(propertyPhotoUrl(p.storage_path))),
    category: category ? categoryLabel(category, locale) : undefined,
    offers: {
      "@type": "Offer",
      url: absoluteUrl(`/${locale}/annonces/${l.id}`),
      priceCurrency: "TND",
      ...(l.price != null && !l.price_on_request ? { price: Number(l.price) } : {}),
      // A rent is per month — said so, or a crawler reads 1 200 TND as the price of a flat.
      ...(rent && l.price != null && !l.price_on_request
        ? {
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              price: Number(l.price),
              priceCurrency: "TND",
              unitCode: "MON",
            },
          }
        : {}),
      availability: "https://schema.org/InStock",
      areaServed: governorateLabel(l.governorate, locale),
      ...(l.expires_at ? { priceValidUntil: l.expires_at.slice(0, 10) } : {}),
    },
  };

  // ── What a rental adds (0166) ─────────────────────────────────────────────
  // Only what the owner said. "Charges : 0" is a statement and is shown; a
  // silence is not turned into a zero, and the move-in total appears only when
  // every part of it is known (src/lib/listings/deal.ts).
  const money = (n: number) => `${formatTND(n, locale)} ${tRoot("common.tnd")}`;
  const moveIn = rent
    ? firstMonthCost({
        price: l.price == null ? null : Number(l.price),
        priceOnRequest: l.price_on_request,
        deposit: l.deposit_amount == null ? null : Number(l.deposit_amount),
        charges: l.charges_amount == null ? null : Number(l.charges_amount),
      })
    : null;
  const rentFacts: { label: string; value: string; strong?: boolean }[] = rent
    ? ([
        l.deposit_amount != null && { label: t("rent.deposit"), value: money(Number(l.deposit_amount)) },
        l.charges_amount != null && {
          label: t("rent.charges"),
          value: Number(l.charges_amount) > 0 ? t("rent.perMonth", { amount: money(Number(l.charges_amount)) }) : t("rent.noCharges"),
        },
        moveIn != null && { label: t("rent.moveIn"), value: money(moveIn), strong: true },
        l.furnished && { label: t("rent.furnished"), value: t(`rent.furnishedValue.${l.furnished}`) },
        l.available_from && {
          label: t("rent.availableFrom"),
          value: formatDate(l.available_from, locale, "medium"),
        },
        l.min_lease_months != null && {
          label: t("rent.minLease"),
          value: t("rent.months", { count: Number(l.min_lease_months) }),
        },
      ].filter(Boolean) as { label: string; value: string; strong?: boolean }[])
    : [];

  // ── The pieces that appear in both layouts ────────────────────────────────
  //
  // A phone reads this page as one column. A desktop should not: a single
  // narrow column leaves half a 1280px screen empty and pushes the price and
  // the seller's number below the fold — the one thing the buyer came for. So
  // the desktop puts them in a rail that follows you down the page.
  //
  // Written once and placed twice rather than duplicated by hand. Only one copy
  // is ever visible (the other is display:none at that width).
  const priceBlock = (
    <div>
      <div className="mazed-tabular gradient-gold-text text-[34px] font-extrabold leading-none">
        {l.price_on_request || l.price == null
          ? t("priceOnRequest")
          : `${formatTND(Number(l.price), locale)} `}
        {!l.price_on_request && l.price != null && (
          <span className="text-[13px] font-bold uppercase tracking-[0.16em] text-gold/80">
            {rent ? t("tndPerMonth") : tRoot("common.tnd")}
          </span>
        )}
      </div>
      {l.negotiable && !l.price_on_request && (
        <p className="mt-1 text-[12px] text-muted">{t("priceNegotiable")}</p>
      )}
      {rentFacts.length > 0 && (
        <dl className="mt-3 divide-y divide-border rounded-xl bg-surface-2/60 px-3 ring-1 ring-border">
          {rentFacts.map((f) => (
            <div key={f.label} className="flex items-center justify-between gap-3 py-2 text-[12.5px]">
              <dt className="text-muted">{f.label}</dt>
              <dd className={cn("text-end font-bold", f.strong ? "text-foreground" : "text-foreground/90")}>
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );

  // Its seller sees the way to correct it, not « call » and « visit » (0172) —
  // unless an admin has switched editing off.
  const editOn = (await getSettings()).feature_listing_edit;
  const ownerCard =
    isOwner && editOn && isEditable(l) ? (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted">{t("yourListing")}</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t("yourListingHint")}</p>
        <Link
          href={`/annonces/nouvelle?edit=${l.id}` as never}
          className="mazed-btn-luxe tap-target mt-3 flex h-11 w-full items-center justify-center gap-2 text-[13.5px]"
        >
          <PencilLine className="size-4" /> {t("editYourListing")}
        </Link>
        <Link href={"/account/listings" as never} className="mt-2 block text-center text-[12.5px] font-bold text-muted hover:text-foreground">
          {t("yourListings")}
        </Link>
      </section>
    ) : null;

  const sellerCard = shop ? (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-3">
        <Link href={`/agences/${shop.slug}` as never} className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-2 ring-1 ring-border">
          {shop.logo_path ? (
            // eslint-disable-next-line @next/next/no-img-element -- the shop's logo
            <img src={propertyPhotoUrl(shop.logo_path, { transform: { width: 100, quality: 75 } })} alt="" className="size-full object-cover" />
          ) : (
            <Store className="size-5 text-muted" />
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted">{t("shopLabel")}</div>
          <div className="flex items-center gap-1.5">
            <Link href={`/agences/${shop.slug}` as never} dir="auto" className="truncate text-[14.5px] font-bold text-foreground hover:underline">
              {shop.name}
            </Link>
            {shop.verified_at && <BadgeCheck className="size-4 shrink-0 text-gold" strokeWidth={2.4} aria-label={t("verifiedShop")} />}
          </div>
          {l.contact_name && <div dir="auto" className="truncate text-[12px] text-muted">{l.contact_name}</div>}
        </div>
        <FavoriteButton listingId={l.id} initialSaved={saved} loggedIn={user !== null} />
      </div>
      <div className="mt-4">
        <ContactReveal listingId={l.id} showPhone={l.show_phone} />
        {!isOwner && !isPreview && (
          <VisitRequest listingId={l.id} loggedIn={!!user} defaultName={visitDefaults.name} defaultPhone={visitDefaults.phone} open={openVisit} />
        )}
        {!isPreview && (
          <div className="mt-3 flex justify-center">
            <CompareToggle listingId={l.id} variant="pill" />
          </div>
        )}
      </div>
      <Link href={`/agences/${shop.slug}` as never} className="mt-3 block text-center text-[12.5px] font-bold text-gold hover:underline">
        {t("seeShop")}
      </Link>
    </section>
  ) : (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-3">
        {/* An initial, not a photo: Mazed Immo has no avatars bucket, and an empty
            frame reads as a broken page rather than as "no picture". */}
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-[15px] font-extrabold text-muted ring-1 ring-border">
          {(l.contact_name ?? "?").trim().charAt(0).toUpperCase() || "?"}
        </span>

        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted">
            {t("seller")}
          </div>
          <div className="flex items-center gap-1.5">
            <span dir="auto" className="truncate text-[14.5px] font-bold text-foreground">
              {l.contact_name ?? t("privateSeller")}
            </span>
            {/* A tick, not a second "Vendeur vérifié" chip — that claim is
                already made at the top of the page. Here it answers the
                question being asked at this exact moment: do I call? */}
            {badge === true && (
              <BadgeCheck
                className="size-4 shrink-0 text-gold"
                strokeWidth={2.4}
                aria-label={t("verifiedSeller")}
              />
            )}
          </div>
        </div>

        <FavoriteButton listingId={l.id} initialSaved={saved} loggedIn={user !== null} />
      </div>

      <div className="mt-4">
        <ContactReveal listingId={l.id} showPhone={l.show_phone} />
        {!isOwner && !isPreview && (
          <VisitRequest listingId={l.id} loggedIn={!!user} defaultName={visitDefaults.name} defaultPhone={visitDefaults.phone} open={openVisit} />
        )}
        {!isPreview && (
          <div className="mt-3 flex justify-center">
            <CompareToggle listingId={l.id} variant="pill" />
          </div>
        )}
      </div>
    </section>
  );

  const safetyNote = (
    <section className="flex items-start gap-2.5 rounded-2xl bg-surface-2 p-4 ring-1 ring-border">
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted" />
      <div>
        <p className="text-[12.5px] leading-relaxed text-muted">{t("safetyNote")}</p>
        {/* Only a live annonce can be reported, and never by its own seller. */}
        {!isPreview && !isOwner && <ReportListing listingId={l.id} />}
      </div>
    </section>
  );

  return (
    // max-w-3xl up to lg so tablets keep a readable measure; the wider frame
    // only appears where there are two columns to put in it.
    <main className="mx-auto max-w-3xl pb-16 lg:max-w-6xl">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Renders nothing; reports from the browser that this page was really
          looked at, rather than merely prefetched. */}
      {/* A seller looking at their own draft is not a view. */}
      {!isPreview && <ViewTracker listingId={l.id} />}

      {isPreview && (
        <div className="mx-4 mt-3 rounded-2xl border border-dashed border-gold-soft bg-gold-faint px-4 py-3 lg:mx-0">
          <p className="text-[12.5px] font-bold text-foreground">
            {t("previewTitle", {
              status: t.has(`previewStatus.${l.status}`)
                ? t(`previewStatus.${l.status}`)
                : l.status,
            })}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            {l.status === "rejected" && l.rejection_reason
              ? t("previewBodyRejected", { reason: l.rejection_reason })
              : t("previewBody")}
          </p>
          <Link
            href={"/account/listings" as never}
            className="mt-2 inline-flex text-[12.5px] font-bold text-gold hover:underline"
          >
            {t("manageListings")}
          </Link>
        </div>
      )}

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-8 lg:px-6 lg:pt-6">
        {/* ── Left: the thing being sold ── */}
        <div className="min-w-0">
          {photos.length > 0 && (
            <div className="overflow-hidden lg:rounded-2xl lg:border lg:border-border">
              <PhotoCarousel photos={photos} alt={l.title} />
            </div>
          )}

          <div className="px-4 lg:px-0">
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-bold text-muted ring-1 ring-border">
                <Home className="size-3" />
                {category ? categoryLabel(category, locale) : t("categoryFallback")}
              </span>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold ring-1",
                  rent ? "bg-gold-faint text-gold ring-gold-soft" : "bg-surface-2 text-muted ring-border",
                )}
              >
                {rent ? t("forRent") : t("forSale")}
              </span>
              {reserved && (
                <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-extrabold text-amber-600 ring-1 ring-amber-500/30">
                  {t("reserved")}
                </span>
              )}
              {badge === true && (
                <span className="inline-flex items-center gap-1 rounded-full bg-gold-faint px-2.5 py-1 text-[11px] font-extrabold text-gold ring-1 ring-gold-soft">
                  <BadgeCheck className="size-3.5" strokeWidth={2.4} /> {t("verifiedSeller")}
                </span>
              )}
            </div>

            {/* break-words: a title can arrive as one unbroken string. */}
            <h1 dir="auto" className="mt-2 break-words text-[24px] font-extrabold leading-tight tracking-tight lg:text-[28px]">
              {l.title}
            </h1>

            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" /> {governorateLabel(l.governorate, locale)}
                {shownDelegation(l.governorate, l.delegation, locale) ? ` · ${shownDelegation(l.governorate, l.delegation, locale)}` : ""}
                {/* An old free-text délégation off the list reads as the quartier it was. */}
                {(l.address ?? (l.delegation && !canonicalDelegation(l.governorate, l.delegation) ? l.delegation : null)) ? ` · ${l.address ?? l.delegation}` : ""}
              </span>
              {l.published_at && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" />
                  {t("publishedOn", { date: formatDate(l.published_at, locale, "short") })}
                </span>
              )}
              {/* Printed where a buyer will find it when they call: "je vous
                  appelle pour la MZ-00042". A uuid cannot be read down a phone
                  line, and property here is sold by telephone. */}
              {l.reference && (
                <span
                  className="mazed-tabular inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 font-semibold tracking-wide text-foreground ring-1 ring-border"
                  title={t("referenceTitle")}
                >
                  <Hash className="size-3" />
                  <Ltr>{l.reference}</Ltr>
                </span>
              )}
            </div>

            {/* On a phone the price and the seller sit here, in reading order.
                On a desktop they are in the rail instead. */}
            <div className="mt-3 lg:hidden">{priceBlock}</div>
            <div id={CONTACT_CARD_ID} className="mt-5 lg:hidden">{ownerCard ?? sellerCard}</div>

            {specs.length > 0 && (
              <section className="mt-6">
                <h2 className="mazed-eyebrow">{t("specsTitle")}</h2>
                <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {specs.map((s) => (
                    <div
                      key={s.label}
                      className="min-w-0 rounded-xl bg-surface-2 p-3 ring-1 ring-border"
                    >
                      <dt className="text-[10.5px] uppercase tracking-[0.1em] text-muted">
                        {s.label}
                      </dt>
                      <dd className="mt-0.5 break-words text-[13.5px] font-bold text-foreground">
                        {s.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {l.description && (
              <section className="mt-6">
                <h2 className="mazed-eyebrow">{t("descriptionTitle")}</h2>
                {/* Sellers paste links, and a URL is one unbreakable word. With
                    nothing to break it, the paragraph sets its own minimum
                    width and pushes the whole page sideways. `anywhere` breaks
                    it and, unlike `break-word`, also stops it inflating the
                    column's min-content width inside the grid. */}
                <p dir="auto" className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-foreground/85 [overflow-wrap:anywhere]">
                  {l.description}
                </p>
              </section>
            )}

            {/* An advertising space, once the annonce has been read: below its
                description, never in the seller's card. Not on a seller's own
                preview — nobody the advertiser pays to reach sees it. */}
            {!isPreview && (
              <AdSlot placement="listing" className="mt-8" sizes="(min-width: 1024px) 760px, 100vw" />
            )}

            <div className="mt-8 lg:hidden">{safetyNote}</div>

            <div className="mt-6">
              <Link
                href={"/annonces" as never}
                className="text-[13px] font-bold text-gold hover:underline"
              >
                {t("backToCatalogue")}
              </Link>
            </div>
          </div>
        </div>

        {/* ── Right: what you do about it. It follows you down the page because
               the decision to call is made while reading the caractéristiques,
               not after scrolling back up to find the button. ── */}
        <aside className="hidden lg:sticky lg:top-24 lg:block">
          {priceBlock}
          <div className="mt-4">{ownerCard ?? sellerCard}</div>
          <div className="mt-4">{safetyNote}</div>
        </aside>
      </div>

      {/* Below both columns, full width: reaching the end of an annonce used to
          be a dead end, with the back link as the only way on. */}
      <RelatedListings
        listingId={l.id}
        categoryId={category?.id ?? null}
        categoryKind={category?.kind ?? null}
        governorate={l.governorate}
        price={l.price == null ? null : Number(l.price)}
        attributes={l.attributes}
        dealType={asDealType(l.deal_type)}
        locale={locale}
      />

      {/* On a phone the seller card sits under the photo, the title and the
          price — below the first screen. This keeps the number one tap away.
          Only where there is a number to give, and never to its own seller. */}
      {!isOwner && !isPreview && l.show_phone && (
        <StickyContact
          listingId={l.id}
          watchId={CONTACT_CARD_ID}
          price={
            l.price_on_request || l.price == null
              ? t("priceOnRequest")
              : `${formatTND(Number(l.price), locale)} ${rent ? t("tndPerMonth") : tRoot("common.tnd")}`
          }
        />
      )}
    </main>
  );
}
