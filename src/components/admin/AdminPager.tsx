"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Link-style pager for the server-rendered admin queues. Preserves all
 * current params (status / q / range) and only changes ?page.
 */
export function AdminPager({ page, totalPages }: { page: number; totalPages: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  if (totalPages <= 1) return null;

  const go = (p: number) => {
    const params = new URLSearchParams(sp.toString());
    params.set("page", String(p));
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="mt-6 flex items-center justify-center gap-3">
      <button
        type="button"
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-[12.5px] font-semibold text-foreground disabled:opacity-40 enabled:hover:border-gold-soft/60"
      >
        <ChevronLeft className="size-4" /> Précédent
      </button>
      <span className="batta-tabular text-[12.5px] font-semibold text-muted">
        Page {page} / {totalPages}
      </span>
      <button
        type="button"
        onClick={() => go(page + 1)}
        disabled={page >= totalPages}
        className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-[12.5px] font-semibold text-foreground disabled:opacity-40 enabled:hover:border-gold-soft/60"
      >
        Suivant <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
