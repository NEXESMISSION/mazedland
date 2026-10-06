import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatNumber } from "@/lib/utils";
import { AdminPage, EYEBROW } from "@/components/admin/kit";
import {
  LayoutTemplate, MessageSquare, FileText, Bell, Settings2, Activity,
  ArrowRight, type LucideIcon,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Site — the things you configure once and revisit monthly.
 *
 * These six screens each had a top-level sidebar entry, which put "changer le
 * texte des CGU" at the same level as "rembourser une caution". They are one
 * destination now.
 */

/** Each card's words live under `adminSite.cards.<key>`. */
type Card = {
  key: "home" | "popups" | "legalDocs" | "notifications" | "settings" | "activity";
  href: string;
  Icon: LucideIcon;
  /** Shown as `cards.<key>.count`, which only the counted cards have. */
  count?: number;
};

export default async function AdminSiteHub() {
  const t = await getTranslations("adminSite");
  const locale = await getLocale();
  const sb = await getServerSupabase();
  const head = (table: string) => sb.from(table).select("*", { count: "exact", head: true });

  const [popups, docs, notifs] = await Promise.all([
    head("popups"),
    head("legal_doc_kinds"),
    head("notifications"),
  ]);

  const n = (r: { count: number | null }) => r.count ?? 0;

  const cards: Card[] = [
    { key: "home", href: "/admin/home", Icon: LayoutTemplate },
    { key: "popups", href: "/admin/popups", Icon: MessageSquare, count: n(popups) },
    { key: "legalDocs", href: "/admin/legal-docs", Icon: FileText, count: n(docs) },
    { key: "notifications", href: "/admin/notifications", Icon: Bell, count: n(notifs) },
    { key: "settings", href: "/admin/settings", Icon: Settings2 },
    { key: "activity", href: "/admin/activity", Icon: Activity },
  ];

  return (
    <AdminPage>
      <header>
        <span className={EYEBROW}>{t("eyebrow")}</span>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-foreground">{t("title")}</h1>
        <p className="mt-1.5 max-w-xl text-[12.5px] text-subtle">{t("description")}</p>
      </header>

      <ul className="mt-7 border-t border-border">
        {cards.map((c) => (
          <li key={c.href}>
            <Link
              href={c.href as "/admin"}
              className="group flex items-start gap-4 border-b border-border py-3.5 transition hover:bg-[var(--row-hover)]"
            >
              <c.Icon
                className="mt-0.5 size-4 shrink-0 text-subtle transition group-hover:text-[var(--gold)]"
                strokeWidth={2}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-foreground">
                  {t(`cards.${c.key}.label`)}
                </span>
                <span className="mt-0.5 block text-[11.5px] text-subtle">
                  {t(`cards.${c.key}.description`)}
                </span>
              </span>
              {c.count != null && (
                <span className="mazed-tabular hidden shrink-0 text-[11.5px] text-subtle sm:block">
                  {t(`cards.${c.key}.count`, {
                    count: c.count,
                    formatted: formatNumber(c.count, locale),
                  })}
                </span>
              )}
              <ArrowRight
                className="mt-0.5 size-3.5 shrink-0 text-subtle transition group-hover:translate-x-0.5 group-hover:text-[var(--gold)] rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
                strokeWidth={2}
              />
            </Link>
          </li>
        ))}
      </ul>
    </AdminPage>
  );
}
