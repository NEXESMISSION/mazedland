"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import {
  Building2, Gavel, Wallet, Users, SlidersHorizontal,
  Home as HomeIcon, FileText, ListChecks, Bell, Inbox,
  ShieldCheck, Hammer, Banknote, Receipt, UserCheck,
  AlertTriangle, Settings2, LayoutTemplate, Sparkles,
  MessageSquare,
  LogOut, ExternalLink, type LucideIcon,
} from "lucide-react";

/**
 * Desktop-only admin sidebar — the same IA AdminTabs surfaces on
 * mobile, just expanded into a persistent tree instead of two rows
 * of horizontal chips. Hidden on `< lg` because the mobile shell
 * already renders AdminTabs above the content.
 *
 * Width is 260px to match the new wide layout — narrow enough that
 * the main canvas keeps comfortable line lengths on 13-inch laptops
 * and wide enough that hub labels never truncate.
 */
type SubItem = {
  label: string;
  href: string;
  Icon: LucideIcon;
  /** Honour ?status= when the same path serves multiple views. */
  matchStatus?: string | null;
};

type Group = {
  key: string;
  label: string;
  Icon: LucideIcon;
  items: SubItem[];
};

const GROUPS: Group[] = [
  {
    key: "annonces",
    label: "Annonces",
    Icon: Building2,
    items: [
      { label: "À valider",  href: "/admin/properties?status=pending_review", Icon: ListChecks, matchStatus: "pending_review" },
      { label: "En ligne",   href: "/admin/properties?status=ready",          Icon: ShieldCheck, matchStatus: "ready" },
      { label: "Vendues",    href: "/admin/properties?status=sold",           Icon: Hammer,      matchStatus: "sold" },
      { label: "Refusées",   href: "/admin/properties?status=rejected",       Icon: AlertTriangle, matchStatus: "rejected" },
      { label: "Toutes",     href: "/admin/properties",                       Icon: FileText,    matchStatus: null },
    ],
  },
  {
    key: "encheres",
    label: "Enchères",
    Icon: Gavel,
    items: [
      { label: "Cautions & remboursements", href: "/admin/deposits", Icon: Banknote },
    ],
  },
  {
    key: "finances",
    label: "Finances",
    Icon: Wallet,
    items: [
      { label: "Retraits", href: "/admin/payouts",  Icon: Banknote },
      { label: "Reçus",    href: "/admin/payments", Icon: Receipt },
    ],
  },
  {
    key: "personnes",
    label: "Personnes",
    Icon: Users,
    items: [
      { label: "KYC",          href: "/admin/kyc-queue",  Icon: UserCheck },
      { label: "Utilisateurs", href: "/admin/users",      Icon: Users },
      { label: "Inspecteurs",  href: "/admin/inspectors", Icon: ShieldCheck },
      { label: "Fraude",       href: "/admin/fraud",      Icon: AlertTriangle },
    ],
  },
  {
    key: "reglages",
    label: "Réglages",
    Icon: SlidersHorizontal,
    items: [
      { label: "Tarifs & caution",  href: "/admin/settings",        Icon: Settings2 },
      { label: "Accueil (vedette)", href: "/admin/home",            Icon: LayoutTemplate },
      { label: "Documents",         href: "/admin/legal-docs",      Icon: FileText },
      { label: "Caractéristiques",  href: "/admin/characteristics", Icon: Sparkles },
      { label: "Diffusions",        href: "/admin/notifications",   Icon: Bell },
      { label: "Popups",            href: "/admin/popups",          Icon: MessageSquare },
      { label: "Liste d'attente",   href: "/admin/waitlist",        Icon: Inbox },
    ],
  },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const status = search.get("status");

  function isActive(item: SubItem): boolean {
    const [path, query] = item.href.split("?");
    if (pathname !== path && !pathname.startsWith(path + "/")) return false;
    // Properties + status filter live on the same path — the active one
    // is the matchStatus that equals the current ?status.
    if (path === "/admin/properties") {
      const want = query ? new URLSearchParams(query).get("status") : null;
      return (want ?? null) === (status ?? null);
    }
    return !query || pathname === path;
  }

  return (
    <aside
      // `lg:hidden` would invert the mobile/desktop. We want it shown
      // ONLY on lg+: the mobile shell already paints AdminTabs.
      className="hidden lg:flex lg:sticky lg:top-0 lg:h-screen lg:w-[260px] lg:shrink-0 lg:flex-col lg:border-e lg:border-border lg:bg-surface"
    >
      <header className="flex items-center gap-2 border-b border-border px-5 py-5">
        <Link href="/admin" className="flex items-center gap-2">
          <span className="batta-gradient-gold grid size-9 place-items-center rounded-xl text-white shadow-[var(--shadow-gold)]">
            <HomeIcon className="size-4" strokeWidth={2.2} />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted">
              Batta · Admin
            </span>
            <span className="gradient-gold-text text-[15px] font-extrabold">Console</span>
          </span>
        </Link>
      </header>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {GROUPS.map((group, gi) => (
          <div key={group.key} className={gi > 0 ? "mt-5" : ""}>
            <div className="flex items-center gap-2 px-2 pb-1.5">
              <group.Icon className="size-3.5 text-[var(--gold)]" strokeWidth={2.2} />
              <span className="batta-eyebrow text-[10px]">{group.label}</span>
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href as "/admin/properties"}
                      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] font-semibold transition ${
                        active
                          ? "bg-[var(--gold)] text-white shadow-sm"
                          : "text-foreground/80 hover:bg-surface-2 hover:text-foreground"
                      }`}
                    >
                      <item.Icon
                        className={`size-3.5 shrink-0 ${active ? "text-white" : "text-muted"}`}
                        strokeWidth={2.2}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <footer className="border-t border-border px-3 py-3">
        <Link
          href="/"
          className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[12px] font-bold text-foreground/85 hover:bg-[var(--surface-3,#1a1a1a)]"
        >
          <span className="inline-flex items-center gap-2">
            <ExternalLink className="size-3.5" strokeWidth={2.2} />
            Sortir de l'admin
          </span>
          <LogOut className="size-3.5 text-muted" strokeWidth={2.2} />
        </Link>
      </footer>
    </aside>
  );
}
