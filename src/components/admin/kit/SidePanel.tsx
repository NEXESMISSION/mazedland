"use client";

import { useCallback, useEffect, useRef } from "react";
import { useScrollLock } from "@/lib/scrollLock";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

/**
 * The right-hand drawer where a row is read and acted on.
 *
 * The console currently sends you to a full page to review one listing, which
 * loses the queue: you approve, you land back at the top of a refetched list,
 * you hunt for where you were. A drawer keeps the queue behind it and the
 * scroll position intact — the difference between reviewing three annonces
 * and reviewing thirty.
 *
 * It is opened by a `?panel=<id>` search param that the *server* reads, so
 * the contents are server-rendered and this component only handles the shell:
 * Escape, the overlay, focus, and body scroll lock. Closing is a router push
 * back to the list, so browser Back closes the panel like a user expects.
 */
export function SidePanel({
  title,
  subtitle,
  /** Param that holds the open row's id. */
  param = "panel",
  /** Sticky action bar at the bottom — approve / reject / delete. */
  footer,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  param?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    const params = new URLSearchParams(sp.toString());
    params.delete(param);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }, [router, pathname, sp, param]);

  // Escape closes; body scroll is locked while open. Both are cleaned up on
  // unmount, which is also what runs when the panel closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [close]);

  useScrollLock(true);

  // Move focus into the panel on open so keyboard and screen-reader users
  // land on the thing that just appeared instead of staying on the row behind.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "Détail"}>
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={close}
        aria-hidden
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="absolute inset-y-0 end-0 flex w-full max-w-[560px] flex-col border-s border-border bg-surface shadow-[var(--shadow-lg)] outline-none animate-fade-in"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-[16px] font-extrabold leading-tight tracking-tight text-foreground">
              {title}
            </h2>
            {subtitle && (
              <div className="mt-1 truncate text-[12px] text-muted">{subtitle}</div>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Fermer"
            className="tap-target grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-foreground"
          >
            <X className="size-4.5" strokeWidth={2.2} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer && (
          <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-2/60 px-5 py-3.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/** A labelled row inside a panel. The console's detail views are mostly this. */
export function PanelRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3 border-b border-border/60 py-2.5 last:border-b-0">
      <dt className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-subtle">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-[13px] text-foreground">{children}</dd>
    </div>
  );
}

/** Groups panel rows under a heading. */
export function PanelSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 first:mt-0">
      <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted">
        {title}
      </h3>
      <dl className="mt-2">{children}</dl>
    </section>
  );
}
