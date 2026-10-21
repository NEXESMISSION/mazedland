import { getLocale, getTranslations } from "next-intl/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { formatNumber, formatTND, intlTag } from "@/lib/utils";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Résultats — what the platform produced, month by month, on one page.
 *
 * The question it answers is the operator's: is this worth what it costs?
 * Supply (annonces published), reach (views, new accounts), the outcome a
 * seller pays for (phone numbers shown to buyers) and the money in. Six months,
 * newest first, from the same tables the site writes as it runs — nothing here
 * is entered by hand.
 */
const MONTHS = 6;
const TZ_OFFSET_MS = 3_600_000; // Tunisia is UTC+1 all year.

/** The current moment shifted to Tunisian wall-clock time. A page rendered per
 *  request (force-dynamic) reads the clock once, here. */
function tunisNow(): Date {
  return new Date(Date.now() + TZ_OFFSET_MS);
}

/** "2026-10" for a timestamp, in Tunisian time. */
const monthKey = (iso: string) => new Date(new Date(iso).getTime() + TZ_OFFSET_MS).toISOString().slice(0, 7);

type Month = {
  key: string;
  published: number;
  accounts: number;
  views: number;
  reveals: number;
  revenue: number;
};

export default async function AdminResults() {
  const t = await getTranslations("adminResults");
  const locale = await getLocale();
  const admin = getServiceSupabase();
  if (!admin) return <p className="p-6 text-[13px] text-muted">{t("unavailable")}</p>;

  // The first day of the oldest month shown, in Tunisian time.
  const now = tunisNow();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS - 1), 1) - TZ_OFFSET_MS);
  const since = start.toISOString();

  const keys: string[] = [];
  for (let i = 0; i < MONTHS; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(d.toISOString().slice(0, 7));
  }
  const months = new Map<string, Month>(
    keys.map((key) => [key, { key, published: 0, accounts: 0, views: 0, reveals: 0, revenue: 0 }]),
  );
  const bump = (iso: string | null, field: keyof Omit<Month, "key">, by = 1) => {
    if (!iso) return;
    const m = months.get(monthKey(iso));
    if (m) m[field] += by;
  };

  const [published, accounts, views, reveals, payments, liveNow, waitingNow, accountsTotal] = await Promise.all([
    admin.from("listings").select("published_at").gte("published_at", since),
    admin.from("profiles").select("created_at").gte("created_at", since),
    admin.from("listing_views").select("first_seen_at, view_count").gte("first_seen_at", since),
    admin.from("contact_reveals").select("created_at").gte("created_at", since),
    admin
      .from("payments")
      .select("amount, kind, reviewed_at, updated_at")
      .eq("status", "captured")
      .gte("updated_at", since),
    admin.from("listings").select("id", { count: "exact", head: true }).eq("status", "published"),
    admin.from("listings").select("id", { count: "exact", head: true }).eq("status", "pending_review"),
    admin.from("profiles").select("id", { count: "exact", head: true }),
  ]);

  for (const r of published.data ?? []) bump(r.published_at as string, "published");
  for (const r of accounts.data ?? []) bump(r.created_at as string, "accounts");
  // A row is one visitor on one annonce; view_count is how many times they
  // opened it. Views are the sum — what "seen" means to a seller.
  for (const r of views.data ?? []) bump(r.first_seen_at as string, "views", Number(r.view_count) || 1);
  for (const r of reveals.data ?? []) bump(r.created_at as string, "reveals");

  const revenueByKind = new Map<string, number>();
  for (const p of payments.data ?? []) {
    const when = (p.reviewed_at as string | null) ?? (p.updated_at as string);
    const amount = Number(p.amount) || 0;
    bump(when, "revenue", amount);
    if (months.has(monthKey(when))) {
      revenueByKind.set(p.kind as string, (revenueByKind.get(p.kind as string) ?? 0) + amount);
    }
  }

  const rows = keys.map((k) => months.get(k)!);
  const current = rows[0];
  const monthLabel = (key: string) =>
    new Date(`${key}-15T12:00:00Z`).toLocaleDateString(intlTag(locale), { month: "long", year: "numeric" });
  const money = (n: number) => `${formatTND(n, locale)} ${t("tnd")}`;
  const kindLabel = (k: string) => (t.has(`kinds.${k}`) ? t(`kinds.${k}`) : k);

  const cards = [
    { label: t("liveNow"), value: formatNumber(liveNow.count ?? 0, locale) },
    { label: t("waitingNow"), value: formatNumber(waitingNow.count ?? 0, locale) },
    { label: t("accountsTotal"), value: formatNumber(accountsTotal.count ?? 0, locale) },
    { label: t("revenueThisMonth"), value: money(current.revenue) },
  ];

  return (
    <div>
      <AdminPageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl bg-surface p-4 ring-1 ring-border">
            <p className="text-[11.5px] font-semibold text-muted">{c.label}</p>
            <p className="mazed-tabular mt-1 text-[22px] font-extrabold text-foreground">{c.value}</p>
          </div>
        ))}
      </div>

      <section className="mt-6 overflow-x-auto rounded-2xl bg-surface ring-1 ring-border">
        <table className="w-full min-w-[640px] text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-start text-[11px] text-muted">
              <th className="px-4 py-3 text-start font-semibold">{t("cols.month")}</th>
              <th className="px-4 py-3 text-end font-semibold">{t("cols.published")}</th>
              <th className="px-4 py-3 text-end font-semibold">{t("cols.accounts")}</th>
              <th className="px-4 py-3 text-end font-semibold">{t("cols.views")}</th>
              <th className="px-4 py-3 text-end font-semibold">{t("cols.reveals")}</th>
              <th className="px-4 py-3 text-end font-semibold">{t("cols.revenue")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.key} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-semibold text-foreground">{monthLabel(m.key)}</td>
                <td className="mazed-tabular px-4 py-3 text-end">{formatNumber(m.published, locale)}</td>
                <td className="mazed-tabular px-4 py-3 text-end">{formatNumber(m.accounts, locale)}</td>
                <td className="mazed-tabular px-4 py-3 text-end">{formatNumber(m.views, locale)}</td>
                <td className="mazed-tabular px-4 py-3 text-end">{formatNumber(m.reveals, locale)}</td>
                <td className="mazed-tabular px-4 py-3 text-end font-bold text-foreground">{money(m.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6 rounded-2xl bg-surface p-4 ring-1 ring-border">
        <h3 className="text-[14px] font-bold text-foreground">{t("byKindTitle")}</h3>
        {revenueByKind.size === 0 ? (
          <p className="mt-2 text-[12.5px] text-muted">{t("noRevenue")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {[...revenueByKind.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([kind, amount]) => (
                <li key={kind} className="flex items-center justify-between py-2 text-[12.5px]">
                  <span className="text-foreground">{kindLabel(kind)}</span>
                  <span className="mazed-tabular font-bold text-foreground">{money(amount)}</span>
                </li>
              ))}
          </ul>
        )}
        <p className="mt-3 text-[11.5px] text-muted">{t("note")}</p>
      </section>
    </div>
  );
}
