"use client";

import { useEffect, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import {
  LayoutDashboard, Receipt, Users, SlidersHorizontal, ExternalLink,
  Menu, X, Building2, Gavel, Banknote, UserCheck, ShieldCheck, Home,
  type LucideIcon,
} from "lucide-react";
import { NavIcon } from "./kit/LinkPending";

/**
 * Console navigation — the same shell Mazed Auto uses, with one structural
 * difference that is not cosmetic.
 *
 * Auto could delete its auction console outright: every auction table there
 * read zero rows, so the screens had no users and no money behind them. Land
 * cannot. Measured 2026-09-07: **18 live auctions, 6 scheduled, 24 ending in
 * the future, and 17 deposit payments of which 8 are captured** — money held
 * against lots that have not settled, plus 50 KYC submissions and 4 inspectors.
 *
 * So the rail is deliberately two things at once: the classifieds console
 * being built, and the auction console that is still running a live product.
 * The second group disappears when the last lot settles and the deposits are
 * resolved — not before, and not on a date. Removing it early would strand a
 * bidder and hide money we are holding.
 *
 * Destinations that do not exist yet (Annonces, Offres & prix, Catalogue) are
 * absent rather than present-and-broken: a menu that leads somewhere empty is
 * how you teach an operator to distrust the menu.
 */

type Item = {
  label: string;
  href: string;
  Icon: LucideIcon;
  hint: string;
  countKey?: CountKey;
};

export type CountKey = "paiements" | "cautions" | "kyc" | "lots";
export type AdminCounts = Partial<Record<CountKey, number>>;

/** The classifieds console. Grows as the pivot lands. */
const CONSOLE: Item[] = [
  {
    label: "Tableau de bord",
    href: "/admin",
    Icon: LayoutDashboard,
    hint: "Ce qui attend une décision",
  },
  {
    label: "Paiements",
    href: "/admin/payments",
    Icon: Receipt,
    hint: "Reçus à valider",
    countKey: "paiements",
  },
  {
    label: "Vendeurs",
    href: "/admin/users",
    Icon: Users,
    hint: "Comptes, rôles",
  },
];

/**
 * The auction product, still live. Temporary by design — see the note above.
 */
const AUCTION: Item[] = [
  {
    label: "Biens & lots",
    href: "/admin/properties",
    Icon: Building2,
    hint: "Annonces immobilières à valider",
    countKey: "lots",
  },
  {
    label: "Cautions",
    href: "/admin/deposits",
    Icon: Banknote,
    hint: "Cautions à rembourser",
    countKey: "cautions",
  },
  {
    label: "KYC",
    href: "/admin/kyc-queue",
    Icon: UserCheck,
    hint: "Identités à vérifier",
    countKey: "kyc",
  },
  {
    label: "Inspecteurs",
    href: "/admin/inspectors",
    Icon: ShieldCheck,
    hint: "Réseau d'experts",
  },
];

const SITE: Item = {
  label: "Site",
  href: "/admin/site",
  Icon: SlidersHorizontal,
  hint: "Accueil, popups, documents, diffusions, réglages, journal",
};

function BrandMark({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link href="/admin" onClick={onNavigate} className="flex items-center gap-2.5">
      <Home className="size-4 text-[var(--gold)]" strokeWidth={2.2} />
      <span className="text-[12px] font-bold uppercase tracking-[0.16em] text-foreground">
        Batta<span className="text-[var(--gold)]"> Console</span>
      </span>
    </Link>
  );
}

function NavList({
  counts,
  onNavigate,
}: {
  counts: AdminCounts;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  // `/admin` must match exactly — every other route starts with it, so a
  // prefix test lights the dashboard up on every single screen.
  const isActive = (href: string) =>
    href === "/admin"
      ? pathname === "/admin"
      : pathname === href || pathname.startsWith(`${href}/`);

  const render = (item: Item) => {
    const active = isActive(item.href);
    const count = item.countKey ? counts[item.countKey] ?? 0 : 0;
    return (
      <li key={item.href}>
        <Link
          href={item.href as "/admin"}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          title={item.hint}
          className={`relative flex items-center gap-2.5 py-[7px] ps-4 pe-3 text-[13px] font-medium transition ${
            active
              ? "text-[var(--gold)] before:absolute before:inset-y-0 before:start-0 before:w-[2px] before:bg-[var(--gold)]"
              : "text-muted hover:text-foreground"
          }`}
        >
          <NavIcon Icon={item.Icon} active={active} />
          <span className="truncate">{item.label}</span>
          {count > 0 && (
            <span
              className={`batta-tabular ms-auto text-[11px] font-bold ${
                active ? "text-[var(--gold)]" : "text-[var(--tone-warn)]"
              }`}
            >
              {count}
            </span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <nav className="min-h-0 flex-1 overflow-y-auto py-3">
      <ul>{CONSOLE.map(render)}</ul>

      <div className="mt-4 border-t border-border pt-3">
        <div className="flex items-center gap-1.5 px-4 pb-1 text-[10px] font-bold uppercase tracking-[0.15em] text-subtle">
          <Gavel className="size-3" strokeWidth={2.2} />
          Enchères
        </div>
        <ul>{AUCTION.map(render)}</ul>
      </div>

      <ul className="mt-4 border-t border-border pt-3">{render(SITE)}</ul>
    </nav>
  );
}

function ExitLink({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className="flex items-center gap-2.5 px-4 py-[7px] text-[12.5px] font-medium text-subtle transition hover:text-foreground"
    >
      <ExternalLink className="size-4 shrink-0" strokeWidth={2} />
      Quitter l&apos;admin
    </Link>
  );
}

/** Sticky rail — desktop only. */
export function AdminRail({ counts }: { counts: AdminCounts }) {
  return (
    <aside className="hidden h-dvh w-[196px] shrink-0 flex-col border-e border-border lg:flex">
      <header className="flex h-12 items-center border-b border-border px-4">
        <BrandMark />
      </header>
      <NavList counts={counts} />
      <footer className="border-t border-border py-2">
        <ExitLink />
      </footer>
    </aside>
  );
}

/** Top bar + slide-over drawer — below lg. */
export function AdminMobileBar({ counts }: { counts: AdminCounts }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-4">
        <BrandMark />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ouvrir le menu"
          aria-expanded={open}
          className="tap-target grid size-9 place-items-center rounded text-muted transition hover:text-foreground"
        >
          <Menu className="size-5" strokeWidth={2.2} />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Navigation admin">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 start-0 flex w-[240px] max-w-[85vw] flex-col border-e border-border bg-background animate-fade-in">
            <header className="flex h-12 items-center justify-between border-b border-border px-4">
              <BrandMark onNavigate={() => setOpen(false)} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer le menu"
                className="tap-target grid size-8 place-items-center rounded text-muted transition hover:text-foreground"
              >
                <X className="size-5" strokeWidth={2.2} />
              </button>
            </header>
            <NavList counts={counts} onNavigate={() => setOpen(false)} />
            <footer className="border-t border-border py-2">
              <ExitLink onNavigate={() => setOpen(false)} />
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
