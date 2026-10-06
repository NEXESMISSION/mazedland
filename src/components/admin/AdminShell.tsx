"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import {
  LayoutDashboard, Inbox, Receipt, Tag, Users, FolderTree,
  SlidersHorizontal, ExternalLink, Menu, X,
  type LucideIcon,
} from "lucide-react";
import { NavIcon } from "./kit/LinkPending";

/**
 * Console navigation.
 *
 * Mazed Immo was an auction house. It is a classifieds platform now, and this rail
 * is where that decision becomes visible: the console is the same six
 * destinations Mazed Auto has, in the same order, plus Site.
 *
 * The auction screens — Biens & lots, Cautions, KYC, Inspecteurs,
 * Caractéristiques — are gone, along with the tables behind them. A
 * `SETTLEMENT` entry lived here for one release, shown only while cautions
 * were still outstanding, because deleting a screen is reversible and deleting
 * the money it settles is not. Measuring settled it: there had never been a
 * single bid, and the only three "bidders" were the operator's own accounts.
 */

type Item = {
  /** Names the label in `admin.nav`; its tooltip is `${key}Hint`. */
  key: string;
  href: string;
  Icon: LucideIcon;
  /** Key into the `counts` map — a badge for work that is waiting. */
  countKey?: CountKey;
};

export type CountKey = "annonces" | "paiements";
export type AdminCounts = Partial<Record<CountKey, number>>;

const NAV: Item[] = [
  { key: "dashboard", href: "/admin", Icon: LayoutDashboard },
  { key: "listings", href: "/admin/annonces", Icon: Inbox, countKey: "annonces" },
  { key: "payments", href: "/admin/paiements", Icon: Receipt, countKey: "paiements" },
  { key: "offers", href: "/admin/offres", Icon: Tag },
  { key: "sellers", href: "/admin/vendeurs", Icon: Users },
  { key: "catalogue", href: "/admin/catalogue", Icon: FolderTree },
];


const SITE: Item = { key: "site", href: "/admin/site", Icon: SlidersHorizontal };

function BrandMark({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations("admin");
  return (
    <Link href="/admin" onClick={onNavigate} className="flex items-center gap-2.5">
      {/* The mark, not a house glyph. The glyph was standing in for a logo
          the product had no usable file of; it has one now, and the console
          should be recognisably the same product as the site. */}
      <Image src="/logo-mark.webp" alt="" width={127} height={160} className="h-5 w-auto" />
      <span className="text-[12px] font-bold uppercase tracking-[0.16em] text-foreground">
        Mazed Immo<span className="text-[var(--gold)]">{" "}{t("console")}</span>
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
  const t = useTranslations("admin.nav");

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
          title={t(`${item.key}Hint`)}
          className={`relative flex items-center gap-2.5 py-[7px] ps-4 pe-3 text-[13px] font-medium transition ${
            active
              ? "text-[var(--gold)] before:absolute before:inset-y-0 before:start-0 before:w-[2px] before:bg-[var(--gold)]"
              : "text-muted hover:text-foreground"
          }`}
        >
          <NavIcon Icon={item.Icon} active={active} />
          <span className="truncate">{t(item.key)}</span>
          {count > 0 && (
            <span
              className={`mazed-tabular ms-auto text-[11px] font-bold ${
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
        {render(SITE)}
      </ul>
    </nav>
  );
}

function ExitLink({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations("admin.nav");
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className="flex items-center gap-2.5 px-4 py-[7px] text-[12.5px] font-medium text-subtle transition hover:text-foreground"
    >
      <ExternalLink className="size-4 shrink-0" strokeWidth={2} />
      {t("exit")}
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
  const t = useTranslations("admin.nav");
  const [open, setOpen] = useState(false);

  // Close the drawer when the route changes. During render, not in an effect:
  // the new screen's first paint already has the drawer shut, instead of
  // showing it over the new page for a frame.
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setOpen(false);
  }

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
          aria-label={t("openMenu")}
          aria-expanded={open}
          className="tap-target grid size-9 place-items-center rounded text-muted transition hover:text-foreground"
        >
          <Menu className="size-5" strokeWidth={2.2} />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t("label")}>
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
                aria-label={t("closeMenu")}
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
