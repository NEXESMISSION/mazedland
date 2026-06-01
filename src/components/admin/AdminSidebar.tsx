"use client";

import { Link, usePathname } from "@/i18n/navigation";
import {
  Building2, Banknote, Wallet, Receipt, UserCheck, Users,
  ShieldCheck, Settings2, LayoutTemplate, FileText,
  Sparkles, Bell, MessageSquare, Inbox, Home as HomeIcon,
  LayoutDashboard, ExternalLink, HandCoins, Activity, type LucideIcon,
} from "lucide-react";

/**
 * Admin console navigation — the single source of nav for /admin (the
 * consumer chrome is suppressed for admin routes). One clean link per
 * destination under four plain section labels; in-page tabs handle
 * sub-views (e.g. property status), so the rail itself stays minimal.
 */
type Item = { label: string; href: string; Icon: LucideIcon };
type Group = { label: string; items: Item[] };

const GROUPS: Group[] = [
  {
    label: "Enchères",
    items: [
      { label: "Création d'enchères", href: "/admin/properties", Icon: Building2 },
      { label: "Paiements", href: "/admin/payments", Icon: Receipt },
      { label: "Remboursements", href: "/admin/deposits", Icon: Banknote },
    ],
  },
  {
    label: "Argent",
    items: [
      { label: "Paiements vendeurs", href: "/admin/payouts", Icon: Wallet },
      { label: "Paiement manuel", href: "/admin/manual-payment", Icon: HandCoins },
    ],
  },
  {
    label: "Personnes",
    items: [
      { label: "KYC", href: "/admin/kyc-queue", Icon: UserCheck },
      { label: "Utilisateurs", href: "/admin/users", Icon: Users },
      { label: "Inspecteurs", href: "/admin/inspectors", Icon: ShieldCheck },
    ],
  },
  {
    label: "Système",
    items: [
      { label: "Réglages", href: "/admin/settings", Icon: Settings2 },
      { label: "Accueil", href: "/admin/home", Icon: LayoutTemplate },
      { label: "Documents", href: "/admin/legal-docs", Icon: FileText },
      { label: "Caractéristiques", href: "/admin/characteristics", Icon: Sparkles },
      { label: "Diffusions", href: "/admin/notifications", Icon: Bell },
      { label: "Popups", href: "/admin/popups", Icon: MessageSquare },
      { label: "Liste d'attente", href: "/admin/waitlist", Icon: Inbox },
      { label: "Journal d'activité", href: "/admin/activity", Icon: Activity },
    ],
  },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="sticky top-0 flex h-screen w-[248px] shrink-0 flex-col border-e border-border bg-surface">
      <header className="flex items-center border-b border-border px-5 py-5">
        <Link href="/admin" className="flex items-center gap-2.5">
          <span className="batta-gradient-gold grid size-9 place-items-center rounded-xl text-white shadow-[var(--shadow-gold)]">
            <HomeIcon className="size-4" strokeWidth={2.2} />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted">
              Batta
            </span>
            <span className="gradient-gold-text text-[15px] font-extrabold">Console</span>
          </span>
        </Link>
      </header>

      <nav className="flex-1 overflow-y-auto px-3 py-5">
        <Link
          href="/admin"
          aria-current={pathname === "/admin" ? "page" : undefined}
          className={`mb-4 flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-semibold transition ${
            pathname === "/admin"
              ? "bg-[var(--gold)] text-white"
              : "text-muted hover:bg-surface-2 hover:text-foreground"
          }`}
        >
          <LayoutDashboard className={`size-4 shrink-0 ${pathname === "/admin" ? "text-white" : "text-muted"}`} strokeWidth={2} />
          <span className="truncate">Tableau de bord</span>
        </Link>

        {GROUPS.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? "mt-7" : ""}>
            <div className="px-2.5 pb-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted">
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href as "/admin/properties"}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-semibold transition ${
                        active
                          ? "bg-[var(--gold)] text-white"
                          : "text-muted hover:bg-surface-2 hover:text-foreground"
                      }`}
                    >
                      <item.Icon
                        className={`size-4 shrink-0 ${active ? "text-white" : "text-muted"}`}
                        strokeWidth={2}
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
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] font-semibold text-muted transition hover:bg-surface-2 hover:text-foreground"
        >
          <ExternalLink className="size-4 shrink-0" strokeWidth={2} />
          Quitter l&apos;admin
        </Link>
      </footer>
    </aside>
  );
}
