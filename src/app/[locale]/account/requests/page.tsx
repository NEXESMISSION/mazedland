/* eslint-disable react-hooks/purity -- Server Component: reading the clock to
 * tell an expired demande from a live one is the point, and there is no
 * client render to replay. */
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { categoryLabel } from "@/lib/i18n";
import { governorateLabel } from "@/lib/tunisia";
import { formatDate, formatNumber, formatTND } from "@/lib/utils";
import { catalogueQueryFor } from "@/lib/requests/model";
import { toMatchable } from "@/lib/requests/server";
import { getSettings } from "@/lib/settings/server";
import { BellOff, KeyRound, Plus, Search } from "lucide-react";
import { RequestActions } from "./RequestActions";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  deal_type: string;
  category_ids: string[] | null;
  governorates: string[] | null;
  budget_min: number | string | null;
  budget_max: number | string | null;
  surface_min: number | string | null;
  rooms_min: number | null;
  furnished: string | null;
  move_in_by: string | null;
  note: string | null;
  status: string;
  alerts: boolean;
  expires_at: string;
  created_at: string;
};

/**
 * Mes demandes (0168): each one in a line a person would say — « Location ·
 * Appartements · Sfax · jusqu'à 800 TND / mois » — with how many annonces
 * have matched it, the catalogue search it stands for, and the ways to pause,
 * prolong, edit or delete it. With demandes switched off in the console the
 * list stays, to pause or delete from, without the ways to make or edit one.
 */
