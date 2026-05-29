"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

const RANGES = [
  { key: "", label: "Tout" },
  { key: "1", label: "Aujourd'hui" },
  { key: "7", label: "7 j" },
  { key: "30", label: "30 j" },
];

/**
 * Shared admin queue toolbar: debounced free-text search + a date-range
 * segmented control + a live result count. Drives the URL (?q, ?range)
 * which the server page reads — so search/filter/pagination are all
 * server-side, the only way these queues survive hundreds of rows/day.
 * Preserves any other params (e.g. ?status=) and resets ?page on change.
 */
export function AdminQueryBar({
  total,
  placeholder = "Rechercher…",
}: {
  total: number;
  placeholder?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const range = sp.get("range") ?? "";

  function push(next: Record<string, string | null>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  // Debounced search — skip the mount so we don't refetch the SSR page.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const id = setTimeout(() => push({ q: q.trim() || null }), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" strokeWidth={2} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-9 w-64 rounded-lg border border-border bg-surface pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted focus:border-gold focus:outline-none"
        />
      </div>

      <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => push({ range: r.key || null })}
            className={`rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition ${
              range === r.key ? "bg-[var(--gold)] text-white" : "text-muted hover:text-foreground"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <span className="batta-tabular ms-auto text-[12px] text-muted">
        {total.toLocaleString("fr-FR")} résultat{total > 1 ? "s" : ""}
      </span>
    </div>
  );
}
