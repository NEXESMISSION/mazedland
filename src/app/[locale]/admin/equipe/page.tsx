import { requireAdmin } from "@/lib/admin/session";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils";
import { SiteTabs } from "@/components/admin/kit/SiteTabs";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminPager } from "@/components/admin/AdminPager";
import { scopesFromRow, isAdminSection } from "@/lib/admin/sections";
import { auditChanges, auditValue } from "@/lib/admin/auditDiff";
import { isSettingKey } from "@/lib/settings/registry";
import { TeamPanel, type Member } from "./TeamPanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 40;

type AuditRow = {
  id: number;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  before: unknown;
  after: unknown;
  note: string | null;
  created_at: string;
};

/**
 * The console team — who may open which sections — and the audit trail of
 * the decisions that cost money or access. A full admin's screen: the
 * sections are in src/lib/admin/sections.ts, the rules in 0178.
 */
/** The tab's title: every page of this section used to carry the site's home title. */
export async function generateMetadata() {
  const t = await getTranslations("adminTeam");
  return { title: t("title") };
}

export default async function AdminTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ vue?: string; page?: string }>;
}) {
  const { user } = await requireAdmin("equipe");
  const sp = await searchParams;
  const view = sp.vue === "journal" ? "journal" : "members";
  const t = await getTranslations("adminTeam");
  const locale = await getLocale();
  const admin = getServiceSupabase();
  if (!admin) return <p className="p-6 text-[13px] text-muted">{t("unavailable")}</p>;

  const { data: memberRows } = await admin
    .from("profiles")
    .select("id, full_name, phone, admin_scopes, banned_at")
    .eq("role", "admin")
    .order("full_name");
  const members: Member[] = (memberRows ?? []).map((p) => ({
    id: p.id as string,
    name: (p.full_name as string | null) ?? t("noName"),
    phone: (p.phone as string | null) ?? null,
    scopes: scopesFromRow(p.admin_scopes),
    banned: Boolean(p.banned_at),
  }));

  const tabs = [
    { key: "members", href: "/admin/equipe", label: t("tabs.members", { count: members.length }) },
    { key: "journal", href: "/admin/equipe?vue=journal", label: t("tabs.journal") },
  ] as const;

  return (
    <div>
      <SiteTabs />
      <AdminPageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />

      <nav
        aria-label={t("tabs.label")}
        className="-mx-5 mt-4 flex items-center gap-4 overflow-x-auto border-b border-border px-5 lg:-mx-8 lg:px-8"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href as "/admin"}
            aria-current={tab.key === view ? "page" : undefined}
            className={`relative shrink-0 py-2.5 text-[12.5px] transition ${
              tab.key === view
                ? "font-semibold text-[var(--gold)] after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[2px] after:bg-[var(--gold)]"
                : "font-medium text-subtle hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {view === "members" ? (
        <TeamPanel members={members} selfId={user.id} />
      ) : (
        <Journal page={Math.max(1, Number(sp.page) || 1)} locale={locale} />
      )}
    </div>
  );
}

async function Journal({ page, locale }: { page: number; locale: string }) {
  const t = await getTranslations("adminTeam");
  const tr = await getTranslations("settingsRegistry");
  const admin = getServiceSupabase()!;
  const from = (page - 1) * PAGE_SIZE;
  const { data, count } = await admin
    .from("admin_audit")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  const rows = (data ?? []) as AuditRow[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  // Names for the people on either side of an entry.
  const ids = [
    ...new Set(
      rows.flatMap((r) => [r.actor_id, r.target_type === "profile" ? r.target_id : null]).filter(Boolean) as string[],
    ),
  ];
  const { data: people } = ids.length
    ? await admin.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] };
  const name = new Map((people ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? t("noName")]));

  const actionLabel = (a: string) => {
    const key = `journal.actions.${a.replace(/\./g, "_")}`;
    return t.has(key) ? t(key) : a;
  };
  // A setting is named as the settings screen names it.
  const fieldLabel = (k: string) =>
    t.has(`journal.fields.${k}`) ? t(`journal.fields.${k}`) : isSettingKey(k) ? tr(`${k}.label`) : k;
  // Sections, roles and statuses by their names; anything else as stored.
  const word = (s: string) =>
    isAdminSection(s) ? t(`sections.${s}`) : t.has(`journal.values.${s}`) ? t(`journal.values.${s}`) : s;
  const value = (key: string, v: unknown) =>
    key === "admin_scopes" && v === null ? t("presets.full.label") : auditValue(v, word);

  if (rows.length === 0) {
    return <p className="mt-8 text-[13px] text-muted">{t("journal.empty")}</p>;
  }

  return (
    <div className="mt-4">
      <p className="text-[12px] text-subtle">{t("journal.hint")}</p>
      <ul className="mt-3 border-t border-border">
        {rows.map((r) => {
          const changes = auditChanges(r.before, r.after);
          const target =
            r.target_type === "profile" && r.target_id
              ? name.get(r.target_id) ?? r.target_id.slice(0, 8)
              : r.target_type === "setting" && r.target_id
                ? fieldLabel(r.target_id)
                : r.target_id ?? "";
          return (
            <li key={r.id} className="border-b border-border py-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12.5px]">
                <span className="font-semibold text-foreground">{actionLabel(r.action)}</span>
                {target && <span className="text-muted">· {target}</span>}
                <span className="ms-auto text-[11.5px] text-subtle">
                  {r.actor_id ? name.get(r.actor_id) ?? t("journal.someone") : t("journal.system")}
                  {" · "}
                  {formatDate(r.created_at, locale, "dateTime")}
                </span>
              </div>
              {changes.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {changes.map((c) => (
                    <li key={c.key} className="text-[12px] text-muted">
                      <span className="text-subtle">{fieldLabel(c.key)}</span>{" "}
                      <bdi>{value(c.key, c.from)}</bdi> <span aria-hidden className="inline-block rtl:-scale-x-100">→</span>{" "}
                      <bdi className="font-medium text-foreground">{value(c.key, c.to)}</bdi>
                    </li>
                  ))}
                </ul>
              )}
              {r.note && <p className="mt-1 text-[12px] italic text-muted">« {r.note} »</p>}
            </li>
          );
        })}
      </ul>
      <div className="mt-4">
        <AdminPager page={page} totalPages={totalPages} />
      </div>
    </div>
  );
}
