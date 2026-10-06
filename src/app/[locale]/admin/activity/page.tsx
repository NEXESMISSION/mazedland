/* eslint-disable react-hooks/purity -- Server Component.
 * The react-hooks v7 purity rule governs the CLIENT render path: it forbids
 * impure reads (Date.now(), Math.random()) during a render React may replay.
 * This module is an async Server Component — it runs once, per request, on the
 * server, and reading the clock is the correct way to answer "what is overdue"
 * or "which badge has lapsed". There is no render to replay. */
import { Link } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatDate, formatNumber } from "@/lib/utils";
import { Ltr } from "@/components/ui/Ltr";
import { AdminQueryBar } from "@/components/admin/AdminQueryBar";
import { AdminPager } from "@/components/admin/AdminPager";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Activity, Eye, Zap } from "lucide-react";
import { SiteTabs } from "@/components/admin/kit/SiteTabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 50;

/** Labels live in messages: adminActivity.types.<key>. */
const TYPES = [
  { key: "all" },
  { key: "page_view" },
  { key: "action" },
  { key: "error" },
] as const;

type Tone = "ok" | "bad" | "warn" | "info" | "neutral";
const TONE_CLASS: Record<Tone, string> = {
  ok: "mazed-tone-ok",
  bad: "mazed-tone-bad",
  warn: "mazed-tone-warn",
  info: "bg-gold-faint text-gold ring-1 ring-gold/30",
  neutral: "bg-surface-2 text-muted ring-1 ring-border",
};

// Message key (adminActivity.actions.<key>) + tone for each logged action
// code. Action codes contain dots, which next-intl reads as nesting, hence the
// separate key. Anything not mapped falls back to the raw code so a new action
// still shows up.
const ACTION_META: Record<string, { key: string; tone: Tone }> = {
  "payment.captured": { key: "paymentCaptured", tone: "ok" },
  "payment.failed": { key: "paymentFailed", tone: "bad" },
  "payment.manual": { key: "paymentManual", tone: "info" },
  "kyc.verified": { key: "kycVerified", tone: "ok" },
  "kyc.rejected": { key: "kycRejected", tone: "bad" },
  "property.ready": { key: "propertyReady", tone: "ok" },
  "property.rejected": { key: "propertyRejected", tone: "bad" },
  "property.pending_review": { key: "propertyPendingReview", tone: "warn" },
  "payout.request": { key: "payoutRequest", tone: "info" },
  "payout.processing": { key: "payoutProcessing", tone: "warn" },
  "payout.paid": { key: "payoutPaid", tone: "ok" },
  "payout.rejected": { key: "payoutRejected", tone: "bad" },
  "deposit.prepare": { key: "depositPrepare", tone: "info" },
  "deposit.refund": { key: "depositRefund", tone: "ok" },
  "deposit.forfeit": { key: "depositForfeit", tone: "bad" },
  "inspector.approved": { key: "inspectorApproved", tone: "ok" },
  "notification.broadcast": { key: "notificationBroadcast", tone: "info" },
  "notification.delete": { key: "notificationDelete", tone: "neutral" },
  "notification.bulk_delete": { key: "notificationBulkDelete", tone: "neutral" },
  "settings.update": { key: "settingsUpdate", tone: "info" },
  "home.feature": { key: "homeFeature", tone: "info" },
  "characteristics.update": { key: "characteristicsUpdate", tone: "info" },
  "legal_docs.update": { key: "legalDocsUpdate", tone: "info" },
  "popup.create": { key: "popupCreate", tone: "info" },
  "popup.update": { key: "popupUpdate", tone: "info" },
  "popup.delete": { key: "popupDelete", tone: "neutral" },
  logout: { key: "logout", tone: "neutral" },
};
function actionMeta(
  action: string | null,
  t: (key: string) => string,
): { label: string; tone: Tone } {
  if (!action) return { label: t("actionFallback"), tone: "neutral" };
  const meta = ACTION_META[action];
  return meta ? { label: t(`actions.${meta.key}`), tone: meta.tone } : { label: action, tone: "neutral" };
}

type ActivityRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  user_email: string | null;
  type: string;
  action: string | null;
  path: string | null;
  method: string | null;
  status: number | null;
  ip: string | null;
  user_agent: string | null;
};

/** Best-effort, dependency-free device label from a User-Agent string.
 *  `unknownBrowser` is the reader's word for an unrecognised browser. */
function deviceLabel(ua: string | null, unknownBrowser: string): string {
  if (!ua) return "—";
  const browser = /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari"
    : unknownBrowser;
  const os = /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Windows/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : "";
  return os ? `${browser} · ${os}` : browser;
}

/**
 * Activity log — who is on the platform, what pages they visit, and the
 * meaningful actions they perform. Page views are written fire-and-forget
 * from middleware; actions from the API routes that perform them. Filter
 * by type (pill links) + free-text search + date range (AdminQueryBar),
 * server-paginated. See migration 0056 + src/lib/activity.ts.
 */
