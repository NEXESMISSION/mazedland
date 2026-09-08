/* eslint-disable react-hooks/purity -- Server Component.
 * The react-hooks v7 purity rule governs the CLIENT render path: it forbids
 * impure reads (Date.now(), Math.random()) during a render React may replay.
 * This module is an async Server Component — it runs once, per request, on the
 * server, and reading the clock is the correct way to answer "what is overdue"
 * or "which badge has lapsed". There is no render to replay. */
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import {
  PublishWizard,
  type InitialDraft,
  type WizardCategory,
  type AttributeDef,
} from "./PublishWizard";
import {
  PRODUCT_SELECT,
  resolveListingFee,
  toProduct,
  type Product,
} from "@/lib/products";

export const dynamic = "force-dynamic";

/**
 * Publier une annonce — the sell flow for the fixed-price catalogue.
 *
 * Mazed Immo's existing `/sell` submits a lot to an AUCTION: it schedules, it takes
 * a caution, it waits for an inspector. That product is being retired, and it
 * was never the right shape for the seller who simply wants to put a price on
 * a flat and answer the telephone.
 *
 * Everything the wizard needs is resolved here, server-side, because two of
 * these numbers are money and must not be a client's opinion: what publishing
 * costs in each category, and how many publications the seller already owns.
 *
 * WHERE THIS DIVERGES FROM MAZED AUTO. Auto's wizard stopped reading
 * `category_attributes` and asks structured questions of its own instead —
 * make and model from a picker, fuel and gearbox as chips — because free text
 * in those columns is what breaks a car filter. Property is the opposite case:
 * the questions genuinely differ per category (a terrain has no bathrooms, a
 * dépôt has no floor), Mazed Immo already defines 32 of them in
 * `category_attributes`, and `/admin/catalogue` now edits them. Rendering that
 * table is not laziness here — it is what lets an admin add "piscine" to
 * Villas without a deploy.
 */
export default async function NewListingPage() {
  const locale = await getLocale();
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/annonces/nouvelle`)}`);
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-[13px] text-muted">Service indisponible.</p>
      </main>
    );
  }

  const [catRes, attrRes, prodRes, creditRes, profRes, draftRes] = await Promise.all([
    admin
      .from("categories")
      .select("id, parent_id, slug, label_fr, kind, sort_order")
      .eq("is_active", true)
      .order("sort_order"),
    admin
      .from("category_attributes")
      .select("id, category_id, field_key, label, data_type, options, unit, required, sort_order")
      .order("sort_order"),
    admin.from("products").select(PRODUCT_SELECT).eq("is_active", true),
    admin
      .from("seller_credits")
      .select("quota_total, quota_used, expires_at, status")
      .eq("seller_id", user!.id)
      .eq("status", "active"),
    admin.from("profiles").select("full_name, phone").eq("id", user!.id).maybeSingle(),
    // The draft this seller left behind, if any. Publishing a property takes
    // long enough that a phone call, a dead battery or a mistaken back gesture
    // will interrupt it — and until now that threw the whole form away.
    admin
      .from("listings")
      .select(
        `id, category_id, title, description, price, price_on_request, negotiable,
         governorate, delegation, attributes, contact_name, contact_phone, updated_at,
         photos:listing_photos (storage_path, sort_order)`,
      )
      .eq("seller_id", user!.id)
      .eq("status", "draft")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  type CatRow = {
    id: string; parent_id: string | null; slug: string;
    label_fr: string; kind: string; sort_order: number;
  };
  const catRows = (catRes.data ?? []) as CatRow[];
  const parents = catRows.filter((c) => c.parent_id == null);

  const categories: WizardCategory[] = catRows
    .filter((c) => c.parent_id != null)
    .map((c) => {
      const parent = parents.find((p) => p.id === c.parent_id);
      return {
        id: c.id,
        slug: c.slug,
        label: c.label_fr,
        groupId: parent?.id ?? "other",
        groupLabel: parent?.label_fr ?? "Autres",
      };
    });

  // Keyed by category so the wizard can swap the questions the instant the
  // seller changes their mind, with no second round trip.
  const attributesByCategory: Record<string, AttributeDef[]> = {};
  for (const a of (attrRes.data ?? []) as (AttributeDef & { category_id: string })[]) {
    (attributesByCategory[a.category_id] ??= []).push({
      field_key: a.field_key,
      label: a.label,
      data_type: a.data_type,
      options: a.options,
      unit: a.unit,
      required: a.required,
    });
  }

  const products: Product[] = (prodRes.data ?? []).map((r) =>
    toProduct(r as Parameters<typeof toProduct>[0]),
  );

  // What each category costs, resolved here so the wizard never guesses. The
  // parent goes in too: a price set on « Terrains » covers all of its
  // sub-categories without being retyped on each.
  const parentOf = new Map(catRows.map((c) => [c.id, c.parent_id]));
  const feeByCategory: Record<string, number | null> = {};
  for (const c of categories) {
    feeByCategory[c.id] =
      resolveListingFee(products, c.id, parentOf.get(c.id) ?? null)?.price ?? null;
  }

  const now = Date.now();
  const creditsLeft = (creditRes.data ?? []).reduce((n, c) => {
    if (new Date(c.expires_at as string).getTime() <= now) return n;
    return n + Math.max(0, (c.quota_total as number) - (c.quota_used as number));
  }, 0);

  const groups = parents.map((p) => ({ id: p.id, label: p.label_fr }));

  return (
    <PublishWizard
      categories={categories}
      groups={groups}
      attributesByCategory={attributesByCategory}
      feeByCategory={feeByCategory}
      creditsLeft={creditsLeft}
      defaultContactName={(profRes.data?.full_name as string | null) ?? ""}
      defaultContactPhone={(profRes.data?.phone as string | null) ?? ""}
      initialDraft={(draftRes.data as unknown as InitialDraft | null) ?? null}
      locale={locale}
    />
  );
}
