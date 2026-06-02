import { redirect } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { SellForm, type SellFormInitial, type ListingType } from "@/components/sell/SellForm";
import type { PropertyType } from "@/lib/types";
import { parseRejection, REJECTION_CATEGORIES, REJECTION_CATEGORY_LABELS, type RejectionCategory } from "@/lib/rejection";
import { AlertTriangle, Lightbulb } from "lucide-react";

/**
 * Edit + resubmit a property listing (audit #14). Only the owner (or
 * admin) can reach this page — RLS on properties hides the row from
 * anyone else, so the .single() call returns no row and we 404.
 */
export default async function EditListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const { id, locale } = await params;
  const { focus: focusParam } = await searchParams;
  // `?focus=` accepts a comma-separated list (e.g. ?focus=photos,documents)
  // because one rejection can carry multiple categories at once. Each
  // valid category contributes a ring-highlight on the matching Section
  // in the edit form. Unknown values are dropped; if everything is
  // dropped we fall back to the parsed-from-rejection categories.
  const focusFromUrl: RejectionCategory[] = (focusParam ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is RejectionCategory =>
      (REJECTION_CATEGORIES as readonly string[]).includes(s),
    );
  const t = await getTranslations();
  const supabase = await getServerSupabase();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale: locale as "fr" });

  const { data: prop } = await supabase
    .from("properties")
    .select("id, owner_id, title, description, type, area_sqm, rooms, bathrooms, floor, year_built, attributes, governorate, address, status, rejection_reason, listing_type, sale_price, sale_negotiable")
    .eq("id", id)
    .single();
  if (!prop) notFound();
  if (prop.owner_id !== user!.id) {
    redirect({ href: "/sell", locale: locale as "fr" });
  }

  // Pull the photos that already exist for this listing so the edit form
  // can paint them in the gallery instead of showing "Photos · 0/10" —
  // the bug a seller hits when revisiting their own listing.
  const { data: existingPhotosRows } = await supabase
    .from("property_photos")
    .select("id, storage_path, sort_order")
    .eq("property_id", id)
    .order("sort_order");
  const existingPhotos = (existingPhotosRows ?? []) as Array<{
    id: string;
    storage_path: string;
    sort_order: number;
  }>;

  // The attributes JSONB is the source of truth, but rows created before
  // migration 0037 only have the legacy columns populated. Backfill the
  // canonical keys from those columns so editing an old listing doesn't
  // wipe its surface / rooms / etc.
  const attributes: Record<string, string | number | boolean> = {
    ...((prop.attributes as Record<string, string | number | boolean> | null) ?? {}),
  };
  const legacy: Record<string, number | null> = {
    area_sqm: prop.area_sqm as number | null,
    rooms: prop.rooms as number | null,
    bathrooms: prop.bathrooms as number | null,
    floor: prop.floor as number | null,
    year_built: prop.year_built as number | null,
  };
  for (const [k, v] of Object.entries(legacy)) {
    if (attributes[k] == null && v != null) attributes[k] = v;
  }

  const initial: SellFormInitial = {
    id: prop.id as string,
    title: prop.title as string,
    description: (prop.description as string | null) ?? null,
    type: prop.type as PropertyType,
    attributes,
    governorate: prop.governorate as string,
    address: (prop.address as string | null) ?? null,
    listing_type: ((prop.listing_type as ListingType | null) ?? "auction"),
    sale_price: prop.sale_price as number | null,
    sale_negotiable: (prop.sale_negotiable as boolean | null) ?? false,
    existingPhotos,
    wasRejected: prop.status === "rejected",
  };

  // Surface the admin's rejection at the top of the edit form so the
  // seller knows *exactly* what to fix before touching any field.
  // parseRejection peels off the [CATEGORY] prefix the admin form
  // injects; tagged rejections also get a contextual hint pointing the
  // seller at the section of the form to revisit.
  const wasRejected = prop.status === "rejected" && prop.rejection_reason;
  const rejection = wasRejected ? parseRejection(prop.rejection_reason as string) : null;
  // Explicit URL `?focus=` wins (seller may be linking back from a
  // notification or pasted URL). Otherwise fall back to the categories
  // baked into the property's stored rejection_reason — which is
  // typically how sellers get here in the first place.
  const effectiveFocus: RejectionCategory[] =
    focusFromUrl.length > 0
      ? focusFromUrl
      : (rejection?.tagged ? rejection.categories : []);

  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 pt-4 lg:max-w-[var(--max-w-content)]">
      <header>
        <span className="batta-eyebrow">Consignment · edit</span>
        <h1 className="mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight">
          {t("sell.editTitle")}
        </h1>
        <p className="mt-1.5 text-[12.5px] text-muted">{t("sell.editSubtitle")}</p>
      </header>

      {rejection && (
        <div className="mt-5 overflow-hidden rounded-2xl bg-[var(--danger)]/5 ring-1 ring-[var(--danger)]/25">
          <div className="flex items-start gap-3 p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--danger)] text-white">
              <AlertTriangle className="size-5" strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[var(--danger)]">
                  À corriger
                </span>
                {rejection.categories.map((c) => (
                  <span
                    key={c}
                    className="rounded-full bg-[var(--danger)]/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[var(--danger)]"
                  >
                    {REJECTION_CATEGORY_LABELS[c]}
                  </span>
                ))}
              </div>
              <h2 className="mt-1.5 text-[15px] font-extrabold tracking-tight">
                {rejection.categories.length > 1
                  ? "Annonce refusée — corrigez les sections marquées ci-dessous"
                  : "Annonce refusée — corrigez uniquement ce qui suit"}
              </h2>
              {rejection.message && (
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground/85">
                  {rejection.message}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-start gap-2 border-t border-[var(--danger)]/20 bg-[var(--danger)]/10 px-4 py-2.5 text-[11.5px] text-foreground/80">
            <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-[var(--danger)]" strokeWidth={2.2} />
            <span>{rejection.hint} Vos autres champs sont conservés.</span>
          </div>
        </div>
      )}

      <div className="mt-5">
        {/* Pricing is required by SellForm's type, but edit-mode skips
            the promo step entirely (carry-over rule) so the values are
            inert here — pass zeros. */}
        <SellForm
          initial={initial}
          focusCategories={effectiveFocus}
          focusMode={rejection?.mode}
          pricing={{
            feeAuction: { mode: "free", value: 0 },
            feeDirect: { mode: "free", value: 0 },
            promoHome: { enabled: false, value: 0 },
            promoTop: { enabled: false, value: 0 },
            promoBanner: { enabled: false, value: 0 },
          }}
        />
      </div>
    </div>
  );
}
