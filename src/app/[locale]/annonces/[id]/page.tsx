import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { formatTND } from "@/lib/utils";
import { HeroCarousel } from "@/components/auction/HeroCarousel";
import { ContactReveal } from "./ContactReveal";
import { FavoriteButton } from "@/components/property/FavoriteButton";
import { RelatedListings } from "@/components/listing/RelatedListings";
import { ViewTracker } from "@/components/listing/ViewTracker";
import { BadgeCheck, MapPin, Clock, ShieldAlert, Hash, Home } from "lucide-react";
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
 *   • No seller avatar. Batta has no avatars bucket, so the contact card shows
 *     an initial rather than a broken image frame.
 *   • No inspection sheet. Batta's inspection reports belong to the auction
 *     product, which is being retired; wiring them in here would tie the new
 *     catalogue to the old one.
 */

type Row = {
  id: string; title: string; description: string | null;
  price: number | null; price_on_request: boolean; negotiable: boolean;
  governorate: string; delegation: string | null;
  attributes: Record<string, unknown> | null;
  contact_name: string | null; show_phone: boolean;
  status: string; published_at: string | null; expires_at: string | null;
  reference: string | null;
  seller_id: string;
  category:
    | { id: string; label_fr: string; kind: string }
    | { id: string; label_fr: string; kind: string }[]
    | null;
  photos: { storage_path: string; sort_order: number }[] | null;
};

const SELECT = `
  id, title, description, price, price_on_request, negotiable,
  governorate, delegation, attributes, contact_name, show_phone, status,
  published_at, expires_at, seller_id, reference,
  category:categories (id, label_fr, kind),
  photos:listing_photos (storage_path, sort_order)
`;

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

async function fetchListing(id: string): Promise<Row | null> {
  const admin = getServiceSupabase();
  if (!admin) return null;
  const { data } = await admin.from("listings").select(SELECT).eq("id", id).maybeSingle();
  return (data as Row | null) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const l = await fetchListing(id);
  if (!l || l.status !== "published") return { title: "Annonce" };
  const price =
    l.price != null && !l.price_on_request
      ? `${Number(l.price).toLocaleString("fr-FR")} TND`
      : "Prix sur demande";
  return {
    title: `${l.title} · ${price} · Batta`,
    description: l.description?.slice(0, 160) ?? `${l.title} à ${l.governorate}.`,
  };
}