export default async function AdminActivity({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; range?: string; page?: string }>;
}) {
  const { q: qP, type: typeP, range: rangeP, page: pageP } = await searchParams;
  const t = await getTranslations("adminActivity");
  const locale = await getLocale();
  const sb = await getServerSupabase();

  const q = (qP ?? "").trim().slice(0, 80).replace(/[,()*%]/g, " ").trim();
  const type = TYPES.some((ty) => ty.key === typeP) ? typeP! : "all";
  const sinceDays = rangeP === "1" || rangeP === "7" || rangeP === "30" ? Number(rangeP) : null;
  const page = Math.max(1, Number(pageP) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const since24h = new Date(Date.now() - 86_400_000).toISOString();

  // `estimated`, NOT `exact`: activity_log is the fastest-growing table in
  // the app (middleware writes a page_view per navigation), so an exact
  // count here is a full-table scan that gets slower every day — run on
  // every admin activity page load AND every pagination click. `estimated`
  // returns the real count while the result set is small and falls back to
  // the planner's row estimate once the table is large. Pagination totals
  // may be approximate on a huge log, which is fine for an audit viewer.
  let query = sb
    .from("activity_log")
    .select(
      "id, created_at, user_id, user_email, type, action, path, method, status, ip, user_agent",
      { count: "estimated" },
    );
  if (type !== "all") query = query.eq("type", type);
  if (q) query = query.or(`user_email.ilike.%${q}%,path.ilike.%${q}%,action.ilike.%${q}%`);
  if (sinceDays) query = query.gte("created_at", new Date(Date.now() - sinceDays * 86_400_000).toISOString());
  query = query.order("created_at", { ascending: false }).range(from, to);

  // Page rows + two cheap 24h KPI counts, in parallel.
  const [{ data, count }, viewsRes, actionsRes] = await Promise.all([
    query,
    sb.from("activity_log").select("id", { count: "exact", head: true }).eq("type", "page_view").gte("created_at", since24h),
    sb.from("activity_log").select("id", { count: "exact", head: true }).eq("type", "action").gte("created_at", since24h),
  ]);

  const rows = (data ?? []) as ActivityRow[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Resolve display names/roles for the user ids on this page.
  const ids = Array.from(new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x)));
  const profById = new Map<string, { name: string | null; role: string | null }>();
  if (ids.length > 0) {
    const { data: profiles } = await sb.from("profiles").select("id, full_name, role").in("id", ids);
    for (const p of profiles ?? []) {
      profById.set(p.id as string, {
        name: (p.full_name as string | null) ?? null,
        role: (p.role as string | null) ?? null,
      });
    }
  }

  // Preserve filters across the type pills.
  const pill = (overType?: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (overType && overType !== "all") params.set("type", overType);
    if (rangeP) params.set("range", rangeP);
    const s = params.toString();
    return (`/admin/activity${s ? `?${s}` : ""}`) as "/admin/activity";
  };

  return (
    <div>
      <SiteTabs />
      <AdminPageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
      />

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-surface px-4 py-3 ring-1 ring-border">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
            <Eye className="size-3.5" /> {t("kpiViews")}
          </div>
          <div className="mazed-tabular mt-1 text-[22px] font-extrabold">{formatNumber(viewsRes.count ?? 0, locale)}</div>
        </div>
        <div className="rounded-xl bg-surface px-4 py-3 ring-1 ring-border">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
            <Zap className="size-3.5" /> {t("kpiActions")}
          </div>
          <div className="mazed-tabular mt-1 text-[22px] font-extrabold">{formatNumber(actionsRes.count ?? 0, locale)}</div>
        </div>
        <div className="rounded-xl bg-surface px-4 py-3 ring-1 ring-border">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
            <Activity className="size-3.5" /> {t("kpiTotal")}
          </div>
          <div className="mazed-tabular mt-1 text-[22px] font-extrabold">{formatNumber(total, locale)}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {TYPES.map((ty) => (
          <Link
            key={ty.key}
            href={pill(ty.key)}
            className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-bold transition-colors ${
              type === ty.key ? "border-[var(--gold)] bg-[var(--gold)] text-white" : "border-border bg-surface text-muted hover:border-gold-soft"
            }`}
          >
            {t(`types.${ty.key}`)}
          </Link>
        ))}
      </div>

      <AdminQueryBar total={total} placeholder={t("searchPlaceholder")} />

      {rows.length === 0 ? (
        <div className="mazed-frame-gold relative mt-5 px-6 py-10 text-center text-[13px] text-muted">
          {t("empty")}
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-2xl bg-surface ring-1 ring-border">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="border-b border-border text-start text-[10px] font-extrabold uppercase tracking-[0.12em] text-muted">
                <th className="px-4 py-3">{t("columns.when")}</th>
                <th className="px-4 py-3">{t("columns.user")}</th>
                <th className="px-4 py-3">{t("columns.event")}</th>
                <th className="px-4 py-3">{t("columns.page")}</th>
                <th className="px-4 py-3">{t("columns.ip")}</th>
                <th className="px-4 py-3">{t("columns.device")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((e) => {
                const prof = e.user_id ? profById.get(e.user_id) : undefined;
                const isAction = e.type === "action";
                const meta = isAction ? actionMeta(e.action, t) : null;
                return (
                  <tr key={e.id} className="hover:bg-surface-2">
                    <td className="mazed-tabular whitespace-nowrap px-4 py-2.5 text-muted">
                      {formatDate(e.created_at, locale, "dateTime")}
                    </td>
                    <td className="px-4 py-2.5">
                      {e.user_id ? (
                        <>
                          <div className="font-bold text-foreground">{prof?.name || "—"}</div>
                          <div className="text-[11px] text-muted">
                            {e.user_email || "—"}{prof?.role ? ` · ${prof.role}` : ""}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted">{t("anonymous")}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {meta ? (
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${TONE_CLASS[meta.tone]}`}>
                          {meta.label}
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] font-bold text-muted ring-1 ring-border">
                          {t("pageView")}
                        </span>
                      )}
                    </td>
                    <td className="max-w-[280px] truncate px-4 py-2.5 text-foreground/80" title={e.path || ""}>
                      {e.path ? <Ltr>{e.path}</Ltr> : "—"}
                    </td>
                    <td className="mazed-tabular whitespace-nowrap px-4 py-2.5 text-muted">
                      {e.ip ? <Ltr>{e.ip}</Ltr> : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                      {deviceLabel(e.user_agent, t("browserFallback"))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AdminPager page={page} totalPages={totalPages} />
    </div>
  );
}
