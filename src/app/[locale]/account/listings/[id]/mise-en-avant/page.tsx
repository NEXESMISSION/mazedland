import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { formatDate, formatTND } from "@/lib/utils";
import { activePromo, canBuy, placementOf, type PromoColumn } from "@/lib/promo";
import { getSettings } from "@/lib/settings/server";
import { paymentsAreOpen } from "@/lib/payments/server";
import { PaymentsClosedNotice } from "@/components/payments/PaymentsClosedNotice";
import { ArrowLeft, Home as HomeIcon, LayoutPanelTop, Search, Sparkles } from "lucide-react";
import { BuyPromo } from "./BuyPromo";

export const dynamic = "force-dynamic";

const ICON: Record<PromoColumn, typeof Search> = {
  promo_home_featured: HomeIcon,
  promo_top_listed: Search,
  promo_banner: LayoutPanelTop,
};

/**
 * Mettre en avant (0156): the three paid placements of an online annonce —
 * where each shows, for how long, at what price — and what runs now. Paid
 * through the usual checkout; it starts when an admin accepts the receipt.
 */
/** The tab's title: every page of this section used to carry the site's home title. */
export async function generateMetadata() {
  const t = await getTranslations("promo");
  return { title: t("title") };
}

export default async function BoostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  // Placements switched off in the console: nothing to buy here. One already
  // bought runs its course.
  if (!(await getSettings()).feature_promos) redirect(`/${locale}/account/listings`);
  const t = await getTranslations("promo");
  const tc = await getTranslations("common");
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/account/listings/${id}/mise-en-avant`)}`);
  const admin = getServiceSupabase();
  if (!admin) return <p className="p-6 text-[13px] text-muted">{t("unavailable")}</p>;

  const { data: l } = await admin
    .from("listings")
    .select("id, seller_id, status, title, promo_home_featured, promo_top_listed, promo_banner, promo_expires_at, photos:listing_photos (storage_path, sort_order)")
    .eq("id", id)
    .maybeSingle();
  if (!l || l.seller_id !== user!.id || l.status !== "published") redirect(`/${locale}/account/listings`);

  const [{ data: products }, { data: waiting }, open] = await Promise.all([
    admin.from("products").select("id, slug, name_fr, name_ar, description, description_ar, price, duration_days").eq("kind", "promo").eq("is_active", true).order("sort_order"),
    admin
      .from("payments")
      .select("id, status, metadata")
      .eq("user_id", user!.id)
      .eq("kind", "promo")
      .in("status", ["pending", "pending_review"])
      .contains("metadata", { listing_id: id })
      .limit(5),
    // With no payee to pay, « Choisir » created a payment and the checkout
    // then said « indisponible ». The page says it here, before anything.
    paymentsAreOpen(),
  ]);
  const running = activePromo(l);
  const photo = ((l.photos ?? []) as { storage_path: string; sort_order: number }[]).slice().sort((a, b) => a.sort_order - b.sort_order)[0];
  const pendingBySlug = new Map<string, { id: string; status: string }>();
  for (const p of (waiting ?? []) as { id: string; status: string; metadata: { product_slug?: string } | null }[]) {
    if (p.metadata?.product_slug) pendingBySlug.set(p.metadata.product_slug, { id: p.id, status: p.status });
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 lg:py-10">
      <Link href={"/account/listings" as never} className="inline-flex items-center gap-1 text-[12.5px] font-bold text-muted hover:text-foreground">
        <ArrowLeft className="size-3.5 rtl:-scale-x-100" /> {t("back")}
      </Link>
      <div className="mt-3 flex items-center gap-3">
        <span className="size-14 shrink-0 overflow-hidden rounded-xl bg-surface-2 ring-1 ring-border">
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element -- a small thumbnail
            <img src={propertyPhotoUrl(photo.storage_path, { transform: { width: 120, quality: 70 } })} alt="" className="size-full object-cover" />
          )}
        </span>
        <div className="min-w-0">
          <h1 className="text-[22px] font-extrabold tracking-tight">{t("title")}</h1>
          <p className="truncate text-[13px] text-muted" dir="auto">{l.title}</p>
        </div>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-muted">{t("subtitle")}</p>

      {!open && (
        <PaymentsClosedNotice
          className="mt-4"
          title={t("closed.title")}
          body={t("closed.body")}
          contactLabel={t("closed.contact")}
        />
      )}

      {running && (
        <p className="mt-4 flex items-start gap-2 rounded-2xl px-4 py-3 text-[12.5px] leading-relaxed mazed-tone-ok">
          <Sparkles className="mt-0.5 size-4 shrink-0" />
          {t("running", { what: t(`where.${running.column}.name`), date: formatDate(running.until, locale, "long") })}
        </p>
      )}

      <ul className="mt-5 space-y-3">
        {((products ?? []) as { id: string; slug: string; name_fr: string; name_ar: string | null; description: string | null; description_ar: string | null; price: number | string; duration_days: number | null }[]).map((p) => {
          const column = placementOf(p.slug);
          if (!column) return null;
          const Icon = ICON[column];
          const allowed = canBuy(l, column);
          const pending = pendingBySlug.get(p.slug);
          const extend = running?.column === column;
          return (
            <li key={p.id} className="rounded-2xl bg-surface p-4 ring-1 ring-border">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold-faint text-gold ring-1 ring-gold-soft">
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[14.5px] font-extrabold text-foreground">{locale === "ar" && p.name_ar ? p.name_ar : p.name_fr}</p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{t(`where.${column}.body`)}</p>
                  </div>
                </div>
                <p className="shrink-0 text-end">
                  <span className="mazed-tabular block text-[18px] font-extrabold text-foreground">{formatTND(Number(p.price), locale)} {tc("tnd")}</span>
                  <span className="text-[11.5px] text-muted">{t("days", { count: p.duration_days ?? 30 })}</span>
                </p>
              </div>
              <div className="mt-3">
                {!open ? (
                  // The price stays on show; only the way to pay waits.
                  <p className="text-[12px] font-semibold text-muted">
                    {t(pending?.status === "pending_review" ? "receiptSent" : "closed.row")}
                  </p>
                ) : pending ? (
                  <Link href={`/payment/checkout?payment=${pending.id}` as never} className="tap-target inline-flex h-10 items-center rounded-xl border border-border px-4 text-[13px] font-bold text-foreground hover:bg-surface-2">
                    {t(pending.status === "pending_review" ? "receiptSent" : "continuePayment")}
                  </Link>
                ) : allowed ? (
                  <BuyPromo listingId={l.id} product={p.slug} label={t(extend ? "extend" : "choose")} />
                ) : (
                  <p className="text-[12px] text-muted">{t("oneAtATime")}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-[11.5px] leading-relaxed text-muted">{t("how")}</p>
    </main>
  );
}
