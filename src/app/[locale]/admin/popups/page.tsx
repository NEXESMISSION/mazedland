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
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import type { Popup, PopupStatus, PopupVariant } from "@/lib/popups/schema";
import {
  MessageSquare, PlusCircle, Eye, MousePointerClick,
  Calendar, ShieldAlert, ChevronRight,
} from "lucide-react";
import { SiteTabs } from "@/components/admin/kit/SiteTabs";
import { Ltr } from "@/components/ui/Ltr";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /admin/popups — list every popup configured on the platform with at-a-
 * glance status, variant, audience scope and aggregate impression/click
 * counts. Each row deep-links to the edit form. New popups go via the
 * "+ Nouveau popup" CTA at the top.
 *
 * Auth is enforced by the admin layout one level up (role=admin redirect).
 */
export default async function AdminPopupsPage() {
  const t = await getTranslations("adminPopups");
  const locale = await getLocale();
  const supabase = await getServerSupabase();
  const { data: rows } = await supabase
    .from("popups")
    .select("*")
    .order("created_at", { ascending: false });
  const popups = (rows ?? []) as Popup[];

  // One head-count per popup for the impression/click summary. Cheap pair
  // of count queries that fan-out in parallel; only run when there's at
  // least one popup so an empty page costs nothing.
  const stats = new Map<string, { impressions: number; clicks: number }>();
  if (popups.length > 0) {
    const ids = popups.map((p) => p.id);
    const [impRes, clkRes] = await Promise.all([
      supabase.from("popup_views").select("popup_id, view_count").in("popup_id", ids),
      supabase.from("popup_views").select("popup_id").in("popup_id", ids).not("clicked_at", "is", null),
    ]);
    for (const r of (impRes.data ?? []) as { popup_id: string; view_count: number }[]) {
      const prev = stats.get(r.popup_id) ?? { impressions: 0, clicks: 0 };
      prev.impressions += r.view_count;
      stats.set(r.popup_id, prev);
    }
    for (const r of (clkRes.data ?? []) as { popup_id: string }[]) {
      const prev = stats.get(r.popup_id) ?? { impressions: 0, clicks: 0 };
      prev.clicks += 1;
      stats.set(r.popup_id, prev);
    }
  }

  // Quick aggregate tiles at the top — same vertical rhythm as
  // /admin/notifications. Counts: live / scheduled / draft.
  const live = popups.filter((p) => p.status === "live").length;
  const scheduled = popups.filter(
    (p) => p.mode === "broadcast" && p.starts_at && new Date(p.starts_at).getTime() > Date.now(),
  ).length;
  const draft = popups.filter((p) => p.status === "draft").length;

  return (
    <div>
      <SiteTabs />
      <AdminPageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          <Link
            href={"/admin/popups/new" as never}
            className="mazed-btn-luxe tap-target inline-flex shrink-0 items-center gap-1.5 px-4 py-2 text-[12px]"
          >
            <PlusCircle className="size-4" strokeWidth={2.2} />
            {t("newPopup")}
          </Link>
        }
      />

      {/* Stat tiles */}
      <div className="mt-5 grid grid-cols-3 gap-3">
        <StatTile value={live} label={t("stats.live")} tone="ok" locale={locale} />
        <StatTile value={scheduled} label={t("stats.scheduled")} tone="info" locale={locale} />
        <StatTile value={draft} label={t("stats.draft")} tone="muted" locale={locale} />
      </div>

      {/* List */}
      <section className="mt-6">
        {popups.length === 0 ? (
          <EmptyState t={t} />
        ) : (
          <ul className="space-y-2">
            {popups.map((p) => (
              <PopupRow
                key={p.id}
                popup={p}
                stats={stats.get(p.id) ?? { impressions: 0, clicks: 0 }}
                t={t}
                locale={locale}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The page's translator, handed to the sub-components rendered on the server. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

function StatTile({
  value,
  label,
  tone,
  locale,
}: {
  value: number;
  label: string;
  tone: "ok" | "info" | "muted";
  locale: string;
}) {
  const accent =
    tone === "ok"
      ? "bg-emerald-500"
      : tone === "info"
        ? "bg-amber-500"
        : "bg-foreground/30";
  return (
    <div className="relative overflow-hidden rounded-2xl bg-surface p-4 ring-1 ring-border">
      <span aria-hidden className={`absolute start-3 top-3 size-1.5 rounded-full ${accent}`} />
      <div className="mazed-tabular mt-3 text-[28px] font-extrabold leading-none">
        {formatNumber(value, locale)}
      </div>
      <div className="mt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted">
        {label}
      </div>
    </div>
  );
}

function PopupRow({
  popup,
  stats,
  t,
  locale,
}: {
  popup: Popup;
  stats: { impressions: number; clicks: number };
  t: Translate;
  locale: string;
}) {
  const title = popup.title.fr ?? popup.title.ar ?? popup.title.en ?? popup.slug;
  const ctr =
    stats.impressions > 0
      ? `${Math.round((stats.clicks / stats.impressions) * 100)}%`
      : "—";

  return (
    <li>
      <Link
        href={{ pathname: "/admin/popups/[id]/edit", params: { id: popup.id } } as never}
        className="flex items-center gap-3 rounded-2xl bg-surface p-4 ring-1 ring-border transition hover:ring-gold-soft/50"
      >
        <span className="mazed-monogram size-10 shrink-0">
          <MessageSquare className="size-4" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[14px] font-bold text-foreground">{title}</span>
            <StatusPill status={popup.status} t={t} />
            <VariantPill variant={popup.variant} t={t} />
            {popup.force_action && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wider text-red-700 ring-1 ring-red-500/30">
                <ShieldAlert className="size-2.5" strokeWidth={2.5} />
                {t("blocking")}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted">
            <Ltr>{popup.slug}</Ltr> · {popup.mode === "rule" ? t("modes.rule") : t("modes.broadcast")}
            {popup.starts_at && (
              <>
                {" · "}
                <Calendar className="inline size-3" strokeWidth={2} />{" "}
                {formatDate(popup.starts_at, locale, "short")}
              </>
            )}
          </div>
          <div className="mazed-tabular mt-1.5 flex flex-wrap items-center gap-3 text-[10.5px] text-muted">
            <span className="inline-flex items-center gap-1">
              <Eye className="size-3" strokeWidth={2.2} />
              {formatNumber(stats.impressions, locale)}
            </span>
            <span className="inline-flex items-center gap-1">
              <MousePointerClick className="size-3" strokeWidth={2.2} />
              {formatNumber(stats.clicks, locale)}
            </span>
            <span>{t("ctr", { value: ctr })}</span>
          </div>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" strokeWidth={2.2} />
      </Link>
    </li>
  );
}

const STATUS_TONE: Record<PopupStatus, string> = {
  draft: "bg-surface-2 text-muted ring-1 ring-border",
  live: "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30",
  paused: "bg-amber-500/15 text-amber-700 ring-1 ring-amber-500/30",
  archived: "bg-surface-2 text-muted ring-1 ring-border",
};

/** Labels live in messages: adminPopups.status.<status>. */
function StatusPill({ status, t }: { status: PopupStatus; t: Translate }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wider ${STATUS_TONE[status]}`}>
      {t(`status.${status}`)}
    </span>
  );
}

/** Labels live in messages: adminPopups.variants.<variant>. */
function VariantPill({ variant, t }: { variant: PopupVariant; t: Translate }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gold-faint px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wider text-gold-bright">
      {t(`variants.${variant}`)}
    </span>
  );
}

function EmptyState({ t }: { t: Translate }) {
  return (
    <div className="mazed-frame-gold relative mt-2 px-6 py-10 text-center">
      <div className="relative">
        <span className="mazed-monogram mazed-monogram-filled mx-auto mb-4 size-12 text-[20px]">
          <MessageSquare className="size-5" strokeWidth={2} />
        </span>
        <p className="text-[18px] font-bold text-foreground">{t("emptyTitle")}</p>
        <p className="mt-2 text-[12px] text-muted">{t("emptyBody")}</p>
        <Link
          href={"/admin/popups/new" as never}
          className="mazed-btn-luxe tap-target mt-5 inline-flex items-center gap-1.5 px-5 py-2.5 text-[12.5px]"
        >
          <PlusCircle className="size-4" strokeWidth={2.2} />
          {t("newPopup")}
        </Link>
      </div>
    </div>
  );
}
