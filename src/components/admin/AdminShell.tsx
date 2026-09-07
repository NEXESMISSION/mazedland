"use client";

import { useEffect, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import {
  LayoutDashboard, Inbox, Receipt, Tag, Users, FolderTree,
  SlidersHorizontal, ExternalLink, Menu, X, Home, Banknote,
  type LucideIcon,
} from "lucide-react";
import { NavIcon } from "./kit/LinkPending";

/**
 * Console navigation.
 *
 * Batta was an auction house. It is a classifieds platform now, and this rail
 * is where that decision becomes visible: the console is the same six
 * destinations Mazed Auto has, in the same order, plus Site.
 *
 * The auction screens are not linked from here any more — Biens & lots,
 * Cautions, KYC, Inspecteurs, Caractéristiques. They are not deleted either,
 * and that distinction is the whole reason this comment exists. Measured
 * 2026-09-07, the auction tables still hold **295 auctions, 7 cautions of
 * which 8 payments were captured, 50 KYC dossiers and 4 inspectors**. Deleting
 * a screen is reversible; deleting the money it settles is not.
 *
 * So there is exactly one auction remnant in this file: `SETTLEMENT`, which
 * appears ONLY while cautions are still outstanding and removes itself the
 * moment that count reaches zero. It is not a section, it has no group header,
 * and nobody has to decide when to take it out — it leaves on its own. A
 * console that hides money we are holding would be worse than a console with
 * one extra line in it.
 */

type Item = {
  label: string;
  href: string;
  Icon: LucideIcon;
  hint: string;
  /** Key into the `counts` map — a badge for work that is waiting. */
  countKey?: CountKey;
};

export type CountKey = "annonces" | "paiements" | "cautions";
export type AdminCounts = Partial<Record<CountKey, number>>;

const NAV: Item[] = [
  {
    label: "Tableau de bord",
    href: "/admin",
    Icon: LayoutDashboard,
    hint: "Ce qui attend une décision",
  },
  {
    label: "Annonces",
    href: "/admin/annonces",
    Icon: Inbox,
    hint: "Modérer, créer, mettre en avant",
    countKey: "annonces",
  },
  {
    label: "Paiements",
    href: "/admin/paiements",
    Icon: Receipt,
    hint: "Reçus à valider",
    countKey: "paiements",
  },
  {
    label: "Offres & prix",
    href: "/admin/offres",
    Icon: Tag,
    hint: "Annonces, packs, mises en avant, badge",
  },
  {
    label: "Vendeurs",
    href: "/admin/vendeurs",
    Icon: Users,
    hint: "Comptes, rôles, badges",
  },
  {
    label: "Catalogue",
    href: "/admin/catalogue",
    Icon: FolderTree,
    hint: "Catégories et caractéristiques",
  },
];

/**
 * The last auction link standing. Rendered only while `counts.cautions > 0`,
 * so it disappears for good once every caution is refunded or forfeited.
 */
const SETTLEMENT: Item = {
  label: "Cautions à solder",
  href: "/admin/deposits",
  Icon: Banknote,
  hint: "Reliquat des enchères — disparaît une fois tout remboursé",
  countKey: "cautions",
};

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
      <ul>{NAV.map(render)}</ul>

      <ul className="mt-4 border-t border-border pt-3">
        {(counts.cautions ?? 0) > 0 && render(SETTLEMENT)}
        {render(SITE)}
      </ul>
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
