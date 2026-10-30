import { requireAdmin } from "@/lib/admin/session";
import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings/server";
import { adminBtn } from "@/components/admin/AdminButton";
import { FullBleed, EmptyState, QueueKeys, StatusPill, Toolbar, EYEBROW, NUM, type Tab, type Tone } from "@/components/admin/kit";
import { ROW_BASE, ROW_IDLE, ROW_SELECTED, ROW_FOCUS } from "@/components/admin/kit/surface";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { formatNumber, intlTag } from "@/lib/utils";
import { addDays } from "@/lib/dayChips";
import {
  AD_PLACEMENTS, AD_STATUSES, adStatus, chartCeil, ctr, formatCtr,
  type Ad, type AdStatus,
} from "@/lib/ads/ads";
import { campaignDays, lastDays, tunisDay, type AdDay } from "@/lib/ads/dates";
import { AdEditor, type EditableAd } from "./AdEditor";
import { AdActions } from "./AdActions";
import { ChevronLeft, ExternalLink, GalleryHorizontalEnd, Plus } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Publicités — the advertising spaces sold to companies (0177).
 *
 * The list on the left is every campaign, the ended ones included: what an
 * advertiser asks for after the campaign is its numbers. On the right, the
 * open campaign's report — views and clicks since the start and for the last
 * 30 days, day by day, ready to copy into an e-mail — or the form that
 * creates or changes one (`?a=new`, `?a=<id>&v=edit`).
 *
 * The state is computed, not stored: « En cours », « Programmée »,
 * « Terminée » follow from the dates and the clock, « En pause » from the
 * switch (src/lib/ads/ads.ts), so it can never disagree with what the site
 * shows.
 */

const TABS = ["all", ...AD_STATUSES] as const;
type TabKey = (typeof TABS)[number];

const TONE: Record<AdStatus, Tone> = { live: "ok", scheduled: "info", paused: "warn", ended: "neutral" };
const RANK: Record<AdStatus, number> = { live: 0, scheduled: 1, paused: 2, ended: 3 };

const BASE = "/admin/publicites";

type Row = Ad & { status: AdStatus; startDay: string | null; endDay: string | null };

/** « 27 oct. 2026 », for a YYYY-MM-DD day — at noon UTC, so no time zone
 *  moves it to the day before. */
function dayText(day: string, locale: string, withYear = true): string {
  return new Intl.DateTimeFormat(intlTag(locale), {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  })
    .format(new Date(`${day}T12:00:00Z`))
    .replace(/ /g, " ");
}

/** The tab's title: every page of this section used to carry the site's home title. */
export async function generateMetadata() {
  const t = await getTranslations("adminAds");
  return { title: t("title") };
}

