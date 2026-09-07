"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { NavIcon } from "./LinkPending";
import {
  LayoutTemplate, MessageSquare, FileText, Bell, Settings2, Activity,
  type LucideIcon,
} from "lucide-react";

/**
 * The Site section's own navigation.
 *
 * These six screens each had a top-level sidebar entry, which put "changer le
 * texte des CGU" at the same level as "valider les annonces du jour". They are
 * one destination now, and this is how you move between them without going
 * back out to a hub every time.
 *
 * Underlined text, not filled pills — the same vocabulary as the queue filters,
 * so a tab is a tab everywhere in the console.
 */

type Tab = { label: string; href: string; Icon: LucideIcon };

const TABS: Tab[] = [
  { label: "Accueil", href: "/admin/home", Icon: LayoutTemplate },
  { label: "Popups", href: "/admin/popups", Icon: MessageSquare },
  { label: "Documents", href: "/admin/legal-docs", Icon: FileText },
  { label: "Diffusions", href: "/admin/notifications", Icon: Bell },
  { label: "Réglages", href: "/admin/settings", Icon: Settings2 },
  { label: "Journal", href: "/admin/activity", Icon: Activity },
];

export function SiteTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Sections du site"
      className="-mx-5 mb-6 flex items-center gap-5 overflow-x-auto border-b border-border px-5 lg:-mx-8 lg:px-8"
    >
      <Link
        href="/admin/site"
        className="shrink-0 py-2.5 text-[11px] font-bold uppercase tracking-[0.15em] text-subtle transition hover:text-foreground"
      >
        Site
      </Link>
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href as "/admin"}
            aria-current={active ? "page" : undefined}
            className={`relative flex shrink-0 items-center gap-1.5 py-2.5 text-[12.5px] transition ${
              active
                ? "font-semibold text-[var(--gold)] after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[2px] after:bg-[var(--gold)]"
                : "font-medium text-subtle hover:text-foreground"
            }`}
          >
            <NavIcon Icon={t.Icon} active={active} tone="inherit" size="size-3.5" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
