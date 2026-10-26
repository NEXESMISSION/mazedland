"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { Optional } from "@/components/ui/Optional";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { AccountMenu } from "./AccountMenu";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { normalizeSearchQuery } from "@/lib/search";
import { isMostlyArabic } from "@/lib/search/script";
import { useSetting } from "@/components/settings/SettingsProvider";
import { Search, Plus } from "lucide-react";

// Lazy-loaded — see TopBar for rationale (heavy icon set + realtime socket +
// mount fetch, none needed for first paint). Reserves the 36px slot.
const NotificationBell = dynamic(
  () =>
    import("@/components/notifications/NotificationBell").then(
      (m) => m.NotificationBell,
    ),
  { ssr: false, loading: () => <span className="inline-block h-9 w-9" /> },
);

/**
 * Desktop (lg+) horizontal navigation. Replaces the mobile TopBar +
 * BottomTabBar on wide viewports (both are `lg:hidden`). Self-hides
 * below lg via `hidden lg:flex`, so the mobile chrome is the single
 * source of navigation on phones/tablets and stays untouched.
 *
 * Balanced three-zone bar:
 *   - Left: logo (→ home) + primary links with a soft active pill.
 *   - Center: an always-visible search that lands on the unified
 *     /properties explore surface.
 *   - Right: notification bell, account, and a saturated "Vendre" CTA.
 *
 * Height is pinned to --desktop-nav-h; the shell's top padding switches
 * to the same value at lg (see .mazed-shell-main in globals.css).
 */

/**
 * "Explorer" points at /annonces, not /properties.
 *
 * /properties has 302'd to /annonces since the pivot, so the link cost every
 * desktop visitor a redirect — and, worse, `isActive` matched only the path
 * being redirected AWAY from, so the tab you had just clicked never lit up.
 * The old paths still match below: an auction-era bookmark or notification
 * should not land on an unlit nav either.
 */