export default async function AnnoncePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale = await getLocale();
  const l = await fetchListing(id);

  if (!l || l.status !== "published") notFound();

  const category = one(l.category);
  const photos = (l.photos ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => ({ id: p.storage_path, storage_path: p.storage_path, sort_order: p.sort_order }));

  const admin = getServiceSupabase();

  const userClient = await getServerSupabase();
  const { data: { user } } = await userClient.auth.getUser();
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

  const [{ data: badge }, { data: attrDefs }] = await Promise.all([
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
  ]);

  // Only the attributes the seller actually filled, labelled the way the
  // category defines them — a raw jsonb dump ("titre_foncier: true") is not
  // something a buyer should have to decode.
  const attrs = (l.attributes ?? {}) as Record<string, unknown>;
  const specs = ((attrDefs ?? []) as {
    field_key: string; label: string; unit: string | null;
    options: { value: string; label: string }[] | null;
  }[])
    .map((d) => {
      const raw = attrs[d.field_key];
      if (raw == null || raw === "" || raw === false) return null;
      const value =
        raw === true
          ? "Oui"
          : d.options?.find((o) => o.value === String(raw))?.label ??
            (d.unit ? `${raw} ${d.unit}` : String(raw));
      return { label: d.label, value };
    })
    .filter(Boolean) as { label: string; value: string }[];

  // Structured data. A plain Offer, not the auction-shaped Product with bidding
  // fields that /auctions/[id] emits — this listing has a price, not a bid.
  // The seller's phone is deliberately absent: JSON-LD is the easiest thing on
  // a page to scrape, and the whole point of ContactReveal is that it is not
  // in the markup.
  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://batta.tn")
  ).replace(/\/$/, "");
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: l.title,
    description: l.description ?? undefined,
    image: photos.slice(0, 6).map((p) => propertyPhotoUrl(p.storage_path)),
    category: category?.label_fr,
    offers: {
      "@type": "Offer",
      url: `${siteUrl}/${locale}/annonces/${l.id}`,
      priceCurrency: "TND",
      ...(l.price != null && !l.price_on_request ? { price: Number(l.price) } : {}),
      availability: "https://schema.org/InStock",
      areaServed: l.governorate,
      ...(l.expires_at ? { priceValidUntil: l.expires_at.slice(0, 10) } : {}),
    },
  };

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
      <div className="batta-tabular gradient-gold-text text-[34px] font-extrabold leading-none">
        {l.price_on_request || l.price == null
          ? "Prix sur demande"
          : `${formatTND(Number(l.price), locale)} `}
        {!l.price_on_request && l.price != null && (
          <span className="text-[13px] font-bold uppercase tracking-[0.16em] text-gold/80">TND</span>
        )}
      </div>
      {l.negotiable && !l.price_on_request && (
        <p className="mt-1 text-[12px] text-muted">Prix négociable</p>
      )}
    </div>
  );

  const sellerCard = (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-3">
        {/* An initial, not a photo: Batta has no avatars bucket, and an empty
            frame reads as a broken page rather than as "no picture". */}
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-[15px] font-extrabold text-muted ring-1 ring-border">
          {(l.contact_name ?? "?").trim().charAt(0).toUpperCase() || "?"}
        </span>

        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted">
            Vendeur
          </div>
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[14.5px] font-bold text-foreground">
              {l.contact_name ?? "Particulier"}
            </span>
            {/* A tick, not a second "Vendeur vérifié" chip — that claim is
                already made at the top of the page. Here it answers the
                question being asked at this exact moment: do I call? */}
            {badge === true && (
              <BadgeCheck
                className="size-4 shrink-0 text-gold"
                strokeWidth={2.4}
                aria-label="Vendeur vérifié"
              />
            )}
          </div>
        </div>

        <FavoriteButton listingId={l.id} initialSaved={saved} loggedIn={user !== null} />
      </div>

      <div className="mt-4">
        <ContactReveal listingId={l.id} />
      </div>
    </section>
  );

  const safetyNote = (
    <section className="flex items-start gap-2.5 rounded-2xl bg-surface-2 p-4 ring-1 ring-border">
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted" />
      <p className="text-[11.5px] leading-relaxed text-muted">
        Batta publie et vérifie les annonces, mais n&apos;intervient pas dans la transaction :
        le paiement et la signature se font directement entre vous et le vendeur. Visitez le
        bien, demandez le titre de propriété et passez par un notaire avant tout versement.
      </p>
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
      <ViewTracker listingId={l.id} />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-8 lg:px-6 lg:pt-6">
        {/* ── Left: the thing being sold ── */}
        <div className="min-w-0">
          {photos.length > 0 && (
            <div className="overflow-hidden lg:rounded-2xl lg:border lg:border-border">
              <HeroCarousel photos={photos} alt={l.title} />
            </div>
          )}

          <div className="px-4 lg:px-0">
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-bold text-muted ring-1 ring-border">
                <Home className="size-3" />
                {category?.label_fr ?? "Annonce"}
              </span>
              {badge === true && (
                <span className="inline-flex items-center gap-1 rounded-full bg-gold-faint px-2.5 py-1 text-[11px] font-extrabold text-gold ring-1 ring-gold-soft">
                  <BadgeCheck className="size-3.5" strokeWidth={2.4} /> Vendeur vérifié
                </span>
              )}
            </div>

            {/* break-words: a title can arrive as one unbroken string. */}
            <h1 className="mt-2 break-words text-[24px] font-extrabold leading-tight tracking-tight lg:text-[28px]">
              {l.title}
            </h1>

            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" /> {l.governorate}
                {l.delegation ? ` · ${l.delegation}` : ""}
              </span>
              {l.published_at && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" />
                  publiée le {new Date(l.published_at).toLocaleDateString("fr-FR")}
                </span>
              )}
              {/* Printed where a buyer will find it when they call: "je vous
                  appelle pour la BT-00042". A uuid cannot be read down a phone
                  line, and property here is sold by telephone. */}
              {l.reference && (
                <span
                  className="batta-tabular inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 font-semibold tracking-wide text-foreground ring-1 ring-border"
                  title="Référence de l'annonce"
                >
                  <Hash className="size-3" />
                  {l.reference}
                </span>
              )}
            </div>

            {/* On a phone the price and the seller sit here, in reading order.
                On a desktop they are in the rail instead. */}
            <div className="mt-3 lg:hidden">{priceBlock}</div>
            <div className="mt-5 lg:hidden">{sellerCard}</div>

            {specs.length > 0 && (
              <section className="mt-6">
                <h2 className="batta-eyebrow">Caractéristiques</h2>
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
                <h2 className="batta-eyebrow">Description</h2>
                {/* Sellers paste links, and a URL is one unbreakable word. With
                    nothing to break it, the paragraph sets its own minimum
                    width and pushes the whole page sideways. `anywhere` breaks
                    it and, unlike `break-word`, also stops it inflating the
                    column's min-content width inside the grid. */}
                <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-foreground/85 [overflow-wrap:anywhere]">
                  {l.description}
                </p>
              </section>
            )}

            <div className="mt-8 lg:hidden">{safetyNote}</div>

            <div className="mt-6">
              <Link
                href={"/annonces" as never}
                className="text-[13px] font-bold text-gold hover:underline"
              >
                ← Toutes les annonces
              </Link>
            </div>
          </div>
        </div>

        {/* ── Right: what you do about it. It follows you down the page because
               the decision to call is made while reading the caractéristiques,
               not after scrolling back up to find the button. ── */}
        <aside className="hidden lg:sticky lg:top-24 lg:block">
          {priceBlock}
          <div className="mt-4">{sellerCard}</div>
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
        locale={locale}
      />
    </main>
  );
}
