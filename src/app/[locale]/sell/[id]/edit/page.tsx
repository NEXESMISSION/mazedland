import { redirect } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getTranslations, getLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { SellForm, type SellFormInitial, type ListingType } from "@/components/sell/SellForm";
import type { PropertyType } from "@/lib/types";

/**
 * Edit + resubmit a property listing (audit #14). Only the owner (or
 * admin) can reach this page — RLS on properties hides the row from
 * anyone else, so the .single() call returns no row and we 404.
 */
export default async function EditListingPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const t = await getTranslations();
  const supabase = await getServerSupabase();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale: locale as "fr" });

  const { data: prop } = await supabase
    .from("properties")
    .select("id, owner_id, title, description, type, area_sqm, rooms, bathrooms, floor, year_built, governorate, address, status, listing_type, sale_price, sale_negotiable")
    .eq("id", id)
    .single();
  if (!prop) notFound();
  if (prop.owner_id !== user!.id) {
    redirect({ href: "/sell", locale: locale as "fr" });
  }

  const initial: SellFormInitial = {
    id: prop.id as string,
    title: prop.title as string,
    description: (prop.description as string | null) ?? null,
    type: prop.type as PropertyType,
    area_sqm: prop.area_sqm as number | null,
    rooms: prop.rooms as number | null,
    bathrooms: prop.bathrooms as number | null,
    floor: prop.floor as number | null,
    year_built: prop.year_built as number | null,
    governorate: prop.governorate as string,
    address: (prop.address as string | null) ?? null,
    listing_type: ((prop.listing_type as ListingType | null) ?? "auction"),
    sale_price: prop.sale_price as number | null,
    sale_negotiable: (prop.sale_negotiable as boolean | null) ?? false,
  };

  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 pt-4 lg:max-w-[var(--max-w-content)]">
      <header>
        <span className="batta-eyebrow">Consignment · edit</span>
        <h1 className="mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight">
          {t("sell.editTitle")}
        </h1>
        <p className="mt-1.5 text-[12.5px] text-muted">{t("sell.editSubtitle")}</p>
      </header>
      <div className="mt-5">
        {/* Pricing is required by SellForm's type, but edit-mode skips
            the promo step entirely (carry-over rule) so the values are
            inert here — pass zeros. */}
        <SellForm
          initial={initial}
          pricing={{
            listing_fee_tnd: 0,
            listing_fee_offer_tnd: 0,
            promo_home_featured_tnd: 0,
            promo_top_listed_tnd: 0,
            promo_banner_tnd: 0,
          }}
        />
      </div>
    </div>
  );
}