export default async function AdminAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; v?: string; status?: string }>;
}) {
  await requireAdmin("publicites");
  const sp = await searchParams;
  const t = await getTranslations("adminAds");
  const locale = await getLocale();
  const admin = getServiceSupabase();
  if (!admin) return <p className="p-6 text-[13px] text-muted">{t("unavailable")}</p>;

  const [{ data, error }, settings] = await Promise.all([
    admin.from("ads").select("*").order("created_at", { ascending: false }),
    getSettings(),
  ]);
  if (error) return <p className="p-6 text-[13px] text-muted">{t("unavailable")}</p>;

  const now = new Date();
  const all: Row[] = ((data ?? []) as Ad[])
    .map((ad) => ({ ...ad, status: adStatus(ad, now), ...campaignDays(ad.starts_at, ad.ends_at) }))
    // What runs first, then what is coming; within one state, by space and
    // in the order the space shows them.
    .sort(
      (a, b) =>
        RANK[a.status] - RANK[b.status] ||
        AD_PLACEMENTS.indexOf(a.placement) - AD_PLACEMENTS.indexOf(b.placement) ||
        a.sort_order - b.sort_order,
    );

  const tally = Object.fromEntries(TABS.map((k) => [k, 0])) as Record<TabKey, number>;
  for (const ad of all) {
    tally.all += 1;
    tally[ad.status] += 1;
  }
  const tab: TabKey = (TABS as readonly string[]).includes(sp.status ?? "") ? (sp.status as TabKey) : "all";
  const tabs: Tab[] = TABS.map((k) => ({ value: k, label: t(`tabs.${k}`), count: tally[k] }));
  const rows = tab === "all" ? all : all.filter((ad) => ad.status === tab);

  // Links keep the tab: opening a campaign must not throw the list back to « Toutes ».
  const listQs = tab === "all" ? "" : `status=${tab}&`;
  const href = (extra: string) => `${BASE}?${listQs}${extra}` as typeof BASE;
  const listHref = tab === "all" ? BASE : `${BASE}?status=${tab}`;

  const openId = sp.a ?? null;
  const creating = openId === "new";
  const selected = creating ? null : all.find((ad) => ad.id === openId) ?? null;
  const editing = creating || (selected !== null && sp.v === "edit");
  const showPane = creating || selected !== null;

  const placementText = (p: Ad["placement"]) => t(`placements.${p}`);
  const datesText = (ad: Pick<Row, "startDay" | "endDay">) => {
    if (ad.startDay && ad.endDay) {
      return t("dates.range", { from: dayText(ad.startDay, locale, false), to: dayText(ad.endDay, locale) });
    }
    if (ad.startDay) return t("dates.from", { from: dayText(ad.startDay, locale) });
    if (ad.endDay) return t("dates.until", { to: dayText(ad.endDay, locale) });
    return t("dates.always");
  };

  const editable: EditableAd | null =
    selected && editing
      ? {
          id: selected.id,
          advertiser: selected.advertiser,
          title: selected.title,
          titleAr: selected.title_ar,
          imagePath: selected.image_path,
          imageMobilePath: selected.image_mobile_path,
          link: selected.link_url,
          placement: selected.placement,
          startDay: selected.startDay,
          endDay: selected.endDay,
          active: selected.active,
          sortOrder: selected.sort_order,
        }
      : null;

  return (
    <FullBleed>
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border px-4">
        <h1 className="shrink-0 text-[13px] font-semibold tracking-tight text-foreground">{t("title")}</h1>
        <Toolbar tabs={tabs} defaultTab="all" search={false} resetParams={["a", "v"]} />
        <Link href={`${BASE}?a=new` as typeof BASE} className={`${adminBtn("primary", "sm")} ms-auto shrink-0`}>
          <Plus className="size-3.5" strokeWidth={2.8} />
          <span className="hidden sm:inline">{t("newAd")}</span>
        </Link>
      </header>

      <QueueKeys />

      {!settings.feature_ads && (
        <p className="shrink-0 border-b border-border bg-[var(--tone-warn-bg)] px-4 py-2 text-[12px] text-[var(--tone-warn)]">
          {t("featureOff")}{" "}
          <Link href="/admin/settings" className="font-semibold underline">
            {t("featureOffLink")}
          </Link>
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <div
          className={`flex min-h-0 w-full flex-col border-border lg:w-[400px] lg:shrink-0 lg:border-e xl:w-[440px] ${
            showPane ? "hidden lg:flex" : "flex"
          }`}
        >
          <p className="shrink-0 border-b border-border px-4 py-1.5 text-[11.5px] text-subtle">
            {t("summary", { live: tally.live, total: tally.all })}
          </p>
          {rows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                Icon={GalleryHorizontalEnd}
                tone={all.length === 0 ? "idle" : "filtered"}
                title={all.length === 0 ? t("emptyTitle") : t("emptyTab")}
                hint={all.length === 0 ? t("emptyHint") : undefined}
              />
            </div>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-border/70 overflow-y-auto overscroll-contain">
              {rows.map((ad) => {
                const sel = ad.id === openId;
                return (
                  <li key={ad.id}>
                    <Link
                      href={href(`a=${ad.id}`)}
                      data-row-id={ad.id}
                      aria-current={sel ? "true" : undefined}
                      prefetch={false}
                      className={`${ROW_BASE} ${ROW_FOCUS} ${sel ? ROW_SELECTED : ROW_IDLE}`}
                    >
                      <span className="relative mt-0.5 h-9 w-[72px] shrink-0 overflow-hidden rounded bg-surface-2 ring-1 ring-border">
                        <Image src={propertyPhotoUrl(ad.image_path)} alt="" fill sizes="72px" className="object-cover" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          dir="auto"
                          className={`block truncate text-[13px] ${sel ? "font-semibold text-foreground" : "font-medium text-foreground/90"}`}
                        >
                          {ad.advertiser}
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-subtle">
                          {placementText(ad.placement)} · {datesText(ad)}
                        </span>
                        <StatusPill tone={TONE[ad.status]} className="mt-1">
                          {t(`status.${ad.status}`)}
                        </StatusPill>
                      </span>
                      <span className="shrink-0 text-end">
                        <span className={`${NUM} block text-[12.5px] text-foreground/90`}>
                          {formatNumber(ad.views, locale)} <span className="text-subtle">{t("viewsShort")}</span>
                        </span>
                        <span className={`${NUM} mt-0.5 block text-[11px] text-subtle`}>
                          {formatNumber(ad.clicks, locale)} {t("clicksShort")} · {formatCtr(ctr(ad.clicks, ad.views), locale)}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className={`min-w-0 flex-1 ${showPane ? "flex" : "hidden lg:flex"}`}>
          {editing ? (
            <div className="w-full">
              <AdEditor
                // The form seeds its state once; another campaign needs another form.
                key={editable?.id ?? "new"}
                ad={editable}
                baseHref={`/${locale}${BASE}`}
                cancelHref={`/${locale}${selected ? href(`a=${selected.id}`) : listHref}`}
              />
            </div>
          ) : selected ? (
            <Detail ad={selected} />
          ) : (
            <div className="grid w-full place-items-center px-6">
              <p className="max-w-xs text-center text-[12.5px] text-subtle">
                {t("pickOne")}
                <br />
                <span className="text-[11.5px]">{t("pickOneHint")}</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </FullBleed>
  );

  /** The open campaign: its images, its numbers, and what can be done to it. */
  async function Detail({ ad }: { ad: Row }) {
    const today = tunisDay(now);
    const { data: daily } = await admin!
      .from("ad_daily")
      .select("day, views, clicks")
      .eq("ad_id", ad.id)
      .gte("day", addDays(today, -29))
      .order("day", { ascending: true });
    const days = lastDays((daily ?? []) as AdDay[], today, 30);
    const views30 = days.reduce((s, d) => s + d.views, 0);
    const clicks30 = days.reduce((s, d) => s + d.clicks, 0);
    let host = ad.link_url;
    try {
      host = new URL(ad.link_url).host;
    } catch {
      /* shown as stored */
    }

    const tile = (label: string, value: string) => (
      <div className="min-w-0">
        <dt className="text-[11.5px] text-subtle">{label}</dt>
        <dd className={`${NUM} mt-0.5 text-[20px] font-semibold leading-tight text-foreground`}>{value}</dd>
      </div>
    );

    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <header className="shrink-0 border-b border-border px-5 py-3.5">
          <Link
            href={listHref as typeof BASE}
            className="mb-2 inline-flex items-center gap-1 text-[12px] font-medium text-subtle transition hover:text-foreground lg:hidden"
          >
            <ChevronLeft className="size-3.5 rtl:-scale-x-100" strokeWidth={2.4} />
            {t("detail.back")}
          </Link>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 dir="auto" className="truncate text-[16px] font-semibold tracking-tight text-foreground">
              {ad.advertiser}
            </h2>
            <StatusPill tone={TONE[ad.status]}>{t(`status.${ad.status}`)}</StatusPill>
          </div>
          <p className="mt-1 text-[11.5px] text-subtle">
            {placementText(ad.placement)} · {datesText(ad)} ·{" "}
            <a
              href={ad.link_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-foreground/80 hover:text-[var(--gold)] hover:underline"
              title={t("detail.openLink")}
            >
              <span dir="ltr">{host}</span>
              <ExternalLink className="size-3" />
            </a>
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <section>
            <h3 className={EYEBROW}>{t("detail.images")}</h3>
            <div className="mt-2 grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
              <figure>
                <div className="relative aspect-[4/1] overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border">
                  <Image src={propertyPhotoUrl(ad.image_path)} alt="" fill sizes="360px" className="object-cover" />
                </div>
                <figcaption className="mt-1 text-[11px] text-subtle">{t("detail.wide")}</figcaption>
              </figure>
              <figure>
                {ad.image_mobile_path ? (
                  <div className="relative aspect-[2/1] overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border">
                    <Image src={propertyPhotoUrl(ad.image_mobile_path)} alt="" fill sizes="180px" className="object-cover" />
                  </div>
                ) : (
                  <p className="grid aspect-[2/1] place-items-center rounded-lg border border-dashed border-border px-2 text-center text-[10.5px] leading-snug text-subtle">
                    {t("detail.noMobile")}
                  </p>
                )}
                <figcaption className="mt-1 text-[11px] text-subtle">{t("detail.mobile")}</figcaption>
              </figure>
            </div>
          </section>

          <section className="mt-6 grid gap-5 sm:grid-cols-2">
            <div>
              <h3 className={EYEBROW}>{t("detail.totals")}</h3>
              <dl className="mt-2 grid grid-cols-3 gap-3">
                {tile(t("detail.views"), formatNumber(ad.views, locale))}
                {tile(t("detail.clicks"), formatNumber(ad.clicks, locale))}
                {tile(t("detail.ctr"), formatCtr(ctr(ad.clicks, ad.views), locale))}
              </dl>
            </div>
            <div>
              <h3 className={EYEBROW}>{t("detail.last30")}</h3>
              <dl className="mt-2 grid grid-cols-3 gap-3">
                {tile(t("detail.views"), formatNumber(views30, locale))}
                {tile(t("detail.clicks"), formatNumber(clicks30, locale))}
                {tile(t("detail.ctr"), formatCtr(ctr(clicks30, views30), locale))}
              </dl>
            </div>
          </section>

          <DailyViews days={days} />

          <section className="mt-6">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className={`${EYEBROW} border-b border-border`}>
                  <th scope="col" className="py-1.5 text-start font-bold">{t("detail.table.day")}</th>
                  <th scope="col" className="py-1.5 text-end font-bold">{t("detail.table.views")}</th>
                  <th scope="col" className="py-1.5 text-end font-bold">{t("detail.table.clicks")}</th>
                  <th scope="col" className="py-1.5 text-end font-bold">{t("detail.table.ctr")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {[...days].reverse().map((d) => (
                  <tr key={d.day} className={d.views || d.clicks ? "text-foreground" : "text-subtle"}>
                    <td className="py-1.5">{dayText(d.day, locale, false)}</td>
                    <td className={`${NUM} py-1.5 text-end`}>{formatNumber(d.views, locale)}</td>
                    <td className={`${NUM} py-1.5 text-end`}>{formatNumber(d.clicks, locale)}</td>
                    <td className={`${NUM} py-1.5 text-end`}>{formatCtr(ctr(d.clicks, d.views), locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <AdActions
          id={ad.id}
          active={ad.active}
          ended={ad.status === "ended"}
          editHref={href(`a=${ad.id}&v=edit`)}
          afterDeleteHref={`/${locale}${listHref}`}
          report={{
            advertiser: ad.advertiser,
            placement: placementText(ad.placement),
            dates: datesText(ad),
            views: ad.views,
            clicks: ad.clicks,
            days: days.map((d) => ({ ...d, label: dayText(d.day, locale) })),
          }}
        />
      </div>
    );
  }

  /**
   * Views per day as columns — one series, so no legend: the title names it.
   * Clicks are a different scale and stay in the table rather than on a
   * second axis. Each column's whole height is its hover target.
   */
  function DailyViews({ days }: { days: AdDay[] }) {
    const top = chartCeil(Math.max(0, ...days.map((d) => d.views)));
    const first = days[0];
    const last = days[days.length - 1];
    return (
      <figure className="mt-6">
        <figcaption>
          <span className={EYEBROW}>{t("detail.chartTitle")}</span>
          <span className="ms-2 text-[11px] text-subtle">{t("detail.chartHint")}</span>
        </figcaption>
        <div className="relative mt-3 h-28">
          <span className={`${NUM} absolute -top-1.5 start-0 text-[10px] text-subtle`}>{formatNumber(top, locale)}</span>
          <div className="absolute inset-x-0 top-0 ms-8 border-t border-border/60" aria-hidden />
          <div className="absolute inset-y-0 end-0 start-8 flex items-end gap-[2px] border-b border-border">
            {days.map((d, i) => {
              const label = t("detail.tooltip", {
                day: dayText(d.day, locale, false),
                views: formatNumber(d.views, locale),
                clicks: formatNumber(d.clicks, locale),
              });
              const anchor = i < 8 ? "start-0" : i > days.length - 9 ? "end-0" : "left-1/2 -translate-x-1/2";
              return (
                <div key={d.day} title={label} className="group/bar relative flex h-full flex-1 items-end justify-center">
                  <span
                    className="block w-full max-w-[10px] rounded-t-[4px] bg-[var(--gold)] opacity-80 transition group-hover/bar:opacity-100"
                    style={{ height: d.views ? `max(2px, ${(d.views / top) * 100}%)` : 0 }}
                  />
                  <span
                    className={`pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-md bg-surface px-2 py-1 text-[11px] text-foreground shadow-[var(--shadow-lg)] ring-1 ring-border group-hover/bar:block ${anchor}`}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        {first && last && (
          <div className="ms-8 mt-1 flex justify-between text-[10.5px] text-subtle">
            <span>{dayText(first.day, locale, false)}</span>
            <span>{dayText(last.day, locale, false)}</span>
          </div>
        )}
      </figure>
    );
  }
}
