import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { categoryLabel } from "@/lib/i18n";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings/server";
import { aiAvailable } from "@/lib/ai/server";
import { accountAllowance } from "@/lib/places/server";
import type { AttributeDef } from "../PublishWizard";
import { ChatPublisher, type ChatCategory } from "./ChatPublisher";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("publishChat");
  return { title: t("metaTitle"), robots: { index: false } };
}

/**
 * « Publier en parlant » — version B of the publish flow. The seller talks
 * (or types) to the assistant, which keeps the annonce up to date as the
 * conversation goes and asks for what is missing; « Publier » at the end goes
 * through the same save and submit routes as the form. Needs the assistant:
 * without it (no key, switched off, budget spent) the form takes over.
 */
export default async function PublishByVoicePage() {
  const locale = await getLocale();
  const tRoot = await getTranslations();
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/annonces/nouvelle/parler`)}`);
  }

  const settings = await getSettings();
  const admin = getServiceSupabase();
  if (!settings.feature_publish_chat || !admin || !(await aiAvailable(admin))) {
    redirect(`/${locale}/annonces/nouvelle?forme=1`);
  }

  const [{ data: catRows }, { data: attrRows }, { data: profile }] = await Promise.all([
    admin
      .from("categories")
      .select("id, parent_id, slug, label_fr, label_ar, kind, sort_order")
      .eq("is_active", true)
      .order("sort_order"),
    admin
      .from("category_attributes")
      .select("category_id, field_key, label, data_type, options, unit, required, sort_order, deal_types")
      .order("sort_order"),
    admin.from("profiles").select("full_name, phone").eq("id", user!.id).maybeSingle(),
  ]);

  const categories: ChatCategory[] = (catRows ?? [])
    .filter((c) => c.parent_id != null)
    .map((c) => ({
      id: c.id as string,
      slug: c.slug as string,
      label: categoryLabel(c as { label_fr: string; label_ar: string | null }, locale),
    }));

  // The questions each category asks, so what the seller said is stored typed
  // and only where the form would have asked for it.
  const attributesByCategory: Record<string, AttributeDef[]> = {};
  for (const a of (attrRows ?? []) as (AttributeDef & { category_id: string })[]) {
    (attributesByCategory[a.category_id] ??= []).push({
      field_key: a.field_key,
      label: tRoot.has(`attributes.${a.field_key}`) ? tRoot(`attributes.${a.field_key}`) : a.label,
      data_type: a.data_type,
      options: a.options,
      unit: a.unit,
      required: a.required,
      deal_types: a.deal_types ?? null,
    });
  }

  // As the form says it: an agence owner publishes on their plan; everyone
  // else on their free places, and only a full set of those is worth a word
  // before the seller starts talking. The submit route decides for real.
  const allowance = await accountAllowance(admin, user!.id, settings.free_listing_limit);

  return (
    <ChatPublisher
      categories={categories}
      attributesByCategory={attributesByCategory}
      defaultContactName={(profile?.full_name as string | null) ?? ""}
      defaultContactPhone={(profile?.phone as string | null) ?? ""}
      freePlacesFull={allowance.kind === "free" && allowance.left === 0}
      freeLimit={settings.free_listing_limit}
    />
  );
}
