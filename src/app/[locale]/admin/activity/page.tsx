import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { AdminQueryBar } from "@/components/admin/AdminQueryBar";
import { AdminPager } from "@/components/admin/AdminPager";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Activity, Eye, Zap } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 50;

const TYPES = [
  { key: "all", label: "Tout" },
  { key: "page_view", label: "Pages visitées" },
  { key: "action", label: "Actions" },
] as const;

type Tone = "ok" | "bad" | "warn" | "info" | "neutral";
const TONE_CLASS: Record<Tone, string> = {
  ok: "batta-tone-ok",
  bad: "batta-tone-bad",
  warn: "batta-tone-warn",
  info: "bg-gold-faint text-gold ring-1 ring-gold/30",
  neutral: "bg-surface-2 text-muted ring-1 ring-border",
};

// Human-readable label + tone for each logged action code. Anything not
// mapped falls back to the raw code so a new action still shows up.
const ACTION_META: Record<string, { label: string; tone: Tone }> = {
  "payment.captured": { label: "Paiement validé", tone: "ok" },
  "payment.failed": { label: "Paiement refusé", tone: "bad" },
  "payment.manual": { label: "Paiement manuel enregistré", tone: "info" },
  "kyc.verified": { label: "KYC approuvé", tone: "ok" },
  "kyc.rejected": { label: "KYC rejeté", tone: "bad" },
  "property.ready": { label: "Annonce validée", tone: "ok" },
  "property.rejected": { label: "Annonce refusée", tone: "bad" },
  "property.pending_review": { label: "Annonce remise en file", tone: "warn" },
  "payout.request": { label: "Retrait demandé", tone: "info" },
  "payout.processing": { label: "Retrait en traitement", tone: "warn" },
  "payout.paid": { label: "Retrait payé", tone: "ok" },
  "payout.rejected": { label: "Retrait refusé", tone: "bad" },
  "deposit.prepare": { label: "Cautions préparées", tone: "info" },
  "deposit.refund": { label: "Caution remboursée", tone: "ok" },
  "deposit.forfeit": { label: "Caution saisie", tone: "bad" },
  "inspector.approved": { label: "Inspecteur approuvé", tone: "ok" },
  "notification.broadcast": { label: "Diffusion envoyée", tone: "info" },
  "notification.delete": { label: "Notification supprimée", tone: "neutral" },
  "notification.bulk_delete": { label: "Notifications supprimées", tone: "neutral" },
  "settings.update": { label: "Réglages modifiés", tone: "info" },
  "home.feature": { label: "Mise en avant (accueil)", tone: "info" },
  "characteristics.update": { label: "Caractéristiques modifiées", tone: "info" },
  "legal_docs.update": { label: "Documents légaux modifiés", tone: "info" },
  "popup.create": { label: "Popup créé", tone: "info" },
  "popup.update": { label: "Popup modifié", tone: "info" },
  "popup.delete": { label: "Popup supprimé", tone: "neutral" },
  logout: { label: "Déconnexion", tone: "neutral" },
};
function actionMeta(action: string | null): { label: string; tone: Tone } {
  if (!action) return { label: "Action", tone: "neutral" };
  return ACTION_META[action] ?? { label: action, tone: "neutral" };
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

/** Best-effort, dependency-free device label from a User-Agent string. */
function deviceLabel(ua: string | null): string {
  if (!ua) return "—";
  const browser = /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari"
    : "Navigateur";
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
  const sb = await getServerSupabase();

  const q = (qP ?? "").trim().slice(0, 80).replace(/[,()*%]/g, " ").trim();
  const type = TYPES.some((t) => t.key === typeP) ? typeP! : "all";
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
      <AdminPageHeader
        eyebrow="Système · Surveillance"
        title="Journal d'activité"
        description="Qui visite la plateforme, quelles pages, et quelles actions sont effectuées."
      />

      <div className="mt-6 grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-surface px-4 py-3 ring-1 ring-border">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
            <Eye className="size-3.5" /> Pages vues · 24h
          </div>
          <div className="batta-tabular mt-1 text-[22px] font-extrabold">{(viewsRes.count ?? 0).toLocaleString("fr-FR")}</div>
        </div>
        <div className="rounded-xl bg-surface px-4 py-3 ring-1 ring-border">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
            <Zap className="size-3.5" /> Actions · 24h
          </div>
          <div className="batta-tabular mt-1 text-[22px] font-extrabold">{(actionsRes.count ?? 0).toLocaleString("fr-FR")}</div>
        </div>
        <div className="rounded-xl bg-surface px-4 py-3 ring-1 ring-border">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
            <Activity className="size-3.5" /> Total évènements
          </div>
          <div className="batta-tabular mt-1 text-[22px] font-extrabold">{total.toLocaleString("fr-FR")}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {TYPES.map((t) => (
          <Link
            key={t.key}
            href={pill(t.key)}
            className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-bold transition-colors ${
              type === t.key ? "border-[var(--gold)] bg-[var(--gold)] text-white" : "border-border bg-surface text-muted hover:border-gold-soft"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <AdminQueryBar total={total} placeholder="E-mail, page ou action…" />

      {rows.length === 0 ? (
        <div className="batta-frame-gold relative mt-5 px-6 py-10 text-center text-[13px] text-muted">
          Aucune activité enregistrée.
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-2xl bg-surface ring-1 ring-border">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[10px] font-extrabold uppercase tracking-[0.12em] text-muted">
                <th className="px-4 py-3">Quand</th>
                <th className="px-4 py-3">Utilisateur</th>
                <th className="px-4 py-3">Évènement</th>
                <th className="px-4 py-3">Page / Détail</th>
                <th className="px-4 py-3">IP</th>
                <th className="px-4 py-3">Appareil</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((e) => {
                const prof = e.user_id ? profById.get(e.user_id) : undefined;
                const isAction = e.type === "action";
                return (
                  <tr key={e.id} className="hover:bg-surface-2">
                    <td className="batta-tabular whitespace-nowrap px-4 py-2.5 text-muted">
                      {new Date(e.created_at).toLocaleString("fr-FR", {
                        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                      })}
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
                        <span className="text-muted">Anonyme</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {isAction ? (
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${TONE_CLASS[actionMeta(e.action).tone]}`}>
                          {actionMeta(e.action).label}
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] font-bold text-muted ring-1 ring-border">
                          Page vue
                        </span>
                      )}
                    </td>
                    <td className="max-w-[280px] truncate px-4 py-2.5 text-foreground/80" title={e.path || ""}>
                      {e.path || "—"}
                    </td>
                    <td className="batta-tabular whitespace-nowrap px-4 py-2.5 text-muted">{e.ip || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">{deviceLabel(e.user_agent)}</td>
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
