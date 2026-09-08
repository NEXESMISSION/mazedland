import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
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

type Card = {
  label: string;
  href: string;
  Icon: LucideIcon;
  description: string;
  count?: number;
  unit?: string;
};

export default async function AdminSiteHub() {
  const sb = await getServerSupabase();
  const head = (t: string) => sb.from(t).select("*", { count: "exact", head: true });

  const [popups, docs, notifs] = await Promise.all([
    head("popups"),
    head("legal_doc_kinds"),
    head("notifications"),
  ]);

  const n = (r: { count: number | null }) => r.count ?? 0;

  const cards: Card[] = [
    {
      label: "Accueil",
      href: "/admin/home",
      Icon: LayoutTemplate,
      description: "Choisir ce qui est mis en avant sur la page d'accueil.",
    },
    {
      label: "Popups",
      href: "/admin/popups",
      Icon: MessageSquare,
      description: "Messages affichés aux visiteurs, avec ciblage et planning.",
      count: n(popups),
      unit: "configurés",
    },
    {
      label: "Documents légaux",
      href: "/admin/legal-docs",
      Icon: FileText,
      description: "CGU, confidentialité, mentions — le texte publié sur le site.",
      count: n(docs),
      unit: "documents",
    },
    {
      label: "Diffusions",
      href: "/admin/notifications",
      Icon: Bell,
      description: "Notifications envoyées aux vendeurs et aux acheteurs.",
      count: n(notifs),
      unit: "envoyées",
    },
    {
      label: "Réglages",
      href: "/admin/settings",
      Icon: Settings2,
      description: "Coordonnées bancaires, cautions, délais.",
    },
    {
      label: "Journal d'activité",
      href: "/admin/activity",
      Icon: Activity,
      description: "Qui a fait quoi, et quand. La trace d'audit de la console.",
    },
  ];

  return (
    <AdminPage>
      <header>
        <span className={EYEBROW}>Console</span>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-foreground">Site</h1>
        <p className="mt-1.5 max-w-xl text-[12.5px] text-subtle">
          Le contenu et la configuration du site public. Ce que l'on règle une fois, puis rarement.
        </p>
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
                <span className="block text-[13px] font-medium text-foreground">{c.label}</span>
                <span className="mt-0.5 block text-[11.5px] text-subtle">{c.description}</span>
              </span>
              {c.count != null && (
                <span className="mazed-tabular hidden shrink-0 text-[11.5px] text-subtle sm:block">
                  {c.count.toLocaleString("fr-FR")} {c.unit}
                </span>
              )}
              <ArrowRight
                className="mt-0.5 size-3.5 shrink-0 text-subtle transition group-hover:translate-x-0.5 group-hover:text-[var(--gold)]"
                strokeWidth={2}
              />
            </Link>
          </li>
        ))}
      </ul>
    </AdminPage>
  );
}