export default async function MyRequestsPage() {
  const locale = await getLocale();
  const t = await getTranslations("requests");
  const tc = await getTranslations("common");
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/account/requests`)}`);
  const settings = await getSettings();
  const on = settings.feature_requests;

  const admin = getServiceSupabase();
  const db = admin ?? supabase;
  const [{ data: rows }, { data: catRows }] = await Promise.all([
    db
      .from("property_requests")
      .select(
        "id, deal_type, category_ids, governorates, budget_min, budget_max, surface_min, rooms_min, furnished, move_in_by, note, status, alerts, expires_at, created_at",
      )
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false }),
    db.from("categories").select("id, slug, label_fr, label_ar"),
  ]);
  const requests = (rows ?? []) as Row[];
  const cats = new Map(
    (catRows ?? []).map((c) => [c.id as string, c as { id: string; slug: string; label_fr: string; label_ar: string | null }]),
  );
  const slugById = new Map([...cats.values()].map((c) => [c.id, c.slug]));

  const matchCount = new Map<string, number>();
  if (admin && requests.length > 0) {
    const { data: m } = await admin
      .from("matches")
      .select("request_id")
      .in("request_id", requests.map((r) => r.id));
    for (const x of (m ?? []) as { request_id: string }[]) {
      matchCount.set(x.request_id, (matchCount.get(x.request_id) ?? 0) + 1);
    }
  }

  const now = Date.now();
  const money = (v: number | string) => `${formatTND(Number(v), locale)} ${tc("tnd")}`;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 lg:max-w-3xl lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-tight">{t("listTitle")}</h1>
          <p className="mt-1 text-[13px] text-muted">{t("listSubtitle", { count: requests.length })}</p>
        </div>
        {on && (
          <Link
            href={"/demandes/nouvelle" as never}
            className="mazed-btn-luxe tap-target inline-flex items-center gap-1.5 px-4 py-2.5 text-[13px]"
          >
            <Plus className="size-4" /> {t("newRequest")}
          </Link>
        )}
      </div>

      {requests.length === 0 ? (
        <section className="mt-6 rounded-2xl border border-dashed border-border bg-surface-2/40 p-8 text-center">
          <p className="text-[14px] font-bold text-foreground">{t("emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-relaxed text-muted">{t("emptyBody")}</p>
          {on && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <Link href={"/demandes/nouvelle?deal=sale" as never} className="tap-target inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-[12.5px] font-bold text-[var(--background)]">
                <Search className="size-3.5" /> {t("newBuy")}
              </Link>
              <Link href={"/demandes/nouvelle?deal=rent" as never} className="tap-target inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-[12.5px] font-bold text-[var(--background)]">
                <KeyRound className="size-3.5" /> {t("newRent")}
              </Link>
            </div>
          )}
        </section>
      ) : (
        <ul className="mt-5 space-y-3">
          {requests.map((r) => {
            const rent = r.deal_type === "rent";
            const expired = new Date(r.expires_at).getTime() <= now;
            const state = expired ? "expired" : r.status === "paused" ? "paused" : "active";
            const what = (r.category_ids ?? []).length
              ? (r.category_ids ?? []).map((id) => (cats.get(id) ? categoryLabel(cats.get(id)!, locale) : null)).filter(Boolean).join(", ")
              : t("anyCategory");
            const where = (r.governorates ?? []).length
              ? (r.governorates ?? []).map((g) => governorateLabel(g, locale)).join(", ")
              : t("anywhere");
            const budget = r.budget_max != null
              ? t(rent ? "upToPerMonth" : "upTo", { amount: money(r.budget_max) })
              : null;
            const extra = [
              r.budget_min != null ? t("fromAmount", { amount: money(r.budget_min) }) : null,
              r.surface_min != null ? t("surfaceAtLeast", { area: formatNumber(Number(r.surface_min), locale) }) : null,
              r.rooms_min != null ? t("roomsAtLeast", { count: r.rooms_min }) : null,
              rent && r.furnished ? t(`furnished.${r.furnished}`) : null,
              rent && r.move_in_by ? t("moveInShort", { date: formatDate(r.move_in_by, locale, "medium") }) : null,
            ].filter(Boolean);
            const matches = matchCount.get(r.id) ?? 0;
            return (
              <li key={r.id} className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-gold">
                      {t(rent ? "kindRent" : "kindBuy")}
                    </p>
                    <p className="mt-0.5 text-[15px] font-extrabold leading-snug text-foreground">
                      {what} · {where}
                    </p>
                    {budget && <p className="mazed-tabular mt-0.5 text-[13.5px] font-bold text-foreground">{budget}</p>}
                    {extra.length > 0 && <p className="mt-0.5 text-[12px] text-muted">{extra.join(" · ")}</p>}
                    {r.note && <p dir="auto" className="mt-1 line-clamp-2 text-[12px] italic text-muted">« {r.note} »</p>}
                  </div>
                  <span
                    className={
                      "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold " +
                      (state === "active"
                        ? "mazed-tone-ok"
                        : state === "paused"
                          ? "mazed-tone-warn"
                          : "bg-surface-2 text-muted ring-1 ring-border")
                    }
                  >
                    {t(state === "active" ? "statusActive" : state === "paused" ? "statusPaused" : "statusExpired")}
                  </span>
                </div>

                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
                  <span>{t("matchesCount", { count: matches })}</span>
                  {!expired && <span>{t("expiresOn", { date: formatDate(r.expires_at, locale, "medium") })}</span>}
                  {!r.alerts && (
                    <span className="inline-flex items-center gap-1"><BellOff className="size-3" /> {t("alertsOff")}</span>
                  )}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link
                    href={catalogueQueryFor(toMatchable(r), slugById) as never}
                    className="tap-target inline-flex items-center gap-1.5 rounded-full bg-gold-faint px-3 py-1.5 text-[12px] font-bold text-gold ring-1 ring-gold-soft"
                  >
                    <Search className="size-3.5" /> {t("seeListings")}
                  </Link>
                  {on && (
                    <Link
                      href={`/demandes/nouvelle?id=${r.id}` as never}
                      className="tap-target inline-flex items-center rounded-full px-3 py-1.5 text-[12px] font-bold text-muted ring-1 ring-border hover:text-foreground"
                    >
                      {t("edit")}
                    </Link>
                  )}
                  <RequestActions id={r.id} state={state} days={settings.requests_days} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