const LINKS: { href: "/" | "/annonces" | "/account/activity"; key: "home" | "browse" | "activity" }[] = [
  { href: "/", key: "home" },
  { href: "/annonces", key: "browse" },
  { href: "/account/activity", key: "activity" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/annonces") {
    return (
      pathname === "/annonces" ||
      // …but not the sell form: « Explorer » lit up while publishing.
      (pathname.startsWith("/annonces/") && pathname !== "/annonces/nouvelle") ||
      pathname === "/properties" ||
      pathname.startsWith("/properties/") ||
      pathname.startsWith("/auctions")
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Puts the address's `q` in the search box, and keeps it there.
 *
 * It used to be read once per path. Clearing a search on the catalogue (the
 * « × » on the chip, « Effacer les filtres »), a link to another search and
 * the back button all change the query and not the path, so the box went on
 * showing « Teniour » over the unfiltered list.
 *
 * A child of its own, in a Suspense with nothing as fallback: useSearchParams
 * in the bar itself would make every statically generated page (the home
 * page among them) render on the client. Here only this, which draws nothing,
 * waits for the browser.
 */
function QueryFromUrl({ onQuery }: { onQuery: (q: string) => void }) {
  const q = useSearchParams().get("q") ?? "";
  const pathname = usePathname();
  // The path too: words typed and not sent are dropped on leaving the page,
  // as before.
  useEffect(() => {
    onQuery(q);
  }, [q, pathname, onQuery]);
  return null;
}

export function DesktopNav() {
  const t = useTranslations("shell.tabs");
  const ts = useTranslations("search");
  const tShell = useTranslations("shell");
  const pathname = usePathname();
  const router = useRouter();
  const locale = useLocale();
  const arabicRedirect = useSetting("feature_arabic_redirect");
  // What the results are filtered by; QueryFromUrl keeps it on the address.
  const [q, setQ] = useState("");

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const clean = normalizeSearchQuery(q);
    // Keep the filters the buyer already chose. Submitting used to push `q`
    // alone, dropping category, governorate, sort and price.
    const params = new URLSearchParams(
      pathname === "/annonces" ? window.location.search : "",
    );
    params.delete("page");
    // New words are read afresh (src/lib/search/understand.ts).
    params.delete("nlq");
    params.delete("nl");
    if (clean) params.set("q", clean);
    else params.delete("q");
    const qs = params.toString();
    // Typed in Arabic on the French site: answered in Arabic, and remembered —
    // unless an admin switched that off.
    if (arabicRedirect && locale === "fr" && isMostlyArabic(clean)) {
      fetch("/api/account/language", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: "ar" }),
        keepalive: true,
      }).catch(() => {});
      router.push((qs ? `/annonces?${qs}` : "/annonces") as `/annonces`, { locale: "ar" });
      return;
    }
    router.push((qs ? `/annonces?${qs}` : "/annonces") as `/annonces`);
    return;
    // Straight to the catalogue. It reads `q` itself; going via /properties
    // only added a redirect between pressing Enter and seeing results.
    router.push(
      (clean ? `/annonces?q=${encodeURIComponent(clean)}` : "/annonces") as `/annonces`,
    );
  }

  return (
    <header className="fixed inset-x-0 top-0 z-40 hidden h-[var(--desktop-nav-h)] items-center border-b border-border bg-white lg:flex">
      <div className="mx-auto flex h-full w-full max-w-[var(--max-w-wide)] items-center gap-6 px-8">
        {/* ── Left zone: brand + primary links ── */}
        <div className="flex shrink-0 items-center gap-7">
          {/* Mark + name, matching the mobile TopBar. The logo file is a
              portrait lockup whose wordmark is illegible at nav height — see
              the note in TopBar.tsx. */}
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Mazed Immo">
            <Image
              src="/logo-mark.webp"
              alt=""
              width={745}
              height={936}
              loading="eager"
              sizes="36px"
              className="h-10 w-auto"
            />
            <span className="text-[17px] font-extrabold tracking-tight text-foreground">
              Mazed Immo
            </span>
          </Link>

          <nav className="flex items-center gap-1" aria-label={tShell("mainNav")}>
            {LINKS.map((l) => {
              const active = isActive(pathname, l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  // Behind sign-in: for a guest, prefetching it on every page
                  // fetches nothing but the redirect to /login.
                  prefetch={l.href.startsWith("/account") ? false : undefined}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full px-3.5 py-2 text-[13.5px] font-semibold transition-colors ${
                    active
                      ? "bg-gold-faint text-[var(--gold)]"
                      : "text-[var(--foreground-muted)] hover:bg-surface-2 hover:text-[var(--foreground)]"
                  }`}
                >
                  {t(l.key)}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* ── Center zone: real search — submits to the explore surface ── */}
        <Suspense fallback={null}>
          <QueryFromUrl onQuery={setQ} />
        </Suspense>
        <form onSubmit={submitSearch} className="flex flex-1 justify-center" role="search">
          <div className="relative flex w-full max-w-md items-center">
            <Search
              className="pointer-events-none absolute size-4 text-muted ltr:left-4 rtl:right-4"
              strokeWidth={2}
            />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={ts("placeholder")}
              aria-label={ts("placeholder")}
              className="h-11 w-full rounded-full border border-border bg-surface-2 text-[13px] text-foreground placeholder:text-muted transition-colors focus:border-gold-soft/70 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-gold-faint ltr:pl-11 ltr:pr-4 rtl:pl-4 rtl:pr-11"
            />
          </div>
        </form>

        {/* ── Right zone: notifications, account, sell CTA ── */}
        <div className="flex shrink-0 items-center gap-2">
          <Optional name="bell" fallback={<span className="inline-block h-9 w-9" />}>
            <NotificationBell />
          </Optional>
          <LocaleSwitcher />
          <AccountMenu />
          <Link
            href="/annonces/nouvelle"
            className="mazed-gold-fill inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-[13px] font-bold shadow-[var(--shadow-gold)] transition active:scale-[0.98]"
          >
            <Plus className="size-4" strokeWidth={2.5} />
            {t("sell")}
          </Link>
        </div>
      </div>
    </header>
  );
}
