import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { categoryLabel } from "@/lib/i18n";
import { asDealType, type Furnished } from "@/lib/listings/deal";
import { requestFormFromSearch, type RequestFormValue } from "@/lib/requests/prefill";
import { getSettings } from "@/lib/settings/server";
import { RequestForm } from "./RequestForm";

import type { Metadata } from "next";

/**
 * The tab's title — the page carried the site's home title — and private to
 * the signed-in person: never listed by a search engine.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { id } = await searchParams;
  const t = await getTranslations("requests");
  return { title: t(id ? "editTitle" : "newTitle"), robots: { index: false } };
}

export const dynamic = "force-dynamic";

/**
 * Enregistrer une demande (0168) — "ce que je cherche", kept, with an alert.
 *
 * Arrives pre-filled from wherever the person was: the catalogue's « Vous ne
 * trouvez pas ? » passes its search, so the demande is the search they just
 * ran and nothing has to be typed twice — the filters as criteria, the words
 * in « Autres souhaits » (src/lib/requests/prefill.ts). ?id=<demande> edits
 * one of theirs.
 * With demandes switched off in the console, it sends to the catalogue.
 */
export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const sp = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  ) as Record<string, string | undefined>;
  const locale = await getLocale();
  if (!(await getSettings()).feature_requests) redirect(`/${locale}/annonces`);
  const t = await getTranslations("requests");

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const qs = new URLSearchParams(
      Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"),
    ).toString();
    const back = `/${locale}/demandes/nouvelle${qs ? `?${qs}` : ""}`;
    redirect(`/${locale}/login?next=${encodeURIComponent(back)}`);
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-[13px] text-muted">{t("unavailable")}</p>
      </main>
    );
  }

  const { data: catRows } = await admin
    .from("categories")
    .select("id, slug, label_fr, label_ar, parent_id, sort_order")
    .eq("is_active", true)
    .order("sort_order");
  const categories = (catRows ?? [])
    .filter((c) => c.parent_id != null)
    .map((c) => ({
      id: c.id as string,
      slug: c.slug as string,
      label: categoryLabel(c as { label_fr: string; label_ar: string | null }, locale),
    }));

  let id: string | null = null;
  let initial: RequestFormValue;
  let fromSearch: { words: string | null; anyDeal: boolean } = { words: null, anyDeal: false };

  const { data: existing } = sp.id
    ? await admin
        .from("property_requests")
        .select(
          "id, user_id, deal_type, category_ids, governorates, budget_min, budget_max, surface_min, rooms_min, furnished, move_in_by, note, alerts",
        )
        .eq("id", sp.id)
        .maybeSingle()
    : { data: null };

  if (existing && existing.user_id === user!.id) {
    id = existing.id as string;
    initial = {
      deal_type: asDealType(existing.deal_type),
      category_ids: (existing.category_ids as string[] | null) ?? [],
      governorates: (existing.governorates as string[] | null) ?? [],
      budget_min: existing.budget_min != null ? String(Math.floor(Number(existing.budget_min))) : "",
      budget_max: existing.budget_max != null ? String(Math.floor(Number(existing.budget_max))) : "",
      surface_min: existing.surface_min != null ? String(Math.floor(Number(existing.surface_min))) : "",
      rooms_min: existing.rooms_min != null ? String(existing.rooms_min) : "",
      furnished: (existing.furnished as Furnished | null) ?? "",
      move_in_by: (existing.move_in_by as string | null) ?? "",
      note: (existing.note as string | null) ?? "",
      alerts: existing.alerts !== false,
    };
  } else {
    // The search it came from: its filters as criteria, its words as the note.
    const prefill = requestFormFromSearch(sp, categories);
    initial = prefill.value;
    fromSearch = { words: prefill.words, anyDeal: prefill.anyDeal };
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-40 pt-6 lg:pb-12 lg:pt-8">
      <h1 className="text-[24px] font-extrabold tracking-tight">{id ? t("editTitle") : t("newTitle")}</h1>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{t("newIntro")}</p>
      <RequestForm
        id={id}
        initial={initial}
        categories={categories}
        locale={locale}
        searchWords={fromSearch.words}
        anyDeal={fromSearch.anyDeal}
      />
    </main>
  );
}
