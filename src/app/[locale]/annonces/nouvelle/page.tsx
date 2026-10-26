/* eslint-disable react-hooks/purity -- Server Component.
 * The react-hooks v7 purity rule governs the CLIENT render path: it forbids
 * impure reads (Date.now(), Math.random()) during a render React may replay.
 * This module is an async Server Component — it runs once, per request, on the
 * server, and reading the clock is the correct way to answer "what is overdue"
 * or "which badge has lapsed". There is no render to replay. */
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { categoryLabel } from "@/lib/i18n";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import {
  PublishWizard,
  type InitialDraft,
  type WizardCategory,
  type AttributeDef,
} from "./PublishWizard";
import { liveListingCount } from "@/lib/moderation/server";
import { getSettings } from "@/lib/settings/server";
import { asDealType } from "@/lib/listings/deal";
import { aiAvailable } from "@/lib/ai/server";
import { asPendingEdit, isEditable } from "@/lib/listings/edit";
import { activePlan, can, membershipsOf, shopLiveCount } from "@/lib/pro/shops";
import { median, quartiles, type PriceRef } from "@/lib/listings/priceCheck";

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
export default async function NewListingPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string | string[]; deal?: string | string[]; edit?: string | string[]; shop?: string | string[] }>;
}) {
  const sp = await searchParams;
  const wantedDraft = Array.isArray(sp.draft) ? sp.draft[0] : sp.draft;
  // « Modifier » on an annonce that is online (0172): the same form, in edit mode.
  const wantedEdit = Array.isArray(sp.edit) ? sp.edit[0] : sp.edit;
  // « J'ai un bien à louer » on the home page sends ?deal=rent (0166).
  const initialDeal = asDealType(Array.isArray(sp.deal) ? sp.deal[0] : sp.deal);
  // « Publier pour la boutique » in the Espace Pro sends ?shop=<id> (0173).
  const initialShopId = (Array.isArray(sp.shop) ? sp.shop[0] : sp.shop) ?? null;
  const locale = await getLocale();
  const t = await getTranslations("publish");
  const tRoot = await getTranslations();
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const settings = await getSettings();

  // Editing switched off in /admin/settings: « Modifier » is gone from the
  // seller's annonces, and a link kept from before lands there too. Drafts
  // (?draft=) still open — they are not online yet.
  if (wantedEdit && !settings.feature_listing_edit) redirect(`/${locale}/account/listings`);

  if (!user) {
    const back = wantedEdit
      ? `/${locale}/annonces/nouvelle?edit=${encodeURIComponent(wantedEdit)}`
      : `/${locale}/annonces/nouvelle${initialDeal === "rent" ? "?deal=rent" : ""}`;
    redirect(`/${locale}/login?next=${encodeURIComponent(back)}`);
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-[13px] text-muted">{t("serviceUnavailable")}</p>
      </main>
    );
  }

  const [catRes, attrRes, creditRes, profRes, draftRes, pricedRes] = await Promise.all([
    admin
      .from("categories")
      .select("id, parent_id, slug, label_fr, label_ar, kind, sort_order")
      .eq("is_active", true)
      .order("sort_order"),
    admin
      .from("category_attributes")
      .select("id, category_id, field_key, label, data_type, options, unit, required, sort_order, deal_types")
      .order("sort_order"),
    admin
      .from("seller_credits")
      .select("quota_total, quota_used, expires_at, status")
      .eq("seller_id", user!.id)
      .eq("status", "active"),
    admin.from("profiles").select("full_name, phone, governorate").eq("id", user!.id).maybeSingle(),
    // The annonce to edit. « Reprendre », « Corriger » and checkout's
    // « Modifier l'annonce » all pass ?draft=<id> — which this page used to
    // ignore, always loading the NEWEST draft instead, so a rejected annonce
    // could not be corrected and « Reprendre » opened the wrong one. Without
    // the parameter, fall back to that newest draft: publishing a property
    // takes long enough that a phone call or a stray back gesture interrupts
    // it, and until then that threw the whole form away.
    (() => {
      const q = admin
        .from("listings")
        .select(
          `id, category_id, title, description, price, price_on_request, negotiable,
           governorate, delegation, attributes, contact_name, contact_phone, updated_at,
           deal_type, deposit_amount, charges_amount, furnished, available_from, min_lease_months,
           pending_edit, shop_id, status, review_flags,
           photos:listing_photos (storage_path, sort_order)`,
        )
        .eq("seller_id", user!.id);
      // Online, or still waiting for an admin (a typo is noticed right after sending).
      if (wantedEdit) return q.eq("id", wantedEdit).in("status", ["published", "pending_review"]).maybeSingle();
      return wantedDraft
        ? // Only the seller's own annonce, and only one still editable here.
          q.eq("id", wantedDraft).in("status", ["draft", "rejected", "pending_payment"]).maybeSingle()
        : q.eq("status", "draft").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    })(),
    // What annonces like this one ask (online, same category and offer): the
    // form compares a typed price with it to catch a zero too many or too few.
    // Not read at all while the price help is switched off.
    settings.feature_price_help
      ? admin
          .from("listings")
          .select("category_id, deal_type, governorate, price, attributes")
          .eq("status", "published")
          .eq("price_on_request", false)
          .limit(3000)
      : Promise.resolve({ data: [] }),
  ]);

  type CatRow = {
    id: string; parent_id: string | null; slug: string;
    label_fr: string; label_ar: string | null; kind: string; sort_order: number;
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
        label: categoryLabel(c, locale),
        groupId: parent?.id ?? "other",
        groupLabel: parent ? categoryLabel(parent, locale) : t("otherGroup"),
        kind: c.kind,
      };
    });

  // Keyed by category so the wizard can swap the questions the instant the
  // seller changes their mind, with no second round trip.
  // Labels are stored in French, as admins type them in /admin/catalogue. The
  // ones the site knows are translated here; one an admin adds later shows as
  // typed until it gets a key under `attributes`.
  const attributesByCategory: Record<string, AttributeDef[]> = {};
  for (const a of (attrRes.data ?? []) as (AttributeDef & { category_id: string })[]) {
    (attributesByCategory[a.category_id] ??= []).push({
      field_key: a.field_key,
      label: tRoot.has(`attributes.${a.field_key}`) ? tRoot(`attributes.${a.field_key}`) : a.label,
      data_type: a.data_type,
      options: a.options,
      unit: a.unit === "m²" ? tRoot("common.sqm") : a.unit,
      required: a.required,
      deal_types: a.deal_types ?? null,
    });
  }

  const now = Date.now();
  const creditsLeft = (creditRes.data ?? []).reduce((n, c) => {
    if (new Date(c.expires_at as string).getTime() <= now) return n;
    return n + Math.max(0, (c.quota_total as number) - (c.quota_used as number));
  }, 0);

  // Free places (0165): every account publishes for free while it has fewer
  // than the limit live, and past it the way on is a Pro plan. The submit route
  // decides for real; this is so the form says which before the seller starts.
  const live = await liveListingCount(admin, user!.id, "00000000-0000-0000-0000-000000000000");
  const freePlacesLeft = Math.max(0, settings.free_listing_limit - live);

  const groups = parents.map((p) => ({ id: p.id, label: categoryLabel(p, locale) }));

  const byKey = new Map<string, { prices: number[]; perSqm: number[] }>();
  // By type and offer, and by type, offer and governorate: the form uses the
  // narrower one when it has enough annonces to say something.
  for (const r of (pricedRes.data ?? []) as { category_id: string; deal_type: string | null; governorate: string | null; price: number | string | null; attributes: Record<string, unknown> | null }[]) {
    const p = Number(r.price);
    if (!(p > 0)) continue;
    const area = Number((r.attributes ?? {}).area_sqm);
    const base = `${r.category_id}:${asDealType(r.deal_type)}`;
    for (const key of [base, ...(r.governorate ? [`${base}:${r.governorate}`] : [])]) {
      const bucket = byKey.get(key) ?? { prices: [], perSqm: [] };
      bucket.prices.push(p);
      if (area > 0) bucket.perSqm.push(p / area);
      byKey.set(key, bucket);
    }
  }
  const priceRefs: Record<string, PriceRef> = {};
  for (const [key, b] of byKey) {
    const q = quartiles(b.perSqm);
    priceRefs[key] = { median: median(b.prices), perSqm: median(b.perSqm), perSqmLow: q?.low ?? null, perSqmHigh: q?.high ?? null, count: b.prices.length };
  }

  // The shops this seller publishes for (0173): open ones, where their role
  // allows it, each with what its running plan still covers.
  const shops = wantedEdit
    ? []
    : await Promise.all(
        (await membershipsOf(admin, user!.id))
          .filter((m) => m.shop.status === "approved" && can(m.role, "publish"))
          .map(async ({ shop }) => {
            const plan = await activePlan(admin, shop.id);
            const used = plan ? await shopLiveCount(admin, shop.id) : 0;
            return { id: shop.id, name: shop.name, planLeft: plan ? Math.max(0, plan.quota - used) : null };
          }),
      );

  // Editing: an annonce that is not online or waiting (or not theirs), or one
  // held after reports, has no edit form — back to their annonces. An edit
  // already waiting for an admin opens as the seller left it, not as the live
  // version, so they can correct it.
  const row = draftRes.data as
    | (InitialDraft & { pending_edit?: unknown; status: string; review_flags: string[] | null })
    | null;
  if (wantedEdit && (!row || !isEditable(row))) redirect(`/${locale}/account/listings`);
  const pending = wantedEdit ? asPendingEdit(row?.pending_edit) : null;
  const initialDraft: InitialDraft | null = row
    ? {
        ...row,
        ...(pending ? (pending.fields as Partial<InitialDraft>) : {}),
        photos: pending?.photos ?? row.photos,
      }
    : null;

  return (
    <PublishWizard
      // « Corriger » on the done screen comes back here with ?edit=: a new
      // form, not the done screen kept by a component that stayed mounted.
      key={wantedEdit ? `edit:${wantedEdit}` : `create:${wantedDraft ?? ""}`}
      categories={categories}
      groups={groups}
      attributesByCategory={attributesByCategory}
      creditsLeft={creditsLeft}
      freePlacesLeft={freePlacesLeft}
      freeLimit={settings.free_listing_limit}
      defaultContactName={(profRes.data?.full_name as string | null) ?? ""}
      defaultContactPhone={(profRes.data?.phone as string | null) ?? ""}
      defaultGovernorate={(profRes.data?.governorate as string | null) ?? ""}
      initialDraft={initialDraft}
      initialDeal={initialDeal}
      aiAvailable={wantedEdit ? false : await aiAvailable(admin)}
      mode={wantedEdit ? "edit" : "create"}
      editPending={Boolean(pending)}
      editWaiting={Boolean(wantedEdit) && row?.status === "pending_review"}
      shops={shops}
      initialShopId={initialShopId}
      priceRefs={priceRefs}
      locale={locale}
    />
  );
}
