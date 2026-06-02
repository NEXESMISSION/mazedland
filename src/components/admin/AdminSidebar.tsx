"use client";

import { useEffect, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import {
  Building2, Banknote, Wallet, Receipt, UserCheck, Users,
  ShieldCheck, Settings2, LayoutTemplate, FileText,
  Sparkles, Bell, MessageSquare, Inbox, Home as HomeIcon,
  LayoutDashboard, ExternalLink, HandCoins, Activity, Menu, X,
  type LucideIcon,
} from "lucide-react";

/**
 * Admin console navigation. One source of truth for the link set (GROUPS),
 * rendered two ways:
 *   - <AdminSidebar/>   — the sticky left rail on desktop (hidden lg:flex)
 *   - <AdminMobileBar/> — a top bar + slide-over drawer below lg, so the
 *                         console is fully usable on phones/tablets (the rail
 *                         used to be a fixed 248px with no responsive
 *                         treatment, eating ~66% of a 375px screen).
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

function BrandMark() {
  return (
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
  );
}

/** The link list — shared between the desktop rail and the mobile drawer. */
function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-5">
      <Link
        href="/admin"
        onClick={onNavigate}
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
                    onClick={onNavigate}
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
  );
}

function ExitLink({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] font-semibold text-muted transition hover:bg-surface-2 hover:text-foreground"
    >
      <ExternalLink className="size-4 shrink-0" strokeWidth={2} />
      Quitter l&apos;admin
    </Link>
  );
}

/** Desktop rail — hidden below lg (the mobile bar + drawer take over there). */
export function AdminSidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-e border-border bg-surface lg:flex">
      <header className="flex items-center border-b border-border px-5 py-5">
        <BrandMark />
      </header>
      <NavLinks />
      <footer className="border-t border-border px-3 py-3">
        <ExitLink />
      </footer>
    </aside>
  );
}

/** Mobile/tablet top bar + slide-over drawer — shown below lg only. */
export function AdminMobileBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the drawer whenever the route changes (a link was tapped).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape to close + lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-surface/95 px-4 backdrop-blur-md">
        <BrandMark />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ouvrir le menu"
          aria-expanded={open}
          className="tap-target grid size-10 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-foreground"
        >
          <Menu className="size-5" strokeWidth={2.2} />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Navigation admin">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 start-0 flex w-[280px] max-w-[85vw] flex-col border-e border-border bg-surface shadow-[var(--shadow-lg)] animate-fade-in">
            <header className="flex items-center justify-between border-b border-border px-4 py-4">
              <BrandMark />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer le menu"
                className="tap-target grid size-9 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground"
              >
                <X className="size-5" strokeWidth={2.2} />
              </button>
            </header>
            <NavLinks onNavigate={() => setOpen(false)} />
            <footer className="border-t border-border px-3 py-3">
              <ExitLink onNavigate={() => setOpen(false)} />
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
