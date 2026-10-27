import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { formatNumber } from "@/lib/utils";
import { loadShopReport } from "@/lib/pro/reportsServer";
import { REPORT_METRICS, REPORT_PERIODS, change, type ReportMetric, type ReportPeriod, type ShopReport } from "@/lib/pro/reports";
import { Download } from "lucide-react";

/**
 * « Rapports » (cahier P5, 0183): what the last 7, 30 or 90 days brought to
 * the agence's annonces — new visitors, numbers shown, favourites, visit
 * requests, new clients — against the period before, day by day, by annonce
 * and by agent, with the table as a spreadsheet. An agent sees their own
 * annonces; the owner and the admins see the agence's.
 */
export async function ReportsTab({
  shopId, days, sellerId, tracesKeptDays,
}: {
  shopId: string;
  days: ReportPeriod;
  /** Set for an agent: their own annonces only. */
  sellerId: string | null;
  tracesKeptDays: number;
}) {
  const admin = getServiceSupabase();
  if (!admin) return null;
  const locale = await getLocale();
  const t = await getTranslations("pro.reports");
  const report = await loadShopReport(admin, { shopId, days, sellerId, tracesKeptDays });
  const href = (d: number) => `/pro/dashboard?shop=${shopId}&tab=rapports&days=${d}`;
  const day = new Intl.DateTimeFormat(locale === "ar" ? "ar-TN" : "fr-TN", { day: "numeric", month: "short" });
  const fmtDay = (d: string) => day.format(new Date(`${d}T12:00:00Z`));
  const contactRate = report.totals.visitors > 0 ? Math.round((report.totals.reveals / report.totals.visitors) * 100) : null;

  return (
    <section className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t("periodLabel")} className="flex gap-1.5">
          {REPORT_PERIODS.map((d) => (
            <Link
              key={d}
              href={href(d) as never}
              aria-current={d === days ? "page" : undefined}
              className={`tap-target rounded-full px-3 py-1.5 text-[12.5px] font-bold ring-1 ${
                d === days ? "bg-gold-faint text-foreground ring-gold-soft" : "text-muted ring-border hover:text-foreground"
              }`}
            >
              {t("period", { days: d })}
            </Link>
          ))}
        </nav>
        <p className="text-[12px] text-muted">
          {sellerId ? t("scopeOwn") : t("scopeShop")} · {t("range", { from: fmtDay(report.from), to: fmtDay(report.to) })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {REPORT_METRICS.map((m) => (
          <Tile
            key={m}
            label={t(`metric.${m}`)}
            value={formatNumber(report.totals[m], locale)}
            delta={report.previous ? change(report.totals[m], report.previous[m]) : null}
            vs={!report.previous ? t("noCompare") : report.previous[m] === 0 ? t("nothingBefore", { days }) : t("vsBefore", { days })}
          />
        ))}
        <Tile label={t("contactRate")} value={contactRate === null ? "—" : `\u2066${contactRate} %\u2069`} delta={null} vs={t("contactRateHint")} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <DayBars title={t("metric.visitors")} report={report} metric="visitors" fmtDay={fmtDay} peak={(count) => t("peak", { count })} />
        <DayBars title={t("metric.reveals")} report={report} metric="reveals" fmtDay={fmtDay} peak={(count) => t("peak", { count })} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-[14px] font-extrabold text-foreground">{t("byListing")}</h2>
          {report.listings.length > 0 && (
            <a
              href={`/api/pro/shops/${shopId}/report?days=${days}&locale=${locale}`}
              download
              className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-gold hover:underline"
            >
              <Download className="size-4" /> {t("download")}
            </a>
          )}
        </div>
        {report.listings.length === 0 ? (
          <p className="p-6 text-center text-[13px] text-muted">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-[12.5px]">
              <thead>
                <tr className="text-start text-[11px] font-bold uppercase tracking-wide text-subtle">
                  <th scope="col" className="px-4 py-2 text-start">{t("listing")}</th>
                  {REPORT_METRICS.map((m) => (
                    <th key={m} scope="col" className="px-2 py-2 text-end">{t(`short.${m}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.listings.slice(0, 50).map((l) => (
                  <tr key={l.id}>
                    <td className="max-w-[16rem] px-4 py-2">
                      <Link href={`/annonces/${l.id}` as never} className="block truncate font-semibold text-foreground hover:underline" dir="auto">
                        {l.title}
                      </Link>
                      <span className="mazed-tabular text-[11px] text-subtle">{l.reference}</span>
                    </td>
                    {REPORT_METRICS.map((m) => (
                      <td key={m} className="mazed-tabular px-2 py-2 text-end text-foreground">{formatNumber(l[m], locale)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {report.agents.length > 1 && (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <h2 className="border-b border-border px-4 py-3 text-[14px] font-extrabold text-foreground">{t("byAgent")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-[12.5px]">
              <thead>
                <tr className="text-[11px] font-bold uppercase tracking-wide text-subtle">
                  <th scope="col" className="px-4 py-2 text-start">{t("agent")}</th>
                  <th scope="col" className="px-2 py-2 text-end">{t("online")}</th>
                  {REPORT_METRICS.map((m) => (
                    <th key={m} scope="col" className="px-2 py-2 text-end">{t(`short.${m}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.agents.map((a) => (
                  <tr key={a.userId}>
                    <td className="px-4 py-2 font-semibold text-foreground" dir="auto">{a.name}</td>
                    <td className="mazed-tabular px-2 py-2 text-end text-foreground">{formatNumber(a.listings, locale)}</td>
                    {REPORT_METRICS.map((m) => (
                      <td key={m} className="mazed-tabular px-2 py-2 text-end text-foreground">{formatNumber(a[m], locale)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[11.5px] leading-relaxed text-subtle">{t("footnote")}</p>
    </section>
  );
}

function Tile({ label, value, delta, vs }: { label: string; value: string; delta: number | null; vs: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-surface p-3.5 sm:p-4">
      <p className="text-[11.5px] font-bold text-muted">{label}</p>
      <p className="mazed-tabular mt-1 truncate text-[20px] font-extrabold text-foreground">{value}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted">
        {delta !== null && (
          <span className={`mazed-tabular me-1 font-bold ${delta > 0 ? "text-[var(--tone-ok)]" : delta < 0 ? "text-[var(--tone-bad)]" : "text-muted"}`}>
            {delta > 0 ? "▲" : delta < 0 ? "▼" : "="} <span dir="ltr">{delta > 0 ? `+${delta}` : delta} %</span>
          </span>
        )}
        {vs}
      </p>
    </div>
  );
}

/**
 * One metric, one bar per day (one series: the title names it, no legend).
 * Each bar says its day and count on hover; the table below holds the numbers.
 */
function DayBars({
  title, report, metric, fmtDay, peak,
}: {
  title: string;
  report: ShopReport;
  metric: ReportMetric;
  fmtDay: (d: string) => string;
  peak: (count: number) => string;
}) {
  const W = 600;
  const H = 120;
  const n = report.series.length;
  const max = Math.max(1, ...report.series.map((s) => s[metric]));
  const slot = W / n;
  const gap = Math.min(2, slot * 0.25);
  const bw = Math.max(1, slot - gap);
  const r = Math.min(4, bw / 2);
  return (
    <figure className="rounded-2xl border border-border bg-surface p-4">
      <figcaption className="flex items-baseline justify-between gap-2 text-[12.5px] font-bold text-foreground">
        {title}
        <span className="mazed-tabular text-[11px] font-semibold text-muted">{peak(max)}</span>
      </figcaption>
      {/* Time runs left to right in both languages (SVG ignores the page's
          direction), like the dates under it. */}
      <svg viewBox={`0 0 ${W} ${H + 1}`} className="mt-3 h-28 w-full" preserveAspectRatio="none" role="img" aria-label={title}>
        <line x1="0" y1={H + 0.5} x2={W} y2={H + 0.5} stroke="var(--border)" strokeWidth="1" />
        {report.series.map((s, i) => {
          const v = s[metric];
          const h = v === 0 ? 0 : Math.max(2, (v / max) * (H - 4));
          const x = i * slot + gap / 2;
          const y = H - h;
          const rr = Math.min(r, h);
          return (
            <g key={s.day}>
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent">
                <title>{`${fmtDay(s.day)} · ${v}`}</title>
              </rect>
              {h > 0 && (
                <path
                  d={`M${x},${H} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + bw - rr} Q${x + bw},${y} ${x + bw},${y + rr} V${H} Z`}
                  fill="var(--gold)"
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10.5px] text-subtle" dir="ltr">
        <span>{fmtDay(report.from)}</span>
        <span>{fmtDay(report.to)}</span>
      </div>
    </figure>
  );
}
