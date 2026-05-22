"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import {
  Building2, Gavel, Wallet, Users, SlidersHorizontal,
} from "lucide-react";

/**
 * The whole admin information architecture, in one place. Five top-level
 * hubs; each opens a contextual sub-tab row so the 14 underlying surfaces
 * are reachable in two clicks without a wall of chips.
 */
type Tab = { label: string; href: string };
type Group = {
  key: string;
  label: string;
  Icon: typeof Building2;
  /** Path prefixes that mark this group active. */
  members: string[];
  /** Default destination when the chip is tapped. */
  home: string;
  tabs: Tab[];
};

const GROUPS: Group[] = [
  {
    key: "annonces",
    label: "Annonces",
    Icon: Building2,
    members: ["/admin/properties", "/admin"],
    home: "/admin/properties?status=pending_review",
    tabs: [
      { label: "À valider", href: "/admin/properties?status=pending_review" },
      { label: "En ligne", href: "/admin/properties?status=ready" },
      { label: "Vendues", href: "/admin/properties?status=sold" },
      { label: "Refusées", href: "/admin/properties?status=rejected" },
      { label: "Toutes", href: "/admin/properties" },
    ],
  },
  {
    key: "encheres",
    label: "Enchères",
    Icon: Gavel,
    members: ["/admin/deposits"],
    home: "/admin/deposits",
    tabs: [{ label: "Cautions & remboursements", href: "/admin/deposits" }],
  },
  {
    key: "finances",
    label: "Finances",
    Icon: Wallet,
    members: ["/admin/payouts", "/admin/payments"],
    home: "/admin/payouts",
    tabs: [
      { label: "Retraits", href: "/admin/payouts" },
      { label: "Reçus", href: "/admin/payments" },
    ],
  },
  {
    key: "personnes",
    label: "Personnes",
    Icon: Users,
    members: ["/admin/kyc-queue", "/admin/users", "/admin/inspectors", "/admin/fraud"],
    home: "/admin/kyc-queue",
    tabs: [
      { label: "KYC", href: "/admin/kyc-queue" },
      { label: "Utilisateurs", href: "/admin/users" },
      { label: "Inspecteurs", href: "/admin/inspectors" },
      { label: "Fraude", href: "/admin/fraud" },
    ],
  },
  {
    key: "reglages",
    label: "Réglages",
    Icon: SlidersHorizontal,
    members: [
      "/admin/settings", "/admin/home", "/admin/legal-docs",
      "/admin/characteristics", "/admin/notifications", "/admin/waitlist",
    ],
    home: "/admin/settings",
    tabs: [
      { label: "Tarifs & caution", href: "/admin/settings" },
      { label: "Accueil (vedette)", href: "/admin/home" },
      { label: "Documents", href: "/admin/legal-docs" },
      { label: "Caractéristiques", href: "/admin/characteristics" },
      { label: "Diffusions", href: "/admin/notifications" },
      { label: "Liste d'attente", href: "/admin/waitlist" },
    ],
  },
];

const chipBase =
  "tap-target inline-flex shrink-0 snap-start items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] transition active:scale-[0.97]";

export function AdminTabs() {
  const pathname = usePathname(); // locale-stripped, e.g. /admin/properties
  const search = useSearchParams();
  const status = search.get("status");

  const active =
    GROUPS.find((g) => g.members.some((m) => pathname === m || pathname.startsWith(m + "/") || pathname.startsWith(m + "?") || pathname === m))
    ?? (pathname === "/admin" ? GROUPS[0] : undefined)
    ?? GROUPS.find((g) => g.members.includes(pathname));

  const group = active ?? GROUPS[0];

  function tabActive(href: string): boolean {
    const [path, query] = href.split("?");
    if (pathname !== path) return false;
    if (!query) {
      // "Toutes" (/admin/properties with no status) only when no status set.
      if (path === "/admin/properties") return !status;
      return true;
    }
    const want = new URLSearchParams(query).get("status");
    return status === want;
  }

  return (
    <nav className="mb-5 mt-4">
      {/* Top: 5 hubs */}
      <div className="snap-rail hide-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        {GROUPS.map((g) => {
          const on = g.key === group.key;
          return (
            <Link
              key={g.key}
              href={g.home as "/admin/properties"}
              className={
                chipBase +
                (on
                  ? " border-batta-gold/60 bg-batta-gold/12 text-batta-gold-bright"
                  : " border-border bg-surface text-foreground hover:border-gold/40 hover:text-gold-bright")
              }
            >
              <g.Icon className="size-3.5" strokeWidth={2} />
              {g.label}
            </Link>
          );
        })}
      </div>

      {/* Sub-tabs for the active hub */}
      {group.tabs.length > 1 && (
        <div className="snap-rail hide-scrollbar -mx-4 mt-2.5 flex gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          {group.tabs.map((t) => {
            const on = tabActive(t.href);
            return (
              <Link
                key={t.href}
                href={t.href as "/admin/properties"}
                className={
                  "tap-target inline-flex shrink-0 snap-start items-center rounded-lg px-3 py-1.5 text-[12px] font-bold transition " +
                  (on
                    ? "bg-batta-gold text-white"
                    : "bg-surface-2 text-foreground/70 hover:text-gold-bright")
                }
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
