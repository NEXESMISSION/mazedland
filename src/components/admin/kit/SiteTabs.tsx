"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { NavIcon } from "./LinkPending";
import { useCanOpen } from "../AdminScopes";
import type { ConsoleSection } from "@/lib/admin/sections";
import {
  LayoutTemplate, MessageSquare, FileText, Bell, Settings2, Activity, UsersRound,
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

/** `key` names the label in `admin.siteTabs`; `section` is the team section (src/lib/admin/sections.ts). */
type Tab = { key: string; href: string; Icon: LucideIcon; section: ConsoleSection };

export const SITE_TABS: Tab[] = [
  { key: "home", href: "/admin/home", Icon: LayoutTemplate, section: "home" },
  { key: "popups", href: "/admin/popups", Icon: MessageSquare, section: "popups" },
  { key: "documents", href: "/admin/legal-docs", Icon: FileText, section: "legal-docs" },
  { key: "broadcasts", href: "/admin/notifications", Icon: Bell, section: "notifications" },
  { key: "settings", href: "/admin/settings", Icon: Settings2, section: "settings" },
  { key: "journal", href: "/admin/activity", Icon: Activity, section: "activity" },
  { key: "team", href: "/admin/equipe", Icon: UsersRound, section: "equipe" },
];

export function SiteTabs() {
  const pathname = usePathname();
  const t = useTranslations("admin.siteTabs");
  const canOpen = useCanOpen();

  return (
    <nav
      aria-label={t("label")}
      className="-mx-5 mb-6 flex items-center gap-5 overflow-x-auto border-b border-border px-5 lg:-mx-8 lg:px-8"
    >
      <Link
        href="/admin/site"
        className="shrink-0 py-2.5 text-[11px] font-bold uppercase tracking-[0.15em] text-subtle transition hover:text-foreground"
      >
        {t("site")}
      </Link>
      {SITE_TABS.filter((tab) => canOpen(tab.section)).map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href as "/admin"}
            aria-current={active ? "page" : undefined}
            className={`relative flex shrink-0 items-center gap-1.5 py-2.5 text-[12.5px] transition ${
              active
                ? "font-semibold text-[var(--gold)] after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[2px] after:bg-[var(--gold)]"
                : "font-medium text-subtle hover:text-foreground"
            }`}
          >
            <NavIcon Icon={tab.Icon} active={active} tone="inherit" size="size-3.5" />
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
