"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X, Loader2 } from "lucide-react";
import { SearchIcon, SearchSweep, SearchStatus } from "@/components/ui/SearchBusy";

/**
 * Filters, flat: tabs as underlined words, search as a line rather than a box.
 *
 * It owns no state beyond the text being typed — everything lives in the URL,
 * which the server page reads. That is what keeps filtering and paging
 * server-side, and it means a filtered view is a link you can send to someone.
 *
 * The pending state is not decoration. Every admin route is `force-dynamic`,
 * so changing a tab is a server round trip; without a spinner the old list sits
 * there looking like the click was ignored.
 */

export type Tab = { value: string; label: string; count?: number };

export function Toolbar({
  tabs,
  tabParam = "status",
  defaultTab,
  search = true,
  searchPlaceholder = "Rechercher…",
  /** Params to drop on any change — e.g. the open detail, which may not exist
   *  in the new result set. */
  resetParams = ["page"],
}: {
  tabs?: Tab[];
  tabParam?: string;
  defaultTab?: string;
  search?: boolean;
  searchPlaceholder?: string;
  resetParams?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");

  const activeTab = sp.get(tabParam) ?? defaultTab ?? tabs?.[0]?.value ?? "";

  function push(next: Record<string, string | null>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    for (const p of resetParams) params.delete(p);
    const qs = params.toString();
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  // Debounce typing. The mount pass is skipped so arriving on a page with ?q=
  // already set doesn't immediately re-navigate to itself.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const id = setTimeout(() => push({ q: q.trim() || null }), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-4">
      {tabs && tabs.length > 0 && (
        <div className="flex min-w-0 items-center gap-4 overflow-x-auto">
          {tabs.map((t) => {
            const active = t.value === activeTab;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => push({ [tabParam]: t.value })}
                aria-pressed={active}
                className={`relative shrink-0 whitespace-nowrap py-1 text-[12.5px] transition ${
                  active
                    ? "font-semibold text-[var(--gold)] after:absolute after:inset-x-0 after:-bottom-[9px] after:h-[2px] after:bg-[var(--gold)]"
                    : "font-medium text-subtle hover:text-foreground"
                }`}
              >
                {t.label}
                {t.count != null && t.count > 0 && (
                  <span className="batta-tabular ms-1.5 text-[11px] opacity-70">{t.count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="ms-auto flex shrink-0 items-center gap-2">
        {/* Only when there is no search field to carry the state itself —
            two spinners a few pixels apart read as two things happening. */}
        {pending && !search && <Loader2 className="size-3.5 animate-spin text-[var(--gold)]" />}
        {search && (
          <div className="relative overflow-hidden">
            <SearchIcon
              active={pending}
              className="pointer-events-none absolute start-0 top-1/2 size-3.5 -translate-y-1/2 text-subtle"
            />
            <SearchSweep active={pending} />
            <SearchStatus active={pending} />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-7 w-40 border-b border-border bg-transparent ps-5 pe-5 text-[12.5px] text-foreground placeholder:text-subtle focus:border-[var(--gold)] focus:outline-none lg:w-52"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Effacer la recherche"
                className="absolute end-0 top-1/2 grid size-4 -translate-y-1/2 place-items-center text-subtle hover:text-foreground"
              >
                <X className="size-3" strokeWidth={2.6} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
